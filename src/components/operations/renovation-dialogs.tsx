"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EnumSelect, PropertySelect, SupplierSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { completeRenovation, createRenovation, updateRenovation } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { addMonthsISO, today } from "@/lib/date";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { RENOVATION_TYPES, UNIT_CONDITIONS, type RenovationType, type UnitCondition } from "@/types";

export interface RenovationPrefill {
  propertyId?: string | null;
  unitId?: string | null;
  title?: string;
  projectType?: RenovationType;
}

/** Create or edit a renovation / CapEx project. */
export function RenovationDialog({ renovationId, prefill, onClose, onCreated }: { renovationId?: string; prefill?: RenovationPrefill; onClose: () => void; onCreated?: (id: string) => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (renovationId ? indexStore(store).renovationById.get(renovationId) ?? null : null), [store, renovationId]);
  const unitDefault = prefill?.unitId ? indexStore(store).unitById.get(prefill.unitId) : undefined;
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? unitDefault?.propertyId ?? prefill?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(existing?.unitId ?? prefill?.unitId ?? null);
  const [title, setTitle] = useState(existing?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [projectType, setProjectType] = useState<RenovationType>(existing?.projectType ?? prefill?.projectType ?? "renovation");
  const [budget, setBudget] = useState(existing?.budget ?? 0);
  const [contractorId, setContractorId] = useState<string | null>(existing?.contractorSupplierId ?? null);
  const [start, setStart] = useState(existing?.startDate ?? today());
  const [end, setEnd] = useState(existing?.targetEndDate ?? addMonthsISO(today(), 1));
  const [tasks, setTasks] = useState("");
  const [markUnit, setMarkUnit] = useState(true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && title.trim().length > 0 && budget >= 0 && start.length === 10 && end.length === 10 && end >= start;
  const unit = unitId ? indexStore(store).unitById.get(unitId) : null;
  const unitVacant = unit ? !store.contracts.some((c) => c.unitId === unit.id && (c.status === "active" || c.status === "notice_given")) : false;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = existing
        ? run(updateRenovation(existing.id, { title, description, projectType, budget, contractorSupplierId: contractorId, startDate: start, targetEndDate: end, notes: notes || null }))
        : run(createRenovation({ propertyId, unitId, title, description, projectType, budget, contractorSupplierId: contractorId, startDate: start, targetEndDate: end, tasks: tasks.split(/\n|\|/).map((t) => ({ title: t.trim() })).filter((t) => t.title), notes: notes || null, markUnit: markUnit && unitVacant }));
      toast.success(`${result.title} ${existing ? "updated" : labelize(result.status).toLowerCase()}`, { description: existing ? undefined : `Budget ${formatMoney(result.budget)} · ${formatDate(result.startDate)} → ${formatDate(result.targetEndDate)}`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
      if (!existing) onCreated?.(result.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the project");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.title}` : "New renovation / CapEx project"} description={existing ? undefined : "Budget, dates, contractor and a task list — costs are booked as CapEx expenses against the project"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Create project"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="rn-title" className="sm:col-span-2"><Input id="rn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen and bathroom refit" autoFocus={!existing} /></Field>
        <Field label="Building" htmlFor="rn-property"><PropertySelect id="rn-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} disabled={!!existing} /></Field>
        <Field label="Unit (optional)" htmlFor="rn-unit" hint={unit ? (unitVacant ? "Vacant — can be flagged as under renovation" : "Occupied — works around the tenant") : "Leave empty for building-wide works"}><UnitSelect id="rn-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone disabled={!!existing} /></Field>
        <Field label="Type" htmlFor="rn-type"><EnumSelect id="rn-type" values={RENOVATION_TYPES} value={projectType} onChange={(v) => v && setProjectType(v)} /></Field>
        <Field label="Budget" htmlFor="rn-budget"><MoneyInput id="rn-budget" value={budget} onChange={setBudget} /></Field>
        <Field label="Start" htmlFor="rn-start"><Input id="rn-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Target end" htmlFor="rn-end"><Input id="rn-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Contractor" htmlFor="rn-contractor"><SupplierSelect id="rn-contractor" value={contractorId} onChange={setContractorId} allowNone /></Field>
        <Field label="Description" htmlFor="rn-desc"><Input id="rn-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope in one line" /></Field>
        {!existing && <Field label="Tasks" htmlFor="rn-tasks" hint="One per line" className="sm:col-span-2"><Textarea id="rn-tasks" rows={3} value={tasks} onChange={(e) => setTasks(e.target.value)} placeholder={"Demolition\nPlumbing rough-in\nTiling\nFinal clean"} /></Field>}
        {!existing && unit && unitVacant && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="rn-mark" checked={markUnit} onCheckedChange={setMarkUnit} />
            <label htmlFor="rn-mark" className="text-sm">Flag unit {unit.unitNumber} as under renovation while the works run</label>
          </div>
        )}
        <Field label="Notes" htmlFor="rn-notes" className="sm:col-span-2"><Textarea id="rn-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/** Close a project: actual end date, unit condition and the new asking rent. */
export function CompleteRenovationDialog({ renovationId, onClose }: { renovationId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const r = useMemo(() => indexStore(store).renovationById.get(renovationId) ?? null, [store, renovationId]);
  const unit = r?.unitId ? indexStore(store).unitById.get(r.unitId) ?? null : null;
  const [date, setDate] = useState(today());
  const [condition, setCondition] = useState<UnitCondition | null>(unit ? "good" : null);
  const [rent, setRent] = useState(unit?.marketRent ?? 0);
  const [notes, setNotes] = useState("");
  if (!r) return null;
  const open = r.tasks.filter((t) => !t.done).length;

  function submit() {
    if (!r) return;
    try {
      const { result, undo } = run(completeRenovation(r.id, { actualEndDate: date, notes: notes || null, unitCondition: unit ? condition : null, marketRent: unit ? rent : null }));
      toast.success(`${result.title} completed`, { description: `${formatMoney(result.actualCost)} spent vs ${formatMoney(result.budget)} budget`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not complete the project");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`Complete — ${r.title}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={date > today() || date < r.startDate}>Complete project</Button></>}>
      <Summary rows={[["Spent", `${formatMoney(r.actualCost)} of ${formatMoney(r.budget)}${r.budget > 0 ? ` (${r.actualCost > r.budget ? "+" : ""}${Math.round(((r.actualCost - r.budget) / r.budget) * 100)}%)` : ""}`], ["Target end", formatDate(r.targetEndDate)], ["Open tasks", open > 0 ? `${open} — will be marked done` : "None"]]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Finished on" htmlFor="cr-date"><Input id="cr-date" type="date" value={date} min={r.startDate} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        {unit && <Field label={`Unit ${unit.unitNumber} condition`} htmlFor="cr-condition"><EnumSelect id="cr-condition" values={UNIT_CONDITIONS} value={condition} onChange={setCondition} /></Field>}
        {unit && <Field label="New asking rent" htmlFor="cr-rent" hint={`Was ${formatMoney(unit.marketRent ?? 0)} · drives the return estimate`}><MoneyInput id="cr-rent" value={rent} onChange={setRent} /></Field>}
        <Field label="Closing notes" htmlFor="cr-notes" className="sm:col-span-2"><Textarea id="cr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was delivered, snags, warranties" /></Field>
      </div>
    </FlowDialog>
  );
}
