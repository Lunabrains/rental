"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Field, FlowDialog, MethodSelect, MoneyInput } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bumpRent, renewContract, suggestedRenewalStart } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, addMonthsISO } from "@/lib/date";
import { formatDate, formatMoney, labelize, ordinal } from "@/lib/format";
import { getContractDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";

const DURATIONS = [6, 12, 24];

export function RenewContractDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const details = useMemo(() => getContractDetails(store, contractId), [store, contractId]);
  const c = details?.contract ?? null;

  const [step, setStep] = useState<1 | 2>(1);
  const [startDate, setStartDate] = useState(c ? suggestedRenewalStart(c) : "");
  const [months, setMonths] = useState(12);
  const [rent, setRent] = useState(c?.monthlyRent ?? 0);
  const [deposit, setDeposit] = useState(c?.deposit ?? 0);
  const [paymentDay, setPaymentDay] = useState(c?.paymentDay ?? 1);
  const [method, setMethod] = useState<PaymentMethod>(c?.paymentMethod ?? "bank_transfer");

  if (!details || !c) return null;
  const endDate = startDate ? addDaysISO(addMonthsISO(startDate, months), -1) : "";
  const valid = Boolean(startDate) && months > 0 && rent > 0 && paymentDay >= 1 && paymentDay <= 28;
  const delta = rent - c.monthlyRent;

  function submit() {
    if (!c || !valid) return;
    const { result, undo } = run(renewContract({ contractId, startDate, months, rent, deposit, paymentDay, method }));
    toast.success(`Contract renewed — ${result.tenantName}`, {
      description: `${formatMoney(c.monthlyRent)} → ${formatMoney(rent)} · ${months} months from ${formatDate(startDate)} · ${result.paymentsScheduled} payments scheduled.`,
      action: undo ? { label: "Undo", onClick: undo } : undefined,
      duration: 8000,
    });
    onClose();
  }

  const compare: [string, React.ReactNode, React.ReactNode][] = [
    ["Contract", details.contract.contractNumber, "new"],
    ["Start", formatDate(c.startDate), formatDate(startDate)],
    ["End", formatDate(c.endDate), formatDate(endDate)],
    ["Duration", `${c.durationMonths} months`, `${months} months`],
    ["Monthly rent", formatMoney(c.monthlyRent), <span key="r" className={cn(delta > 0 && "text-success", delta < 0 && "text-critical")}>{formatMoney(rent)}{delta !== 0 && ` (${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))})`}</span>],
    ["Deposit", formatMoney(c.deposit), formatMoney(deposit)],
    ["Payment day", ordinal(c.paymentDay), ordinal(paymentDay)],
    ["Method", labelize(c.paymentMethod), labelize(method)],
  ];

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={step === 1 ? "Renew contract — terms" : "Renew contract — confirm"}
      description={`${details.tenant.fullName} · ${details.property.name} ${details.unit.unitNumber} · current contract ends ${formatDate(c.endDate)}`}
      wide={step === 2}
      footer={
        step === 1 ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setStep(2)} disabled={!valid}>
              Review <ArrowRight className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={submit}>Confirm renewal</Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="rn-start" hint="Defaults to the day after the current contract ends">
            <Input id="rn-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Duration" htmlFor="rn-months" hint={endDate ? `Ends ${formatDate(endDate)}` : undefined}>
            <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
              <SelectTrigger id="rn-months" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} months
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Monthly rent" htmlFor="rn-rent" hint={`Current ${formatMoney(c.monthlyRent)}`}>
            <div className="flex gap-2">
              <div className="flex-1">
                <MoneyInput id="rn-rent" value={rent} onChange={setRent} />
              </div>
              <Button type="button" variant="outline" onClick={() => setRent(bumpRent(c.monthlyRent))} title="Raise 5% over the current rent">
                <Sparkles className="size-3.5" /> +5%
              </Button>
            </div>
          </Field>
          <Field label="Deposit" htmlFor="rn-deposit">
            <MoneyInput id="rn-deposit" value={deposit} onChange={setDeposit} />
          </Field>
          <Field label="Payment day" htmlFor="rn-day" hint="1–28">
            <Input id="rn-day" type="number" min={1} max={28} value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))} className="tabular" />
          </Field>
          <Field label="Method" htmlFor="rn-method">
            <MethodSelect id="rn-method" value={method} onChange={setMethod} />
          </Field>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium" />
                <th className="px-3 py-2 font-medium">Current</th>
                <th className="px-3 py-2 font-medium text-foreground">New</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {compare.map(([k, a, b]) => (
                <tr key={k} className="border-t">
                  <td className="px-3 py-2 text-muted-foreground">{k}</td>
                  <td className="px-3 py-2">{a}</td>
                  <td className="px-3 py-2 font-medium">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            The current contract moves to history as <em>Renewed</em>; the unit stays with {details.tenant.fullName}; {months} payment rows are scheduled.
          </p>
        </div>
      )}
    </FlowDialog>
  );
}
