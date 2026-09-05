"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EnumSelect, PropertySelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addParkingSpace, assignParking, updateParkingSpace } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { formatMoney } from "@/lib/format";
import { PARKING_STATUSES, type ParkingStatus } from "@/types";

/** Add or edit a parking space. */
export function ParkingSpaceDialog({ spaceId, defaultPropertyId, onClose }: { spaceId?: string; defaultPropertyId?: string | null; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (spaceId ? store.parking.find((p) => p.id === spaceId) ?? null : null), [store, spaceId]);
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? defaultPropertyId ?? store.properties[0]?.id ?? null);
  const [number, setNumber] = useState(existing?.spaceNumber ?? "");
  const [fee, setFee] = useState(existing?.monthlyFee ?? 0);
  const [paid, setPaid] = useState(existing?.paid ?? false);
  const [status, setStatus] = useState<ParkingStatus>(existing?.status === "assigned" ? "assigned" : existing?.status ?? "free");
  const [plate, setPlate] = useState(existing?.vehiclePlate ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && number.trim().length > 0 && fee >= 0;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = existing
        ? run(updateParkingSpace(existing.id, { spaceNumber: number, monthlyFee: fee, paid, status, vehiclePlate: plate || null, notes: notes || null }))
        : run(addParkingSpace({ propertyId, spaceNumber: number, monthlyFee: fee, status: status === "assigned" ? "free" : status, notes: notes || null }));
      toast.success(`Parking ${result.spaceNumber} ${existing ? "updated" : "added"}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the space");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit space ${existing.spaceNumber}` : "Add parking space"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Add space"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="pk-property"><PropertySelect id="pk-property" value={propertyId} onChange={setPropertyId} disabled={!!existing} /></Field>
        <Field label="Space number" htmlFor="pk-number"><Input id="pk-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="P-12" autoFocus={!existing} /></Field>
        <Field label="Monthly fee" htmlFor="pk-fee" hint="0 when included in the rent"><MoneyInput id="pk-fee" value={fee} onChange={(v) => { setFee(v); if (v > 0) setPaid(true); }} /></Field>
        <Field label="Status" htmlFor="pk-status"><EnumSelect id="pk-status" values={existing?.status === "assigned" ? PARKING_STATUSES : PARKING_STATUSES.filter((s) => s !== "assigned")} value={status} onChange={(v) => v && setStatus(v)} /></Field>
        {existing && (
          <>
            <Field label="Vehicle plate" htmlFor="pk-plate"><Input id="pk-plate" value={plate} onChange={(e) => setPlate(e.target.value)} /></Field>
            <div className="flex items-center gap-3 self-end pb-2">
              <Switch id="pk-paid" checked={paid} onCheckedChange={setPaid} />
              <label htmlFor="pk-paid" className="text-sm">Charged separately</label>
            </div>
          </>
        )}
        <Field label="Notes" htmlFor="pk-notes" className="sm:col-span-2"><Textarea id="pk-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/** Assign a free space to a unit or tenant. */
export function AssignParkingDialog({ spaceId, onClose }: { spaceId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const space = useMemo(() => store.parking.find((p) => p.id === spaceId) ?? null, [store, spaceId]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [fee, setFee] = useState(space?.monthlyFee ?? 0);
  const [paid, setPaid] = useState((space?.monthlyFee ?? 0) > 0);
  if (!space) return null;
  const idx = indexStore(store);
  const occupant = unitId ? store.contracts.find((c) => c.unitId === unitId && (c.status === "active" || c.status === "notice_given")) : null;
  const occupantName = occupant ? idx.tenantById.get(occupant.tenantId)?.fullName ?? null : null;
  const valid = (unitId !== null || tenantId !== null) && fee >= 0;

  function submit() {
    if (!valid || !space) return;
    try {
      const { result, undo } = run(assignParking(space.id, { unitId, tenantId, vehiclePlate: plate || null, paid, monthlyFee: fee }));
      toast.success(`Parking ${result.spaceNumber} assigned`, { description: result.paid && result.monthlyFee > 0 ? `${formatMoney(result.monthlyFee)}/month — add it to the rent roll as a common charge if billed separately.` : "Included in the rent.", action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign the space");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`Assign space ${space.spaceNumber}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Assign</Button></>}>
      <Summary rows={[["Building", idx.propertyById.get(space.propertyId)?.name ?? "—"], ["Current status", space.status], ["List fee", space.monthlyFee > 0 ? `${formatMoney(space.monthlyFee)}/month` : "Included"]]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit" htmlFor="ap-unit" hint={occupantName ? `Occupant: ${occupantName}` : undefined}><UnitSelect id="ap-unit" propertyId={space.propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
        <Field label="Tenant (optional)" htmlFor="ap-tenant"><TenantSelect id="ap-tenant" value={tenantId} onChange={setTenantId} allowNone currentOnly /></Field>
        <Field label="Vehicle plate" htmlFor="ap-plate"><Input id="ap-plate" value={plate} onChange={(e) => setPlate(e.target.value)} /></Field>
        <Field label="Monthly fee" htmlFor="ap-fee"><MoneyInput id="ap-fee" value={fee} onChange={(v) => { setFee(v); setPaid(v > 0); }} /></Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="ap-paid" checked={paid} onCheckedChange={setPaid} />
          <label htmlFor="ap-paid" className="text-sm">Charged separately from the rent</label>
        </div>
      </div>
    </FlowDialog>
  );
}
