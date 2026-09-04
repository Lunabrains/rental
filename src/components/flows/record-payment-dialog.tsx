"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, MethodSelect, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordPayment } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { paymentRow } from "@/lib/queries";
import type { PaymentMethod } from "@/types";

export function RecordPaymentDialog({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const row = useMemo(() => {
    const p = indexStore(store).paymentById.get(paymentId);
    return p ? paymentRow(store, p) : null;
  }, [store, paymentId]);

  const outstanding = row ? Math.max(0, row.payment.amountDue - row.payment.amountPaid) : 0;
  const [amount, setAmount] = useState(outstanding);
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>(row?.contract.paymentMethod ?? "bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  if (!row) return null;
  const { payment, tenant, unit, property } = row;
  const partial = amount > 0 && amount < outstanding;
  const remaining = Math.max(0, outstanding - amount);
  const valid = amount > 0 && date <= today();

  function submit() {
    if (!row || !valid) return;
    const { result, undo } = run(recordPayment({ paymentId, amount, date, method, reference: reference || null, note: note || null }));
    toast.success(`Payment recorded — ${formatMoney(amount)} from ${result.tenantName}`, {
      description: result.partial
        ? `Partial: ${formatMoney(result.remaining)} still outstanding. Receipt generated.`
        : "Ledger updated, alert resolved, receipt generated.",
      action: undo ? { label: "Undo", onClick: undo } : undefined,
      duration: 8000,
    });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record payment"
      description={`${tenant.fullName} · ${property.name} ${unit.unitNumber} · ${formatMonth(payment.periodMonth)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Record {formatMoney(amount)}
          </Button>
        </>
      }
    >
      <Summary
        rows={[
          ["Due", formatMoney(payment.amountDue)],
          ["Already paid", payment.amountPaid > 0 ? formatMoney(payment.amountPaid) : "—"],
          ["Outstanding", formatMoney(outstanding)],
          ["Due date", `${formatDate(payment.dueDate)}${payment.daysLate > 0 ? ` · ${payment.daysLate} days late` : ""}`],
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" htmlFor="rp-amount" hint={partial ? `Partial — ${formatMoney(remaining)} stays outstanding` : undefined}>
          <MoneyInput id="rp-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Date received" htmlFor="rp-date">
          <Input id="rp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor="rp-method">
          <MethodSelect id="rp-method" value={method} onChange={setMethod} />
        </Field>
        <Field label="Reference" htmlFor="rp-ref" hint="Optional — generated if blank">
          <Input id="rp-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref, cheque no…" />
        </Field>
      </div>
      <Field label="Note" htmlFor="rp-note">
        <Textarea id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional" />
      </Field>
    </FlowDialog>
  );
}
