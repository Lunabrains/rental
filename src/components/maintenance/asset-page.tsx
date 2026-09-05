"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardList, Pencil, Plus, Printer, Wrench } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { DataTable, type Column } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { Timeline } from "@/components/common/timeline";
import { DocumentPreview } from "@/components/documents/document-preview";
import { AssetQr, printQrLabels } from "@/components/maintenance/qr-code";
import { workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, labelize } from "@/lib/format";
import { getAssetDetails, type PlanRow, type TimelineEvent } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

/** Asset page (plan §Phase 8): status, service, work, cost and documents for one piece of equipment — the QR scan lands here. */
export function AssetPage({ assetId }: { assetId: string }) {
  const store = useStore();
  const { editAsset, addPlan, editPlan, logService, createWorkOrder, openWorkOrder } = useActions();
  const d = useMemo(() => getAssetDetails(store, assetId), [store, assetId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  if (!d) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Asset not found"
        action={
          <Button asChild variant="outline">
            <Link href="/assets">All assets</Link>
          </Button>
        }
      />
    );
  }
  const a = d.asset;
  const openOrders = d.workOrders.filter((w) => w.isOpen);
  const timeline: TimelineEvent[] = [
    ...d.workOrders.map((w) => ({ id: `wo-${w.workOrder.id}`, at: w.workOrder.reportedAt, title: `${w.workOrder.priority === "emergency" ? "Emergency" : "Work order"} — ${w.workOrder.title}`, detail: `${w.workOrder.number} · ${labelize(w.workOrder.status)}${w.workOrder.actualCost ? ` · ${formatMoney(w.workOrder.actualCost)}` : ""}`, tone: (w.workOrder.priority === "emergency" ? "critical" : w.isOpen ? "warning" : "default") as TimelineEvent["tone"], kind: "maintenance" as const })),
    ...d.plans.filter((p) => p.plan.lastServiceDate).map((p) => ({ id: `svc-${p.plan.id}`, at: p.plan.lastServiceDate!, title: `${p.plan.maintenanceType} done`, detail: `${p.supplier?.name ?? ""}${p.plan.estimatedCost ? ` · ${formatMoney(p.plan.estimatedCost)}` : ""} · next ${formatDate(p.plan.nextServiceDate)}`, tone: "success" as const, kind: "asset" as const })),
    ...d.expenses.filter((e) => !e.expense.workOrderId).map((e) => ({ id: `e-${e.expense.id}`, at: e.expense.expenseDate, title: `${e.expense.description}`, detail: `${formatMoney(e.expense.amount)} · ${labelize(e.expense.category)}`, tone: "default" as const, kind: "expense" as const })),
    ...d.inspections.map((i) => ({ id: `i-${i.id}`, at: i.completedDate ?? i.scheduledDate, title: `${labelize(i.type)} inspection ${i.overallResult ?? i.status}`, detail: i.inspector, tone: (i.overallResult === "fail" ? "critical" : "default") as TimelineEvent["tone"], kind: "inspection" as const })),
    ...(a.installationDate ? [{ id: "installed", at: a.installationDate, title: `${a.name} installed`, detail: `${a.manufacturer ?? ""} ${a.model ?? ""}${a.purchaseCost ? ` · ${formatMoney(a.purchaseCost)}` : ""}`.trim(), tone: "info" as const, kind: "asset" as const }] : []),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  const planColumns: Column<PlanRow>[] = [
    { key: "type", header: "Service", cell: (r) => <span className="font-medium">{r.plan.maintenanceType}</span> },
    { key: "every", header: "Every", cell: (r) => `${r.plan.recurrenceMonths} mo`, value: (r) => r.plan.recurrenceMonths },
    { key: "last", header: "Last", cell: (r) => formatDate(r.plan.lastServiceDate), value: (r) => r.plan.lastServiceDate ?? "" },
    { key: "next", header: "Next", cell: (r) => <span className={cn(r.state === "overdue" && "font-medium text-critical", r.state === "due_soon" && "text-warning-foreground")}>{formatDate(r.plan.nextServiceDate)}</span>, value: (r) => r.plan.nextServiceDate },
    { key: "state", header: "State", cell: (r) => <StatusBadge value={r.state} /> },
    { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—" },
    { key: "cost", header: "Est.", align: "right", cell: (r) => (r.plan.estimatedCost ? formatMoney(r.plan.estimatedCost) : "—"), value: (r) => r.plan.estimatedCost ?? 0 },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant={r.state === "overdue" || r.state === "due_soon" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => logService(r.plan.id)}>
            Log service
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => createWorkOrder({ propertyId: a.propertyId, assetId: a.id, title: r.plan.maintenanceType, category: a.assetType === "elevator" ? "elevator" : a.assetType === "generator" ? "generator" : a.assetType === "hvac" ? "hvac" : "other", supplierId: r.supplier?.id ?? null, source: "preventive", preventivePlanId: r.plan.id })}>
            Work order
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => editPlan(r.plan.id)}>
            <Pencil className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Assets", href: "/assets" }, { label: a.name }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.name}
            <StatusBadge value={a.status} dot />
            <StatusBadge value={d.serviceState} label={d.serviceState === "none" ? "No plan" : undefined} />
          </span>
        }
        description={`${labelize(a.assetType)} · ${d.property.name}${d.unit ? ` · unit ${d.unit.unitNumber}` : ""}${a.manufacturer ? ` · ${a.manufacturer}${a.model ? ` ${a.model}` : ""}` : ""}${a.serialNumber ? ` · S/N ${a.serialNumber}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => printQrLabels([{ code: a.qrCode, name: a.name, building: d.property.name, type: labelize(a.assetType) }])}>
              <Printer className="size-4" /> QR label
            </Button>
            <Button variant="outline" onClick={() => editAsset(a.id)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button onClick={() => createWorkOrder({ propertyId: a.propertyId, unitId: a.unitId, assetId: a.id, title: `${a.name} — `, category: a.assetType === "elevator" ? "elevator" : a.assetType === "generator" ? "generator" : a.assetType === "hvac" ? "hvac" : "other", supplierId: a.supplierId, priority: a.status === "out_of_service" ? "emergency" : "normal" })}>
              <Wrench className="size-4" /> Work order
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Last service" value={a.lastServiceDate ? formatDate(a.lastServiceDate) : "—"} sublabel={d.plans.length > 0 ? `${d.plans.length} preventive plan${d.plans.length === 1 ? "" : "s"}` : "No preventive plan"} />
        <KpiCard label="Next service" value={a.nextServiceDate ? formatDate(a.nextServiceDate) : "—"} sublabel={d.daysToService !== null ? (d.daysToService < 0 ? `${Math.abs(d.daysToService)} days overdue` : `in ${d.daysToService} days`) : "Add a plan to schedule it"} tone={d.serviceState === "overdue" ? "critical" : d.serviceState === "due_soon" ? "warning" : "default"} />
        <KpiCard label="Open work orders" value={openOrders.length} tone={openOrders.some((w) => w.workOrder.priority === "emergency") ? "critical" : openOrders.length > 0 ? "warning" : "success"} sublabel={openOrders[0]?.workOrder.title ?? "Nothing open"} />
        <KpiCard label="Total spend" value={formatMoney(d.totalSpend)} sublabel={a.purchaseCost ? `Purchased for ${formatMoney(a.purchaseCost)}${a.warrantyExpiry ? ` · warranty ${d.warrantyDays !== null && d.warrantyDays < 0 ? "expired" : `to ${formatDate(a.warrantyExpiry)}`}` : ""}` : "Work orders and services"} tone={d.warrantyDays !== null && d.warrantyDays >= 0 && d.warrantyDays <= 60 ? "warning" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Preventive maintenance" description="Recurring services and when they fall due" action={<Button size="sm" variant="outline" onClick={() => addPlan({ propertyId: a.propertyId, assetId: a.id })}><Plus className="size-3.5" /> Add plan</Button>} flush>
            <div className="p-3">
              <DataTable rows={d.plans} columns={planColumns} rowKey={(r) => r.plan.id} dense emptyTitle="No preventive plan yet" emptyDescription="Add one to get due and overdue alerts." />
            </div>
          </SectionCard>
          <SectionCard title="Work orders" description={`${d.workOrders.length} on record`} flush>
            <div className="p-3">
              <DataTable rows={d.workOrders} columns={workOrderColumns.filter((c) => c.key !== "where")} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense emptyTitle="No work orders" emptyIcon={Wrench} />
            </div>
          </SectionCard>
          <SectionCard title="Cost history" description="Services, repairs and parts per month, last 12 months">
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.costHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
                  <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="amount" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>
        <div className="space-y-5">
          <SectionCard title="QR label" description="Scan to open this asset in the app">
            <div className="flex items-start gap-4">
              <AssetQr code={a.qrCode} size={128} />
              <div className="text-xs text-muted-foreground">
                <p>The label encodes a link to this page. Anyone scanning it must sign in first — the code itself carries no data.</p>
                <p className="mt-2">Print it and stick it on the equipment; technicians can then log what they did against the right asset.</p>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Manufacturer">{a.manufacturer ?? "—"}</Field>
              <Field label="Model">{a.model ?? "—"}</Field>
              <Field label="Serial number">{a.serialNumber ?? "—"}</Field>
              <Field label="Installed">{formatDate(a.installationDate)}</Field>
              <Field label="Purchase cost">{a.purchaseCost ? formatMoney(a.purchaseCost) : "—"}</Field>
              <Field label="Warranty">{a.warrantyExpiry ? formatDate(a.warrantyExpiry) : "—"}</Field>
              <Field label="Supplier">{d.supplier ? <Link href={`/suppliers/${d.supplier.id}`} className="hover:underline">{d.supplier.name}</Link> : "—"}</Field>
              <Field label="Building">
                <Link href={`/properties/${d.property.id}?view=assets`} className="hover:underline">
                  {d.property.name}
                </Link>
              </Field>
            </dl>
            {a.notes && <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{a.notes}</p>}
          </SectionCard>
          <SectionCard title="Documents & manuals" description={`${d.documents.length} on file`} flush>
            {d.documents.length === 0 ? (
              <div className="px-4 pb-3">
                <p className="text-xs text-muted-foreground">Manuals, certificates and warranties live here; certificates with an expiry raise alerts.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {d.documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onPreview={setPreview} />
                ))}
              </ul>
            )}
            <div className="border-t px-4 py-3">
              <AttachmentUploader compact links={{ assetId: a.id, propertyId: a.propertyId }} category="certificate" label="Attach manual / certificate" />
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
