"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EnumSelect, PropertySelect, TenantSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addKey, issueKey, updateKey } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { labelize } from "@/lib/format";
import { KEY_TYPES, type KeyType } from "@/types";

/** Register or edit a key / access card. */
export function KeyDialog({ keyId, defaults, onClose }: { keyId?: string; defaults?: { propertyId?: string | null; unitId?: string | null }; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (keyId ? store.keys.find((k) => k.id === keyId) ?? null : null), [store, keyId]);
  const unitDefault = defaults?.unitId ? indexStore(store).unitById.get(defaults.unitId) : undefined;
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? unitDefault?.propertyId ?? defaults?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(existing?.unitId ?? defaults?.unitId ?? null);
  const [type, setType] = useState<KeyType>(existing?.type ?? "apartment_key");
  const [identifier, setIdentifier] = useState(existing?.identifier ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const valid = propertyId !== null && identifier.trim().length > 0;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = existing ? run(updateKey(existing.id, { unitId, type, identifier, notes: notes || null })) : run(addKey({ propertyId, unitId, type, identifier, notes: notes || null }));
      toast.success(`${labelize(result.type)} ${result.identifier} ${existing ? "updated" : "added"}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the key");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? `Edit ${existing.identifier}` : "Add key"} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>{existing ? "Save" : "Add key"}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="k-property"><PropertySelect id="k-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} disabled={!!existing} /></Field>
        <Field label="Unit (optional)" htmlFor="k-unit"><UnitSelect id="k-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
        <Field label="Type" htmlFor="k-type"><EnumSelect id="k-type" values={KEY_TYPES} value={type} onChange={(v) => v && setType(v)} /></Field>
        <Field label="Label / number" htmlFor="k-id"><Input id="k-id" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="B304-1, Card 0117…" autoFocus={!existing} /></Field>
        <Field label="Notes" htmlFor="k-notes" className="sm:col-span-2"><Textarea id="k-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}

/** Hand a key to a tenant, contractor or staff member. */
export function IssueKeyDialog({ keyId, defaultTenantId, onClose }: { keyId: string; defaultTenantId?: string | null; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const key = useMemo(() => store.keys.find((k) => k.id === keyId) ?? null, [store, keyId]);
  const occupant = useMemo(() => {
    if (!key?.unitId) return null;
    const c = store.contracts.find((x) => x.unitId === key.unitId && (x.status === "active" || x.status === "notice_given"));
    return c ? indexStore(store).tenantById.get(c.tenantId) ?? null : null;
  }, [store, key]);
  const [tenantId, setTenantId] = useState<string | null>(defaultTenantId ?? occupant?.id ?? null);
  const [assignedTo, setAssignedTo] = useState("");
  const [date, setDate] = useState(today());
  if (!key) return null;
  const tenant = tenantId ? indexStore(store).tenantById.get(tenantId) ?? null : null;
  const valid = (tenantId !== null || assignedTo.trim().length > 0) && date.length === 10 && date <= today();

  function submit() {
    if (!valid || !key) return;
    try {
      const { result, undo } = run(issueKey(key.id, { assignedTo: assignedTo || tenant?.fullName || "", tenantId, date }));
      toast.success(`${labelize(result.type)} ${result.identifier} issued to ${result.assignedTo}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not issue the key");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`Issue ${labelize(key.type).toLowerCase()} ${key.identifier}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Issue</Button></>}>
      <Summary rows={[["Building", indexStore(store).propertyById.get(key.propertyId)?.name ?? "—"], ["Unit", key.unitId ? indexStore(store).unitById.get(key.unitId)?.unitNumber ?? "—" : "Building key"], ["Status", labelize(key.status)]]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tenant" htmlFor="ik-tenant" hint={occupant ? `Occupant: ${occupant.fullName}` : undefined}><TenantSelect id="ik-tenant" value={tenantId} onChange={setTenantId} allowNone currentOnly /></Field>
        <Field label="Or someone else" htmlFor="ik-who"><Input id="ik-who" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Contractor, cleaner, staff…" /></Field>
        <Field label="Issued on" htmlFor="ik-date"><Input id="ik-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </FlowDialog>
  );
}
