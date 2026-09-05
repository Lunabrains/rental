"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BellPlus, Check, Paperclip, Pencil, Receipt, Wrench } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { PriorityBadge, StatusBadge } from "@/components/common/status-badge";
import { DocumentPreview } from "@/components/documents/document-preview";
import { workOrderColumns } from "@/components/properties/building-tabs";
import { DataTable } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { approveWorkOrder, updateWorkOrder } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatDateTime, formatMoney, labelize } from "@/lib/format";
import { getWorkOrderDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

/** Work-order detail (plan §Phase 7): the complete operational and cost history of one issue. */
export function WorkOrderPage({ workOrderId }: { workOrderId: string }) {
  const { store, run } = useStoreContext();
  const { editWorkOrder, workOrderStatus, addExpense, createReminder, openUnitPage, openTenant, createWorkOrder, openWorkOrder } = useActions();
  const d = useMemo(() => getWorkOrderDetails(store, workOrderId), [store, workOrderId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  if (!d) {
    return (
      <EmptyState
        icon={Wrench}
        title="Work order not found"
        action={
          <Button asChild variant="outline">
            <Link href="/maintenance">All work orders</Link>
          </Button>
        }
      />
    );
  }
  const w = d.workOrder;
  const before = d.documents.filter((x) => w.beforePhotoIds.includes(x.id));
  const after = d.documents.filter((x) => w.afterPhotoIds.includes(x.id));
  const invoice = d.documents.find((x) => x.id === w.invoiceDocumentId) ?? null;
  const expenseTotal = d.expenses.reduce((n, e) => n + e.expense.amount, 0);
  const repeatCount = d.related.length;

  function approve() {
    try {
      const { undo } = run(approveWorkOrder(w.id));
      toast.success(`${w.number} approved — work can start`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: w.number }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base text-muted-foreground">{w.number}</span>
            {w.title}
            <StatusBadge value={w.status} />
            <PriorityBadge priority={w.priority} />
          </span>
        }
        description={`${d.property.name}${d.unit ? ` · unit ${d.unit.unitNumber}` : ""}${d.asset ? ` · ${d.asset.name}` : ""} · ${labelize(w.category)} · reported ${formatDate(w.reportedAt)} (${d.ageDays} days ago) via ${w.source}${d.tenant ? ` by ${d.tenant.fullName}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => createReminder({ entityType: "work_order", entityId: w.id, label: `${w.number} · ${w.title}`, title: `Follow up ${w.number}` })}>
              <BellPlus className="size-4" /> Reminder
            </Button>
            <Button variant="outline" onClick={() => editWorkOrder(w.id)}>
              <Pencil className="size-4" /> Edit
            </Button>
            {(w.status === "awaiting_approval" || w.status === "awaiting_quote") && (
              <Button onClick={approve}>
                <Check className="size-4" /> Approve{w.estimatedCost ? ` ${formatMoney(w.estimatedCost)}` : ""}
              </Button>
            )}
            {d.isOpen && w.status !== "awaiting_approval" && (
              <Button onClick={() => workOrderStatus(w.id)}>{w.status === "in_progress" ? "Complete" : "Update status"}</Button>
            )}
            {w.status === "completed" && <Button onClick={() => workOrderStatus(w.id)}>Close</Button>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Estimated cost" value={w.estimatedCost ? formatMoney(w.estimatedCost) : "—"} sublabel={w.approvalRequired ? (w.approvedAt ? `Approved ${formatDate(w.approvedAt)}` : "Needs approval") : "No approval needed"} tone={w.status === "awaiting_approval" ? "warning" : "default"} />
        <KpiCard label="Actual cost" value={w.actualCost !== null ? formatMoney(w.actualCost) : "—"} sublabel={w.estimatedCost && w.actualCost !== null ? `${w.actualCost > w.estimatedCost ? "+" : ""}${formatMoney(w.actualCost - w.estimatedCost)} vs estimate` : expenseTotal > 0 ? `${formatMoney(expenseTotal)} in invoices` : "Set when completed"} tone={w.estimatedCost && w.actualCost !== null && w.actualCost > w.estimatedCost * 1.1 ? "warning" : "default"} />
        <KpiCard label="Resolution" value={d.resolutionDays !== null ? `${d.resolutionDays} days` : `${d.ageDays} days open`} sublabel={w.completedAt ? `Completed ${formatDate(w.completedAt)}` : d.overdue ? "Open longer than your threshold" : "In progress"} tone={d.overdue ? "critical" : "default"} />
        <KpiCard label="Related issues" value={repeatCount} sublabel={repeatCount >= store.settings.thresholds.repeatIssueMinCount - 1 ? "Repeat problem — consider a permanent fix" : repeatCount > 0 ? "Same place, same category" : "First occurrence"} tone={repeatCount >= 2 ? "warning" : "default"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Issue">
            <p className="whitespace-pre-wrap text-sm">{w.description || <span className="text-muted-foreground">No description recorded.</span>}</p>
            {w.notes && <p className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{w.notes}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Building">
                <Link href={`/properties/${d.property.id}`} className="hover:underline">
                  {d.property.name}
                </Link>
              </Field>
              <Field label="Unit">{d.unit ? <button type="button" className="hover:underline" onClick={() => openUnitPage(d.unit!.id, "maintenance")}>{d.unit.unitNumber}</button> : "—"}</Field>
              <Field label="Asset">{d.asset ? <Link href={`/assets/${d.asset.id}`} className="hover:underline">{d.asset.name}</Link> : "—"}</Field>
              <Field label="Supplier">{d.supplier ? <Link href={`/suppliers/${d.supplier.id}`} className="hover:underline">{d.supplier.name}</Link> : <span className="text-warning-foreground">Unassigned</span>}</Field>
              <Field label="Reported by">{d.tenant ? <button type="button" className="hover:underline" onClick={() => openTenant(d.tenant!.id)}>{d.tenant.fullName}</button> : labelize(w.source)}</Field>
              <Field label="Started">{formatDate(w.startedAt)}</Field>
              <Field label="Completed">{formatDate(w.completedAt)}</Field>
              <Field label="Closed">{formatDate(w.closedAt)}</Field>
              <Field label="Repeat of">{d.repeatOf ? <Link href={`/maintenance/${d.repeatOf.id}`} className="hover:underline">{d.repeatOf.number}</Link> : "—"}</Field>
            </dl>
          </SectionCard>

          <SectionCard title="Photos" description="Before and after — kept with the work order and in the document centre">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Before</div>
                <PhotoStrip docs={before} onPreview={setPreview} />
                <AttachmentUploader compact photos links={{ workOrderId: w.id }} label="Add before photo" className="mt-2" onAdded={(doc) => run(updateWorkOrder(w.id, { beforePhotoIds: [...w.beforePhotoIds, doc.id] }))} />
              </div>
              <div>
                <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">After</div>
                <PhotoStrip docs={after} onPreview={setPreview} />
                <AttachmentUploader compact photos links={{ workOrderId: w.id }} label="Add after photo" className="mt-2" onAdded={(doc) => run(updateWorkOrder(w.id, { afterPhotoIds: [...w.afterPhotoIds, doc.id] }))} />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Invoice & cost" description={d.expenses.length > 0 ? `${d.expenses.length} expense${d.expenses.length === 1 ? "" : "s"} linked · ${formatMoney(expenseTotal)}` : "No expense linked yet"} action={<Button size="sm" variant="outline" onClick={() => addExpense({ propertyId: w.propertyId, unitId: w.unitId, supplierId: w.supplierId, assetId: w.assetId, workOrderId: w.id, category: w.category === "plumbing" || w.category === "electrical" || w.category === "hvac" || w.category === "elevator" || w.category === "generator" ? w.category : "maintenance", amount: w.actualCost ?? w.estimatedCost ?? 0, description: `${w.title} (${w.number})` })}><Receipt className="size-3.5" /> Add expense</Button>}>
            {invoice ? (
              <ul className="divide-y rounded-md border">
                <DocumentRow doc={invoice} onPreview={setPreview} />
              </ul>
            ) : (
              <AttachmentUploader compact links={{ workOrderId: w.id, supplierId: w.supplierId }} category="invoice" label="Attach invoice" onAdded={(doc) => run(updateWorkOrder(w.id, { invoiceDocumentId: doc.id }))} />
            )}
            {d.expenses.length > 0 && (
              <ul className="mt-3 divide-y text-sm">
                {d.expenses.map((e) => (
                  <li key={e.expense.id} className="flex items-center justify-between py-1.5">
                    <span>
                      {e.expense.description}
                      <span className="ml-2 text-xs text-muted-foreground">{formatDate(e.expense.expenseDate)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge value={e.expense.paymentStatus} />
                      <span className="tabular font-medium">{formatMoney(e.expense.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {d.related.length > 0 && (
            <SectionCard title="Related previous issues" description={`${d.related.length} work order${d.related.length === 1 ? "" : "s"} for ${labelize(w.category).toLowerCase()} at the same place`} action={<Button size="sm" variant="ghost" onClick={() => createWorkOrder({ propertyId: w.propertyId, unitId: w.unitId, assetId: w.assetId, category: w.category, title: `${w.title} — permanent fix`, repeatOfWorkOrderId: w.id, priority: "high" })}>Raise a permanent fix</Button>} flush>
              <div className="p-3">
                <DataTable rows={d.related} columns={workOrderColumns} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense />
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-5">
          <SectionCard title="Status timeline">
            <ol className="relative space-y-4 border-l pl-5">
              {w.statusHistory.slice().reverse().map((h, i) => (
                <li key={`${h.status}-${h.at}-${i}`} className="relative">
                  <span className={cn("absolute -left-[26px] top-1 size-2.5 rounded-full ring-4 ring-card", i === 0 ? "bg-brand" : "bg-muted-foreground/40")} />
                  <div className="flex items-center gap-2 text-sm">
                    <StatusBadge value={h.status} />
                    <span className="tabular text-xs text-muted-foreground">{formatDateTime(h.at)}</span>
                  </div>
                  {h.note && <div className="mt-0.5 text-xs text-muted-foreground">{h.note}</div>}
                </li>
              ))}
            </ol>
          </SectionCard>
          {d.audit.length > 0 && (
            <SectionCard title="Audit trail" description="Every change with its previous value">
              <ul className="space-y-1 text-xs">
                {d.audit.slice(0, 20).map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span className="tabular shrink-0 text-muted-foreground">{formatDateTime(a.at)}</span>
                    <span>
                      {a.action === "create" ? "Created" : a.action === "status" ? `Status ${a.previousValue} → ${a.newValue}` : `${a.field}: ${a.previousValue ?? "—"} → ${a.newValue ?? "—"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
          {d.plan && (
            <SectionCard title="Preventive plan">
              <p className="text-sm">{d.plan.maintenanceType} · every {d.plan.recurrenceMonths} months · next {formatDate(d.plan.nextServiceDate)}</p>
            </SectionCard>
          )}
          {d.inspection && (
            <SectionCard title="Raised from inspection">
              <p className="text-sm">
                {labelize(d.inspection.type)} inspection on {formatDate(d.inspection.completedDate ?? d.inspection.scheduledDate)} · {d.inspection.inspector}
              </p>
            </SectionCard>
          )}
        </div>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function PhotoStrip({ docs, onPreview }: { docs: StoredDocument[]; onPreview: (d: StoredDocument) => void }) {
  if (docs.length === 0) return <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No photos</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {docs.map((doc) => (
        <button key={doc.id} type="button" className="flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted" onClick={() => onPreview(doc)} title={doc.title}>
          {doc.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.dataUrl} alt={doc.title} className="size-full object-cover" />
          ) : (
            <Paperclip className="size-5 text-muted-foreground" />
          )}
        </button>
      ))}
    </div>
  );
}
