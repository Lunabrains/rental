"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, MethodSelect, MoneyInput } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addTenantToUnit } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, addMonthsISO, today } from "@/lib/date";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { getUnitDetails } from "@/lib/queries";
import type { IdDocumentType, PaymentMethod } from "@/types";

const ID_TYPES: IdDocumentType[] = ["national_id", "passport", "residency_permit"];

export function AddTenantDialog({ unitId, onClose }: { unitId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const details = useMemo(() => getUnitDetails(store, unitId), [store, unitId]);
  const u = details?.unit ?? null;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [nationality, setNationality] = useState("Lebanese");
  const [idType, setIdType] = useState<IdDocumentType>("national_id");
  const [idNumber, setIdNumber] = useState("");

  const [startDate, setStartDate] = useState(today());
  const [months, setMonths] = useState(12);
  const [rent, setRent] = useState(u?.askingRent || u?.lastRent || 0);
  const [deposit, setDeposit] = useState(u?.askingDeposit || u?.askingRent || 0);
  const [paymentDay, setPaymentDay] = useState(Math.min(28, Number(today().slice(8, 10))));
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");

  if (!details || !u) return null;
  const endDate = addDaysISO(addMonthsISO(startDate, months), -1);
  const valid = firstName.trim() && lastName.trim() && phone.trim() && rent > 0 && startDate && paymentDay >= 1 && paymentDay <= 28;

  function submit() {
    if (!valid) return;
    const { result, undo } = run(
      addTenantToUnit({
        unitId,
        tenant: { firstName, lastName, phone, email, nationality, idType, idNumber },
        terms: { startDate, months, rent, deposit, paymentDay, method },
      }),
    );
    toast.success(`${result.tenant.fullName} added to ${details!.property.name} ${u!.unitNumber}`, {
      description: `Contract ${result.contract.contractNumber} · ${formatMoney(rent)}/month · ${result.paymentsScheduled} payments scheduled. The square is now red.`,
      action: undo ? { label: "Undo", onClick: undo } : undefined,
      duration: 8000,
    });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add tenant"
      description={`${details.property.name} · ${u.unitNumber} · ${u.bedrooms} BR · asking ${u.askingRent > 0 ? formatMoney(u.askingRent) : "—"}`}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Add tenant & start contract
          </Button>
        </>
      }
    >
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tenant</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="at-first">
            <Input id="at-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
          </Field>
          <Field label="Last name" htmlFor="at-last">
            <Input id="at-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="at-phone">
            <Input id="at-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961 3 000 000" />
          </Field>
          <Field label="Email" htmlFor="at-email">
            <Input id="at-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Nationality" htmlFor="at-nat">
            <Input id="at-nat" value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID type" htmlFor="at-idtype">
              <Select value={idType} onValueChange={(v) => setIdType(v as IdDocumentType)}>
                <SelectTrigger id="at-idtype" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ID_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {labelize(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ID number" htmlFor="at-id">
              <Input id="at-id" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Contract</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start" htmlFor="at-start" hint={`Ends ${formatDate(endDate)}`}>
            <Input id="at-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Duration" htmlFor="at-months">
            <Select value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
              <SelectTrigger id="at-months" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[6, 12, 24].map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m} months
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Payment day" htmlFor="at-day">
            <Input id="at-day" type="number" min={1} max={28} value={paymentDay} onChange={(e) => setPaymentDay(Number(e.target.value))} className="tabular" />
          </Field>
          <Field label="Monthly rent" htmlFor="at-rent">
            <MoneyInput id="at-rent" value={rent} onChange={setRent} />
          </Field>
          <Field label="Deposit" htmlFor="at-deposit">
            <MoneyInput id="at-deposit" value={deposit} onChange={setDeposit} />
          </Field>
          <Field label="Method" htmlFor="at-method">
            <MethodSelect id="at-method" value={method} onChange={setMethod} />
          </Field>
        </div>
      </div>
    </FlowDialog>
  );
}
