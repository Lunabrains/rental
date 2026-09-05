"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AssetSelect, EnumSelect, PropertySelect, SupplierSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addAsset, addPreventivePlan, logService, updateAsset, updatePreventivePlan } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { addMonthsISO, today } from "@/lib/date";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { planRow } from "@/lib/queries";
import { ASSET_STATUSES, ASSET_TYPES, type AssetStatus, type AssetType } from "@/types";

export interface AssetPrefill {
  propertyId?: string | null;
  unitId?: string | null;
  name?: string;
  assetType?: AssetType;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  purchaseCost?: number;
  installationDate?: string;
  warrantyExpiry?: string;
}

/** Register or edit a building asset. */
export function AssetDialog({ assetId, defaultPropertyId, prefill, onClose }: { assetId?: string; defaultPropertyId?: string | null; prefill?: AssetPrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (assetId ? indexStore(store).assetById.get(assetId) ?? null : null), [store, assetId]);
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? prefill?.propertyId ?? defaultPropertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(existing?.unitId ?? prefill?.unitId ?? null);
  const [assetType, setAssetType] = useState<AssetType>(existing?.assetType ?? prefill?.assetType ?? "elevator");
  const [name, setName] = useState(existing?.name ?? prefill?.name ?? "");
  const [manufacturer, setManufacturer] = useState(existing?.manufacturer ?? prefill?.manufacturer ?? "");
  const [model, setModel] = useState(existing?.model ?? prefill?.model ?? "");
  const [serial, setSerial] = useState(existing?.serialNumber ?? prefill?.serialNumber ?? "");
  const [installed, setInstalled] = useState(existing?.installationDate ?? prefill?.installationDate ?? "");
  const [cost, setCost] = useState(existing?.purchaseCost ?? prefill?.purchaseCost ?? 0);
  const [warranty, setWarranty] = useState(existing?.warrantyExpiry ?? prefill?.warrantyExpiry ?? "");
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplierId ?? null);
  const [status, setStatus] = useState<AssetStatus>(existing?.status ?? "operational");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && name.trim().length > 0 && cost >= 0;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const fields = { unitId, assetType, name, manufacturer: manufacturer || null, model: model || null, serialNumber: serial || null, installationDate: installed || null, purchaseCost: cost > 0 ? cost : null, warrantyExpiry: warranty || null, supplierId, status, notes: notes || null };
      const { result, undo } = existing ? run(updateAsset(existing.id, fields)) : run(addAsset({ propertyId, ...fields }));
      toast.success(`${existing ? "Asset updated" : "Asset registered"} — ${result.name}`, { description: existing ? undefined : `QR label ${result.qrCode} is ready to print.`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the asset");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.name}` : "Register asset"} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Register"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="as-property"><PropertySelect id="as-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} disabled={!!existing} /></Field>
        <Field label="Unit (optional)" htmlFor="as-unit"><UnitSelect id="as-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
        <Field label="Type" htmlFor="as-type"><EnumSelect id="as-type" values={ASSET_TYPES} value={assetType} onChange={(v) => v && setAssetType(v)} labels={{ hvac: "HVAC", cctv: "CCTV" }} /></Field>
        <Field label="Name" htmlFor="as-name"><Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Elevator 1" autoFocus={!existing} /></Field>
        <Field label="Manufacturer" htmlFor="as-manufacturer"><Input id="as-manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></Field>
        <Field label="Model" htmlFor="as-model"><Input id="as-model" value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="Serial number" htmlFor="as-serial"><Input id="as-serial" value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
        <Field label="Status" htmlFor="as-status"><EnumSelect id="as-status" values={ASSET_STATUSES} value={status} onChange={(v) => v && setStatus(v)} /></Field>
        <Field label="Installed" htmlFor="as-installed"><Input id="as-installed" type="date" value={installed} onChange={(e) => setInstalled(e.target.value)} /></Field>
        <Field label="Purchase cost" htmlFor="as-cost"><MoneyInput id="as-cost" value={cost} onChange={setCost} /></Field>
        <Field label="Warranty expiry" htmlFor="as-warranty" hint="Raises an alert before it lapses"><Input id="as-warranty" type="date" value={warranty} onChange={(e) => setWarranty(e.target.value)} /></Field>
        <Field label="Preferred supplier" htmlFor="as-supplier"><SupplierSelect id="as-supplier" value={supplierId} onChange={setSupplierId} allowNone /></Field>
        <Field label="Notes" htmlFor="as-notes" className="sm:col-span-2"><Textarea id="as-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/** Add or edit a preventive maintenance plan. */
export function PlanDialog({ planId, defaults, onClose }: { planId?: string; defaults?: { propertyId?: string | null; assetId?: string | null }; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (planId ? indexStore(store).planById.get(planId) ?? null : null), [store, planId]);
  const defaultAsset = defaults?.assetId ? indexStore(store).assetById.get(defaults.assetId) : undefined;
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? defaultAsset?.propertyId ?? defaults?.propertyId ?? store.properties[0]?.id ?? null);
  const [assetId, setAssetId] = useState<string | null>(existing?.assetId ?? defaults?.assetId ?? null);
  const [type, setType] = useState(existing?.maintenanceType ?? "");
  const [months, setMonths] = useState(existing?.recurrenceMonths ?? 3);
  const [last, setLast] = useState(existing?.lastServiceDate ?? "");
  const [next, setNext] = useState(existing?.nextServiceDate ?? addMonthsISO(today(), 1));
  const [supplierId, setSupplierId] = useState<string | null>(existing?.supplierId ?? defaultAsset?.supplierId ?? null);
  const [cost, setCost] = useState(existing?.estimatedCost ?? 0);
  const [reminder, setReminder] = useState(existing?.reminderDays ?? 14);
  const [active, setActive] = useState(existing ? existing.status === "active" : true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && type.trim().length > 0 && months >= 1 && next.length === 10;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const fields = { assetId, maintenanceType: type, recurrenceMonths: months, lastServiceDate: last || null, nextServiceDate: next, supplierId, estimatedCost: cost > 0 ? cost : null, reminderDays: reminder, notes: notes || null };
      const { result, undo } = existing ? run(updatePreventivePlan(existing.id, { ...fields, status: active ? "active" : "paused" })) : run(addPreventivePlan({ propertyId, ...fields }));
      toast.success(`${existing ? "Plan updated" : "Plan added"} — ${result.maintenanceType} every ${result.recurrenceMonths} months`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the plan");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit preventive plan" : "New preventive plan"} description="Recurring service with a due date, reminder and preferred supplier" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Add plan"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="pl-property"><PropertySelect id="pl-property" value={propertyId} onChange={(id) => { setPropertyId(id); setAssetId(null); }} disabled={!!existing} /></Field>
        <Field label="Asset (optional)" htmlFor="pl-asset"><AssetSelect id="pl-asset" propertyId={propertyId} value={assetId} onChange={setAssetId} allowNone /></Field>
        <Field label="Service" htmlFor="pl-type" className="sm:col-span-2"><Input id="pl-type" value={type} onChange={(e) => setType(e.target.value)} placeholder="Elevator service, tank cleaning, fire system inspection…" autoFocus={!existing} /></Field>
        <Field label="Every (months)" htmlFor="pl-months"><Input id="pl-months" type="number" min={1} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="tabular" /></Field>
        <Field label="Reminder (days before)" htmlFor="pl-reminder"><Input id="pl-reminder" type="number" min={0} value={reminder} onChange={(e) => setReminder(Number(e.target.value))} className="tabular" /></Field>
        <Field label="Last done" htmlFor="pl-last"><Input id="pl-last" type="date" value={last} onChange={(e) => setLast(e.target.value)} /></Field>
        <Field label="Next due" htmlFor="pl-next"><Input id="pl-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Preferred supplier" htmlFor="pl-supplier"><SupplierSelect id="pl-supplier" value={supplierId} onChange={setSupplierId} allowNone /></Field>
        <Field label="Estimated cost per service" htmlFor="pl-cost"><MoneyInput id="pl-cost" value={cost} onChange={setCost} /></Field>
        {existing && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch id="pl-active" checked={active} onCheckedChange={setActive} />
            <label htmlFor="pl-active" className="text-sm">Active — paused plans raise no alerts</label>
          </div>
        )}
        <Field label="Notes" htmlFor="pl-notes" className="sm:col-span-2"><Textarea id="pl-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/** Record that a planned service happened: rolls the plan forward and books the cost. */
export function LogServiceDialog({ planId, onClose }: { planId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const row = useMemo(() => {
    const p = indexStore(store).planById.get(planId);
    return p ? planRow(store, p) : null;
  }, [store, planId]);
  const [date, setDate] = useState(today());
  const [cost, setCost] = useState(row?.plan.estimatedCost ?? 0);
  const [supplierId, setSupplierId] = useState<string | null>(row?.supplier?.id ?? null);
  const [book, setBook] = useState(true);
  const [note, setNote] = useState("");
  if (!row) return null;

  function submit() {
    if (!row) return;
    try {
      const { result, undo } = run(logService({ planId, date, cost: cost > 0 ? cost : null, supplierId, note: note || null, bookExpense: book }));
      toast.success(`${result.maintenanceType} logged — next due ${formatDate(result.nextServiceDate)}`, { description: book && cost > 0 ? `${formatMoney(cost)} booked as an expense.` : undefined, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log the service");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`Log service — ${row.plan.maintenanceType}`} description={`${row.asset?.name ?? row.property.name} · every ${row.plan.recurrenceMonths} months`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={date > today()}>Log service</Button></>}>
      <Summary rows={[["Was due", `${formatDate(row.plan.nextServiceDate)} (${row.state === "overdue" ? `${Math.abs(row.daysUntil)} days late` : labelize(row.state)})`], ["Last done", formatDate(row.plan.lastServiceDate)], ["Next after this", formatDate(addMonthsISO(date, row.plan.recurrenceMonths))]]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service date" htmlFor="ls-date"><Input id="ls-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Cost" htmlFor="ls-cost" hint={row.plan.estimatedCost ? `Estimated ${formatMoney(row.plan.estimatedCost)}` : undefined}><MoneyInput id="ls-cost" value={cost} onChange={setCost} /></Field>
        <Field label="Supplier" htmlFor="ls-supplier"><SupplierSelect id="ls-supplier" value={supplierId} onChange={setSupplierId} allowNone /></Field>
        <div className="flex items-center gap-3 self-end pb-2">
          <Switch id="ls-book" checked={book} onCheckedChange={setBook} />
          <label htmlFor="ls-book" className="text-sm">Book the cost as an expense</label>
        </div>
        <Field label="Note" htmlFor="ls-note" className="sm:col-span-2"><Textarea id="ls-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Findings, parts replaced…" /></Field>
      </div>
    </FlowDialog>
  );
}
