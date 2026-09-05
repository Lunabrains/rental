"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, MethodSelect } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateContractTerms } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate } from "@/lib/format";
import { getContractDetails } from "@/lib/queries";
import type { PaymentMethod } from "@/types";

/**
 * Edits the descriptive terms of a contract — clause, special terms, notes,
 * payment day and method. Rent and dates are deliberately not editable here:
 * they change through a renewal so the schedule stays consistent.
 */
export function ContractTermsDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const details = useMemo(() => getContractDetails(store, contractId), [store, contractId]);
  const c = details?.contract ?? null;
  const [clause, setClause] = useState(c?.rentIncreaseClause ?? "");
  const [terms, setTerms] = useState(c?.specialTerms ?? "");
  const [notes, setNotes] = useState(c?.notes ?? "");
  const [paymentDay, setPaymentDay] = useState(c?.paymentDay ?? 1);
  const [method, setMethod] = useState<PaymentMethod>(c?.paymentMethod ?? "bank_transfer");

  if (!details || !c) return null;
  const valid = paymentDay >= 1 && paymentDay <= 28;

  function submit() {
    if (!c || !valid) return;
    const { undo } = run(updateContractTerms(contractId, { rentIncreaseClause: clause.trim() || null, specialTerms: terms.trim() || null, notes: notes.trim() || null, paymentDay, paymentMethod: method }));
    toast.success(`Contract ${c.contractNumber} updated`, { description: "Changes are recorded in the audit log.", action: undo ? { label: "Undo", onClick: undo } : undefined });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit contract terms"
      description={`${details.tenant.fullName} · ${details.property.name} ${details.unit.unitNumber} · ${formatDate(c.startDate)} → ${formatDate(c.endDate)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment day" htmlFor="ct-day" hint="1–28 · future unpaid rent keeps its current due dates">
          <Input id="ct-day" type="number" min={1} max={28} value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))} className="tabular" />
        </Field>
        <Field label="Payment method" htmlFor="ct-method">
          <MethodSelect id="ct-method" value={method} onChange={setMethod} />
        </Field>
      </div>
      <Field label="Rent increase clause" htmlFor="ct-clause" hint="e.g. 5% on renewal — used to suggest the renewal rent">
        <Input id="ct-clause" value={clause} onChange={(e) => setClause(e.target.value)} placeholder="5% on renewal" />
      </Field>
      <Field label="Special terms" htmlFor="ct-terms">
        <Textarea id="ct-terms" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Pets allowed, parking included, early-termination clause…" />
      </Field>
      <Field label="Notes" htmlFor="ct-notes">
        <Textarea id="ct-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
      </Field>
      <p className="text-[11px] text-muted-foreground">Rent, dates and the tenant change through Renew, Add tenant or Mark as leaving so the payment schedule always matches the contract.</p>
    </FlowDialog>
  );
}
