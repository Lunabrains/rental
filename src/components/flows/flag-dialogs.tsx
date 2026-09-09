"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { clearVacateUndertaking, openComplaint, recordVacateUndertaking, resolveComplaint } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatDate } from "@/lib/format";

export const VACATE_LABEL = "تعهد بالإخلاء";

export interface ComplaintPrefill {
  summary?: string;
  openedOn?: string;
}

export interface VacatePrefill {
  vacateBy?: string;
  signedOn?: string;
  notes?: string;
}

/** Open, update or resolve the complaint on a tenant — the red square on the grid. */
export function ComplaintDialog({ tenantId, prefill, onClose }: { tenantId: string; prefill?: ComplaintPrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const tenant = useMemo(() => indexStore(store).tenantById.get(tenantId) ?? null, [store, tenantId]);
  const existing = tenant?.complaint ?? null;
  const [summary, setSummary] = useState(prefill?.summary ?? existing?.summary ?? "");
  const [openedOn, setOpenedOn] = useState(prefill?.openedOn ?? existing?.openedOn ?? today());
  const [resolution, setResolution] = useState("");
  if (!tenant) return null;
  const where = (() => {
    const c = store.contracts.find((x) => x.tenantId === tenant.id && isOccupying(x));
    const u = c ? indexStore(store).unitById.get(c.unitId) : null;
    const p = u ? indexStore(store).propertyById.get(u.propertyId) : null;
    return u && p ? `${p.name} · ${u.unitNumber}` : "No current unit";
  })();

  function save() {
    try {
      const { undo } = run(openComplaint(tenant!.id, { summary, openedOn }));
      toast.success(`${existing ? "Complaint updated" : "Complaint opened"} — ${tenant!.fullName}`, { description: "The unit shows red on the building grid until it is resolved.", action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the complaint");
    }
  }

  function resolve() {
    try {
      const { undo } = run(resolveComplaint(tenant!.id, resolution));
      toast.success(`Complaint resolved — ${tenant!.fullName}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve the complaint");
    }
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `Complaint — ${tenant.fullName}` : `Open a complaint — ${tenant.fullName}`}
      description={where}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {existing && (
            <Button variant="outline" onClick={resolve}>
              Mark resolved
            </Button>
          )}
          <Button onClick={save} disabled={summary.trim().length === 0}>
            {existing ? "Update" : "Open complaint"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Opened on" htmlFor="cp-date">
          <Input id="cp-date" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        </Field>
        <Field label="What the complaint is about" htmlFor="cp-summary" hint="One or two lines — the details can go in the tenant notes">
          <Textarea id="cp-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Disputes the late fee; says the AC repair is still pending" autoFocus={!existing} />
        </Field>
        {existing && (
          <Field label="Resolution (optional, kept in the tenant notes)" htmlFor="cp-res">
            <Input id="cp-res" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Fee waived; repair done on 12 Sep" />
          </Field>
        )}
      </div>
    </FlowDialog>
  );
}

/** تعهد بالإخلاء — record or withdraw the tenant's signed undertaking to vacate; the orange square on the grid. */
export function VacateDialog({ contractId, prefill, onClose }: { contractId: string; prefill?: VacatePrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const idx = indexStore(store);
  const contract = idx.contractById.get(contractId) ?? null;
  const existing = contract?.vacateUndertaking ?? null;
  const [signedOn, setSignedOn] = useState(prefill?.signedOn ?? existing?.signedOn ?? today());
  const [vacateBy, setVacateBy] = useState(prefill?.vacateBy ?? existing?.vacateBy ?? contract?.endDate ?? "");
  const [notes, setNotes] = useState(prefill?.notes ?? existing?.notes ?? "");
  if (!contract) return null;
  const tenant = idx.tenantById.get(contract.tenantId);
  const unit = idx.unitById.get(contract.unitId);
  const property = unit ? idx.propertyById.get(unit.propertyId) : null;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(vacateBy) && /^\d{4}-\d{2}-\d{2}$/.test(signedOn) && vacateBy >= signedOn;

  function save() {
    try {
      const { undo } = run(recordVacateUndertaking(contract!.id, { signedOn, vacateBy, notes: notes || null }));
      toast.success(`${VACATE_LABEL} recorded — ${tenant?.fullName ?? "Tenant"}`, { description: `Vacating by ${formatDate(vacateBy)}. The unit shows orange on the building grid.`, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the undertaking");
    }
  }

  function clear() {
    try {
      const { undo } = run(clearVacateUndertaking(contract!.id));
      toast.success("Undertaking withdrawn", { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw the undertaking");
    }
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${VACATE_LABEL} · Undertaking to vacate`}
      description={`${tenant?.fullName ?? "Tenant"} · ${property?.name ?? ""} ${unit?.unitNumber ?? ""} · contract ends ${formatDate(contract.endDate)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {existing && (
            <Button variant="outline" onClick={clear}>
              Withdraw
            </Button>
          )}
          <Button onClick={save} disabled={!valid}>
            {existing ? "Update" : "Record undertaking"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signed on" htmlFor="vc-signed">
          <Input id="vc-signed" type="date" value={signedOn} onChange={(e) => setSignedOn(e.target.value)} />
        </Field>
        <Field label="Agreed to vacate by" htmlFor="vc-by">
          <Input id="vc-by" type="date" value={vacateBy} onChange={(e) => setVacateBy(e.target.value)} autoFocus={!existing} />
        </Field>
        <Field label="Notes" htmlFor="vc-notes" className="sm:col-span-2">
          <Textarea id="vc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Signed at the office; keys to be returned the same day" />
        </Field>
      </div>
      {valid && (
        <div className="mt-4">
          <Summary rows={[["Tenant", tenant?.fullName ?? "—"], ["Unit", `${property?.name ?? ""} ${unit?.unitNumber ?? ""}`.trim()], ["Vacate by", formatDate(vacateBy)], ["Signed", formatDate(signedOn)]]} />
        </div>
      )}
    </FlowDialog>
  );
}
