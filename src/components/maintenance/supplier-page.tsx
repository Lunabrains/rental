"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Mail, Pencil, Phone, Truck, Wrench } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { DataTable, type Column } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ScoreBreakdown } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { Timeline } from "@/components/common/timeline";
import { DocumentPreview } from "@/components/documents/document-preview";
import { StarRating } from "@/components/maintenance/supplier-dialog";
import { expenseColumns, workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { updateSupplier } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMoneyCompact, labelize } from "@/lib/format";
import { getSupplierDetails, type PlanRow, type TimelineEvent } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { Asset, StoredDocument } from "@/types";

/** Supplier page (plan §Phase 9): performance, work history, spend, contracts. */
export function SupplierPage({ supplierId }: { supplierId: string }) {
  const { store, run } = useStoreContext();
  const { editSupplier, createWorkOrder, openWorkOrder, openAsset, editExpense, logService } = useActions();
  const d = useMemo(() => getSupplierDetails(store, supplierId), [store, supplierId]);
  const documents = useMemo(() => store.documents.filter((doc) => doc.supplierId === supplierId && !doc.deleted).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)), [store, supplierId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  if (!d) {
    return (
      <EmptyState
        icon={Truck}
        title="Supplier not found"
        action={
          <Button asChild variant="outline">
            <Link href="/suppliers">All suppliers</Link>
          </Button>
        }
      />
    );
  }
  const s = d.supplier;
  const openOrders = d.workOrders.filter((w) => w.isOpen);

  function rate(v: number | null) {
    try {
      const { undo } = run(updateSupplier(s.id, { rating: v }));
      toast.success(v === null ? "Rating cleared" : `${s.name} rated ${v}/5`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the rating");
    }
  }

  const timeline: TimelineEvent[] = [
    ...d.workOrders.map((w) => ({ id: `wo-${w.workOrder.id}`, at: w.workOrder.completedAt ?? w.workOrder.reportedAt, title: `${w.workOrder.number} · ${w.workOrder.title}`, detail: `${w.property.name}${w.unit ? ` · ${w.unit.unitNumber}` : ""} · ${labelize(w.workOrder.status)}${w.workOrder.actualCost ? ` · ${formatMoney(w.workOrder.actualCost)}` : ""}`, tone: (w.workOrder.priority === "emergency" ? "critical" : w.isOpen ? "warning" : "default") as TimelineEvent["tone"], kind: "maintenance" as const })),
    ...d.expenses.filter((e) => !e.expense.workOrderId).map((e) => ({ id: `e-${e.expense.id}`, at: e.expense.expenseDate, title: e.expense.description, detail: `${formatMoney(e.expense.amount)} · ${labelize(e.expense.category)} · ${e.property?.name ?? "Portfolio"}`, tone: "default" as const, kind: "expense" as const })),
    ...store.activity.filter((a) => a.supplierId === s.id && a.type.startsWith("supplier_")).map((a) => ({ id: `act-${a.id}`, at: a.at, title: a.message, detail: "", tone: "info" as const, kind: "activity" as const })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  const assetColumns: Column<Asset>[] = [
    { key: "name", header: "Asset", cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: "type", header: "Type", cell: (r) => labelize(r.assetType) },
    { key: "building", header: "Building", cell: (r) => store.properties.find((p) => p.id === r.propertyId)?.name ?? "—" },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.status} dot /> },
    { key: "next", header: "Next service", cell: (r) => formatDate(r.nextServiceDate) },
  ];
  const planColumns: Column<PlanRow>[] = [
    { key: "type", header: "Service", cell: (r) => <span className="font-medium">{r.plan.maintenanceType}</span> },
    { key: "where", header: "Where", cell: (r) => `${r.property.name}${r.asset ? ` · ${r.asset.name}` : ""}` },
    { key: "next", header: "Next due", cell: (r) => <span className={cn(r.state === "overdue" && "font-medium text-critical", r.state === "due_soon" && "text-warning-foreground")}>{formatDate(r.plan.nextServiceDate)}</span> },
    { key: "state", header: "State", cell: (r) => <StatusBadge value={r.state} /> },
    { key: "cost", header: "Est.", align: "right", cell: (r) => (r.plan.estimatedCost ? formatMoney(r.plan.estimatedCost) : "—") },
    { key: "act", header: "", sortable: false, noExport: true, cell: (r) => (r.state !== "paused" ? <span className="flex justify-end" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => logService(r.plan.id)}>Log service</Button></span> : null) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Suppliers", href: "/suppliers" }, { label: s.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.name}
            <StatusBadge value={s.active ? "active" : "inactive"} dot />
          </span>
        }
        description={`${labelize(s.category)}${s.company && s.company !== s.name ? ` · ${s.company}` : ""}${s.services.length > 0 ? ` · ${s.services.join(", ")}` : ""} · since ${formatDate(s.createdAt)}`}
        actions={
          <>
            <Button variant="outline" onClick={() => editSupplier(s.id)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button onClick={() => createWorkOrder({ supplierId: s.id, category: s.category === "cleaning" || s.category === "security" || s.category === "painting" || s.category === "pest_control" || s.category === "general_contractor" ? "other" : s.category })}>
              <Wrench className="size-4" /> New work order
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Performance" value={d.score === null ? "—" : `${d.score}/100`} sublabel={d.score === null ? "Needs at least 2 completed jobs" : d.scoreLabel} tone={d.score === null ? "default" : d.score >= 80 ? "success" : d.score >= 60 ? "warning" : "critical"} />
        <KpiCard label="Jobs" value={`${d.completedJobs} done`} sublabel={`${d.openJobs} open · last ${formatDate(d.lastJobAt)}`} tone={d.openJobs > 0 ? "warning" : "default"} />
        <KpiCard label="Response / completion" value={d.avgResponseDays !== null ? `${d.avgResponseDays.toFixed(1)}d` : "—"} sublabel={d.avgCompletionDays !== null ? `Completes in ${d.avgCompletionDays.toFixed(1)} days on average` : "No completed jobs"} />
        <KpiCard label="Total spend" value={formatMoney(d.totalSpend)} sublabel={d.avgCost !== null ? `${formatMoney(d.avgCost)} per job${d.costVariance !== null ? ` · ${d.costVariance >= 1 ? "+" : ""}${Math.round((d.costVariance - 1) * 100)}% vs quotes` : ""}` : "Expenses and completed work"} tone={d.costVariance !== null && d.costVariance > 1.15 ? "warning" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Work orders" description={`${openOrders.length} open · ${d.completedJobs} completed`} flush>
            <div className="p-3">
              <DataTable rows={d.workOrders} columns={workOrderColumns.filter((c) => c.key !== "supplier")} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense pageSize={15} emptyTitle="No work orders yet" emptyIcon={Wrench} />
            </div>
          </SectionCard>
          <SectionCard title="Assets & plans" description={`${d.assets.length} asset${d.assets.length === 1 ? "" : "s"} · ${d.plans.length} preventive plan${d.plans.length === 1 ? "" : "s"} assigned`} flush>
            <div className="space-y-3 p-3">
              {d.assets.length > 0 && <DataTable rows={d.assets} columns={assetColumns} rowKey={(r) => r.id} onRowClick={(r) => openAsset(r.id)} dense />}
              <DataTable rows={d.plans} columns={planColumns} rowKey={(r) => r.plan.id} dense emptyTitle="No preventive plans assigned" />
            </div>
          </SectionCard>
          <SectionCard title="Expenses" description={`${d.expenses.length} booked · ${formatMoney(d.expenses.reduce((n, e) => n + e.expense.amount, 0))}`} flush>
            <div className="p-3">
              <DataTable rows={d.expenses} columns={expenseColumns} rowKey={(r) => r.expense.id} onRowClick={(r) => editExpense(r.expense.id)} dense pageSize={10} emptyTitle="No expenses booked" />
            </div>
          </SectionCard>
        </div>
        <div className="space-y-5">
          <SectionCard title="Performance score" description="Computed from completed work — every input is visible">
            <ScoreBreakdown score={d.score} label={d.scoreLabel} components={d.components} caption={d.score === null ? "Scores appear after two completed jobs." : `${d.completedJobs} completed jobs${d.repeatIssueRate !== null ? ` · ${Math.round(d.repeatIssueRate * 100)}% followed by a repeat issue` : ""}`} />
            <div className="mt-4 flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Your rating</p>
                <p className="text-xs text-muted-foreground">Manual — does not change the computed score</p>
              </div>
              <StarRating value={s.rating} onChange={rate} />
            </div>
          </SectionCard>
          <SectionCard title="Contact">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Phone">{s.phone ? <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3.5" />{s.phone}</a> : "—"}</Field>
              <Field label="Email">{s.email ? <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3.5" />{s.email}</a> : "—"}</Field>
              <Field label="Company">{s.company ?? "—"}</Field>
              <Field label="Category">{labelize(s.category)}</Field>
            </dl>
            {s.notes && <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{s.notes}</p>}
          </SectionCard>
          <SectionCard title="Spend by year">
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.spendByYear} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="35%">
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
                  <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="amount" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
          <SectionCard title="Contracts & documents" description={`${documents.length} on file`} flush>
            {documents.length === 0 ? (
              <div className="px-4 pb-3">
                <p className="text-xs text-muted-foreground">Service contracts, insurance and licences; documents with an expiry raise alerts before they lapse.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onPreview={setPreview} />
                ))}
              </ul>
            )}
            <div className="border-t px-4 py-3">
              <AttachmentUploader compact links={{ supplierId: s.id }} category="insurance" label="Attach contract / insurance" />
            </div>
          </SectionCard>
          <SectionCard title="History">
            <Timeline events={timeline} limit={30} />
          </SectionCard>
        </div>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
