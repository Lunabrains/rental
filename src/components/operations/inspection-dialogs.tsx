"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AssetSelect, EnumSelect, PropertySelect, UnitSelect } from "@/components/common/entity-select";
import { StatusBadge } from "@/components/common/status-badge";
import { Field, FlowDialog, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CHECKLIST_TEMPLATES, completeInspection, deriveOverallResult, scheduleInspection, startMoveIn, startMoveOut } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, labelize } from "@/lib/format";
import { INSPECTION_TYPES, type InspectionResult, type InspectionType } from "@/types";

export interface InspectionPrefill {
  propertyId?: string | null;
  unitId?: string | null;
  assetId?: string | null;
  /** When set, the inspection is bound to this contract (move-in / move-out checklists). */
  contractId?: string | null;
  type?: InspectionType;
  scheduledDate?: string;
}

/** Schedule an inspection from a checklist template. */
export function ScheduleInspectionDialog({ prefill, onClose, onScheduled }: { prefill?: InspectionPrefill; onClose: () => void; onScheduled?: (id: string) => void }) {
  const { store, run } = useStoreContext();
  const idx = indexStore(store);
  const contract = prefill?.contractId ? idx.contractById.get(prefill.contractId) ?? null : null;
  const [type, setType] = useState<InspectionType>(prefill?.type ?? (contract ? "move_out" : prefill?.assetId ? "asset" : prefill?.unitId ? "annual_unit" : "building"));
  const [propertyId, setPropertyId] = useState<string | null>(contract?.propertyId ?? prefill?.propertyId ?? (prefill?.assetId ? idx.assetById.get(prefill.assetId)?.propertyId ?? null : null) ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(contract?.unitId ?? prefill?.unitId ?? null);
  const [assetId, setAssetId] = useState<string | null>(prefill?.assetId ?? null);
  const [date, setDate] = useState(prefill?.scheduledDate ?? (contract && type === "move_out" ? contract.moveOutDate ?? contract.endDate : contract && type === "move_in" ? contract.startDate : today()));
  const [inspector, setInspector] = useState(store.settings.ownerName || "");
  const [notes, setNotes] = useState("");
  const needsUnit = type === "move_in" || type === "move_out" || type === "annual_unit";
  const template = CHECKLIST_TEMPLATES[type];
  const valid = propertyId !== null && inspector.trim().length > 0 && date.length === 10 && (!needsUnit || unitId !== null) && (type !== "asset" || assetId !== null);
  const tenant = useMemo(() => {
    if (contract) return idx.tenantById.get(contract.tenantId) ?? null;
    if (!unitId) return null;
    const c = store.contracts.find((x) => x.unitId === unitId && (x.status === "active" || x.status === "notice_given"));
    return c ? idx.tenantById.get(c.tenantId) ?? null : null;
  }, [contract, unitId, store, idx]);

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const cmd = contract && type === "move_out" ? startMoveOut(contract.id, { scheduledDate: date, inspector }) : contract && type === "move_in" ? startMoveIn(contract.id, { scheduledDate: date, inspector }) : scheduleInspection({ propertyId, unitId, assetId: type === "asset" ? assetId : null, contractId: contract?.id ?? null, type, scheduledDate: date, inspector, notes: notes || null });
      const { result, undo } = run(cmd);
      toast.success(`${labelize(result.type)} inspection scheduled for ${formatDate(result.scheduledDate)}`, { description: `${result.items.length} checklist items · ${result.inspector}`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      onScheduled?.(result.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not schedule the inspection");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={contract ? `${type === "move_out" ? "Move-out" : "Move-in"} checklist${tenant ? ` — ${tenant.fullName}` : ""}` : "Schedule inspection"} description={contract ? "Condition report, keys, closing readings and the deposit — all linked to the contract" : "Pick the type; the checklist is prepared from the template and can be edited on the inspection"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Schedule</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="in-type"><EnumSelect id="in-type" values={contract ? (["move_in", "move_out"] as const) : INSPECTION_TYPES} value={type} onChange={(v) => { if (v) { setType(v); if (contract) setDate(v === "move_out" ? contract.moveOutDate ?? contract.endDate : contract.startDate); } }} /></Field>
        <Field label="Date" htmlFor="in-date"><Input id="in-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Building" htmlFor="in-property"><PropertySelect id="in-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); setAssetId(null); }} disabled={!!contract} /></Field>
        {type === "asset" ? (
          <Field label="Asset" htmlFor="in-asset"><AssetSelect id="in-asset" propertyId={propertyId} value={assetId} onChange={setAssetId} /></Field>
        ) : (
          <Field label={needsUnit ? "Unit" : "Unit (optional)"} htmlFor="in-unit"><UnitSelect id="in-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone={!needsUnit} disabled={!!contract} /></Field>
        )}
        <Field label="Inspector" htmlFor="in-inspector"><Input id="in-inspector" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="Who walks through" /></Field>
        <Field label="Notes" htmlFor="in-notes"><Input id="in-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Access arrangements, focus areas…" /></Field>
      </div>
      {tenant && <p className="mt-3 text-xs text-muted-foreground">Linked to {tenant.fullName}{contract ? ` · contract ${formatDate(contract.startDate)} → ${formatDate(contract.moveOutDate ?? contract.endDate)}` : ""}.</p>}
      <div className="mt-4 rounded-md border">
        <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Checklist template · {template.length} items</p>
        <ul className="grid gap-x-4 px-3 py-2 text-xs sm:grid-cols-2">
          {template.map((t) => (
            <li key={`${t.area}-${t.item}`} className="truncate py-0.5"><span className="text-muted-foreground">{t.area} ·</span> {t.item}</li>
          ))}
        </ul>
      </div>
    </FlowDialog>
  );
}

/** Close an inspection: date, overall result (derived, can be overridden) and closing notes. */
export function CompleteInspectionDialog({ inspectionId, onClose }: { inspectionId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const inspection = useMemo(() => store.inspections.find((i) => i.id === inspectionId) ?? null, [store, inspectionId]);
  const derived = inspection ? deriveOverallResult(inspection.items) : null;
  const [date, setDate] = useState(today());
  const [result, setResult] = useState<InspectionResult>(derived ?? "pass");
  const [notes, setNotes] = useState(inspection?.notes ?? "");
  if (!inspection) return null;
  const unrecorded = inspection.items.filter((it) => it.result === "na").length;
  const failed = inspection.items.filter((it) => it.result === "fail");
  const followUps = inspection.items.filter((it) => it.followUpRequired && !it.workOrderId).length;

  function submit() {
    try {
      const { result: done, undo } = run(completeInspection(inspectionId, { completedDate: date, overallResult: result, notes: notes || null }));
      toast.success(`${labelize(done.type)} inspection completed — ${labelize(done.overallResult ?? "pass")}`, { description: followUps > 0 ? `${followUps} item${followUps === 1 ? "" : "s"} still need a work order.` : undefined, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete the inspection");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title="Complete inspection" description={`${labelize(inspection.type)} · ${inspection.items.length - unrecorded} of ${inspection.items.length} items recorded`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={date > today()}>Complete</Button></>}>
      <Summary rows={[["Suggested result", derived ? labelize(derived) : "Nothing recorded yet"], ["Failed items", failed.length > 0 ? failed.map((f) => f.item).slice(0, 3).join(", ") + (failed.length > 3 ? "…" : "") : "None"], ["Follow-ups without work order", String(followUps)]]} />
      {unrecorded > 0 && <p className="mb-3 text-xs text-warning-foreground">{unrecorded} item{unrecorded === 1 ? " is" : "s are"} still unrecorded and will be ignored in the result.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Completed on" htmlFor="ci-date"><Input id="ci-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Overall result" htmlFor="ci-result">
          <div className="flex h-9 items-center gap-1">
            {(["pass", "attention", "fail"] as const).map((r) => (
              <button key={r} type="button" onClick={() => setResult(r)} className={result === r ? "rounded-md ring-2 ring-ring" : "opacity-60 hover:opacity-100"} aria-pressed={result === r}>
                <StatusBadge value={r} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Closing notes" htmlFor="ci-notes" className="sm:col-span-2"><Textarea id="ci-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Summary for the file — what was found, what was agreed" /></Field>
      </div>
    </FlowDialog>
  );
}
