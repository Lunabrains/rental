"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AssetSelect, EnumSelect, PropertySelect, SupplierSelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { StatusBadge } from "@/components/common/status-badge";
import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { canTransition, changeWorkOrderStatus, createWorkOrder, updateWorkOrder, type WorkOrderInput } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatMoney, labelize } from "@/lib/format";
import { getWorkOrderDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, type WorkOrderCategory, type WorkOrderPriority, type WorkOrderSource, type WorkOrderStatus } from "@/types";

export interface WorkOrderPrefill {
  propertyId?: string | null;
  unitId?: string | null;
  assetId?: string | null;
  tenantId?: string | null;
  inspectionId?: string | null;
  inspectionItemId?: string | null;
  preventivePlanId?: string | null;
  title?: string;
  description?: string;
  category?: WorkOrderCategory;
  priority?: WorkOrderPriority;
  source?: WorkOrderSource;
  supplierId?: string | null;
  repeatOfWorkOrderId?: string | null;
}

const SUPPLIER_CATEGORY: Partial<Record<WorkOrderCategory, string>> = { plumbing: "plumbing", electrical: "electrical", hvac: "hvac", elevator: "elevator", generator: "generator", cleaning: "cleaning", security: "security", painting: "painting", pest_control: "pest_control", appliance: "appliance", structural: "general_contractor" };

/** Create or edit a work order. */
export function WorkOrderDialog({ workOrderId, prefill, onClose }: { workOrderId?: string; prefill?: WorkOrderPrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (workOrderId ? indexStore(store).workOrderById.get(workOrderId) ?? null : null), [store, workOrderId]);
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? prefill?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(existing?.unitId ?? prefill?.unitId ?? null);
  const [assetId, setAssetId] = useState<string | null>(existing?.assetId ?? prefill?.assetId ?? null);
  const [tenantId, setTenantId] = useState<string | null>(existing?.tenantId ?? prefill?.tenantId ?? null);
  const [title, setTitle] = useState(existing?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? prefill?.description ?? "");
  const [category, setCategory] = useState<WorkOrderCategory>(existing?.category ?? prefill?.category ?? "plumbing");
  const [priority, setPriority] = useState<WorkOrderPriority>(existing?.priority ?? prefill?.priority ?? "normal");
  const [source, setSource] = useState<WorkOrderSource>(existing?.source ?? prefill?.source ?? "owner");
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplierId ?? prefill?.supplierId ?? null);
  const [estimated, setEstimated] = useState<number>(existing?.estimatedCost ?? 0);
  const [approval, setApproval] = useState(existing?.approvalRequired ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && title.trim().length > 0 && estimated >= 0;

  function submit() {
    if (!valid || !propertyId) return;
    const input: WorkOrderInput = { propertyId, unitId, assetId, tenantId, title, description, category, priority, source, supplierId, estimatedCost: estimated > 0 ? estimated : null, approvalRequired: approval, notes: notes || null, inspectionId: prefill?.inspectionId ?? null, inspectionItemId: prefill?.inspectionItemId ?? null, preventivePlanId: prefill?.preventivePlanId ?? null, repeatOfWorkOrderId: prefill?.repeatOfWorkOrderId ?? null };
    try {
      if (existing) {
        const { result, undo } = run(updateWorkOrder(existing.id, { title, description, category, priority, supplierId, estimatedCost: estimated > 0 ? estimated : null, approvalRequired: approval, notes: notes || null, unitId, assetId }));
        toast.success(`${result.number} updated`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      } else {
        const { result, undo } = run(createWorkOrder(input));
        toast.success(`${result.number} opened — ${result.title}`, { description: priority === "emergency" ? "Flagged as an emergency on the dashboard and alerts." : supplierId ? "Assigned to the supplier." : "Assign a supplier to get it moving.", action: undo ? { label: "Undo", onClick: undo } : undefined });
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the work order");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.number}` : "New work order"} description={existing ? existing.title : "Report an issue on a building, unit or asset"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save changes" : "Open work order"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Issue" htmlFor="wo-title" className="sm:col-span-2"><Input id="wo-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen sink leaking" autoFocus={!existing} /></Field>
        <Field label="Details" htmlFor="wo-desc" className="sm:col-span-2"><Textarea id="wo-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was reported, where, since when…" /></Field>
        <Field label="Building" htmlFor="wo-property"><PropertySelect id="wo-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); setAssetId(null); }} disabled={!!existing} /></Field>
        <Field label="Unit (optional)" htmlFor="wo-unit"><UnitSelect id="wo-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
        <Field label="Asset (optional)" htmlFor="wo-asset"><AssetSelect id="wo-asset" propertyId={propertyId} value={assetId} onChange={setAssetId} allowNone /></Field>
        <Field label="Reported by tenant (optional)" htmlFor="wo-tenant"><TenantSelect id="wo-tenant" value={tenantId} onChange={setTenantId} allowNone currentOnly /></Field>
        <Field label="Category" htmlFor="wo-category"><EnumSelect id="wo-category" values={WORK_ORDER_CATEGORIES} value={category} onChange={(v) => v && setCategory(v)} labels={{ hvac: "HVAC" }} /></Field>
        <Field label="Priority" htmlFor="wo-priority"><EnumSelect id="wo-priority" values={WORK_ORDER_PRIORITIES} value={priority} onChange={(v) => v && setPriority(v)} /></Field>
        <Field label="Source" htmlFor="wo-source"><EnumSelect id="wo-source" values={["owner", "tenant", "inspection", "preventive", "assistant"] as const} value={source} onChange={(v) => v && setSource(v)} /></Field>
        <Field label="Supplier / technician" htmlFor="wo-supplier"><SupplierSelect id="wo-supplier" value={supplierId} onChange={setSupplierId} allowNone category={SUPPLIER_CATEGORY[category] ?? null} /></Field>
        <Field label="Estimated cost" htmlFor="wo-estimate" hint={estimated >= 500 ? "Quotes from $500 are flagged for your approval" : undefined}><MoneyInput id="wo-estimate" value={estimated} onChange={(v) => { setEstimated(v); if (v >= 500) setApproval(true); }} /></Field>
        <div className="flex items-center gap-3 self-end pb-2">
          <Switch id="wo-approval" checked={approval} onCheckedChange={setApproval} />
          <label htmlFor="wo-approval" className="text-sm">Needs my approval before work starts</label>
        </div>
        <Field label="Notes" htmlFor="wo-notes" className="sm:col-span-2"><Textarea id="wo-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </FlowDialog>
  );
}

const NEXT_LABELS: Record<WorkOrderStatus, string> = {
  open: "Reopen",
  assigned: "Assign",
  awaiting_quote: "Waiting for quote",
  awaiting_approval: "Waiting for approval",
  in_progress: "Start work",
  completed: "Complete",
  closed: "Close",
  cancelled: "Cancel",
};

/** Move a work order along its status timeline; completing asks for the cost. */
export function WorkOrderStatusDialog({ workOrderId, initial, onClose }: { workOrderId: string; initial?: WorkOrderStatus; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const d = useMemo(() => getWorkOrderDetails(store, workOrderId), [store, workOrderId]);
  const w = d?.workOrder ?? null;
  const [status, setStatus] = useState<WorkOrderStatus>(initial ?? (w?.status === "in_progress" ? "completed" : w?.status === "completed" ? "closed" : "in_progress"));
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [cost, setCost] = useState<number>(w?.actualCost ?? w?.estimatedCost ?? 0);
  const [rollPlan, setRollPlan] = useState(true);
  if (!w) return null;
  const options = WORK_ORDER_STATUSES.filter((s) => s !== w.status && canTransition(w.status, s));
  const finishing = status === "completed" || status === "closed";
  const valid = options.includes(status) && date >= w.reportedAt && (!finishing || cost >= 0);

  function submit() {
    if (!w || !valid) return;
    try {
      const { result, undo } = run(changeWorkOrderStatus({ workOrderId, status, note: note || null, date, actualCost: finishing ? cost : undefined, rollPlan }));
      toast.success(`${result.number} → ${labelize(result.status)}`, { description: finishing && cost > 0 ? `${formatMoney(cost)} recorded${w.supplierId ? " — add the invoice as an expense from the work order" : ""}.` : undefined, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the status");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`${w.number} — update status`} description={w.title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{NEXT_LABELS[status]}</Button></>}>
      <Summary rows={[["Current status", <StatusBadge key="s" value={w.status} />], ["Estimated", w.estimatedCost ? formatMoney(w.estimatedCost) : "—"], ["Supplier", d?.supplier?.name ?? "Unassigned"]]} />
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-md border p-2.5 text-left text-sm transition-colors hover:bg-accent/60", status === s && "border-primary ring-2 ring-primary/20")}>
            <StatusBadge value={s} />
            <span className="mt-1 block text-xs text-muted-foreground">{NEXT_LABELS[s]}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="ws-date"><Input id="ws-date" type="date" value={date} min={w.reportedAt} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {finishing && (
          <Field label="Actual cost" htmlFor="ws-cost" hint="Required to close the books on this job"><MoneyInput id="ws-cost" value={cost} onChange={setCost} /></Field>
        )}
        <Field label="Note" htmlFor="ws-note" className="sm:col-span-2"><Textarea id="ws-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened" /></Field>
        {finishing && w.preventivePlanId && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="ws-roll" checked={rollPlan} onCheckedChange={setRollPlan} />
            <label htmlFor="ws-roll" className="text-sm">Mark the preventive plan as serviced and schedule the next visit</label>
          </div>
        )}
      </div>
    </FlowDialog>
  );
}
