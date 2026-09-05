"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AssetSelect, EnumSelect, PropertySelect, SupplierSelect, UnitSelect } from "@/components/common/entity-select";
import { Field, FlowDialog, MoneyInput } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { addExpense, updateExpense, type ExpenseInput } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, today } from "@/lib/date";
import { formatMoney } from "@/lib/format";
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_STATUSES, RECURRENCES, type ExpenseCategory, type ExpenseClassification, type ExpensePaymentStatus, type Recurrence } from "@/types";

export interface ExpensePrefill {
  propertyId?: string | null;
  unitId?: string | null;
  supplierId?: string | null;
  assetId?: string | null;
  workOrderId?: string | null;
  renovationId?: string | null;
  category?: ExpenseCategory;
  amount?: number;
  description?: string;
  classification?: ExpenseClassification;
}

/** Add or edit an expense. Building, category, amount, date and description are required. */
export function ExpenseDialog({ expenseId, prefill, onClose }: { expenseId?: string; prefill?: ExpensePrefill; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = useMemo(() => (expenseId ? indexStore(store).expenseById.get(expenseId) ?? null : null), [store, expenseId]);
  const base = existing ?? null;

  const [propertyId, setPropertyId] = useState<string | null>(base?.propertyId ?? prefill?.propertyId ?? store.properties[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(base?.unitId ?? prefill?.unitId ?? null);
  const [supplierId, setSupplierId] = useState<string | null>(base?.supplierId ?? prefill?.supplierId ?? null);
  const [assetId, setAssetId] = useState<string | null>(base?.assetId ?? prefill?.assetId ?? null);
  const [category, setCategory] = useState<ExpenseCategory>(base?.category ?? prefill?.category ?? "maintenance");
  const [amount, setAmount] = useState(base?.amount ?? prefill?.amount ?? 0);
  const [expenseDate, setExpenseDate] = useState(base?.expenseDate ?? today());
  const [dueDate, setDueDate] = useState(base?.dueDate ?? addDaysISO(today(), 30));
  const [status, setStatus] = useState<ExpensePaymentStatus>(base?.paymentStatus ?? "unpaid");
  const [paidDate, setPaidDate] = useState(base?.paidDate ?? today());
  const [recurring, setRecurring] = useState(base?.recurring ?? false);
  const [recurrence, setRecurrence] = useState<Recurrence>(base?.recurrence ?? "monthly");
  const [description, setDescription] = useState(base?.description ?? prefill?.description ?? "");
  const [classification, setClassification] = useState<ExpenseClassification>(base?.classification ?? prefill?.classification ?? (prefill?.renovationId ? "capex" : "operating"));
  const [invoiceNumber, setInvoiceNumber] = useState(base?.invoiceNumber ?? "");
  const [notes, setNotes] = useState(base?.notes ?? "");

  const valid = propertyId !== null && amount >= 0 && description.trim().length > 0 && expenseDate.length === 10 && (status !== "paid" || paidDate >= expenseDate) && (!dueDate || dueDate >= expenseDate);

  function submit() {
    if (!valid || !propertyId) return;
    const input: ExpenseInput = {
      propertyId,
      unitId,
      supplierId,
      assetId,
      category,
      amount,
      expenseDate,
      dueDate: dueDate || null,
      paymentStatus: status,
      paidDate: status === "paid" ? paidDate : null,
      recurring,
      recurrence: recurring ? recurrence : null,
      description,
      classification,
      invoiceNumber: invoiceNumber || null,
      notes: notes || null,
      workOrderId: base?.workOrderId ?? prefill?.workOrderId ?? null,
      renovationId: base?.renovationId ?? prefill?.renovationId ?? null,
    };
    try {
      const { result, undo } = expenseId ? run(updateExpense(expenseId, input)) : run(addExpense(input));
      toast.success(`${expenseId ? "Expense updated" : "Expense added"} — ${formatMoney(result.amount)}`, { description: result.description, action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the expense");
    }
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={expenseId ? "Edit expense" : "Add expense"}
      description={expenseId ? base?.description : "Operating costs feed NOI and budgets; CapEx is tracked separately."}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {expenseId ? "Save changes" : `Add ${amount > 0 ? formatMoney(amount) : "expense"}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="ex-property">
          <PropertySelect id="ex-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); setAssetId(null); }} />
        </Field>
        <Field label="Unit (optional)" htmlFor="ex-unit" hint="Attribute to an apartment for unit profitability">
          <UnitSelect id="ex-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone />
        </Field>
        <Field label="Category" htmlFor="ex-category">
          <EnumSelect id="ex-category" values={EXPENSE_CATEGORIES} value={category} onChange={(v) => { if (v) { setCategory(v); if (v === "renovation") setClassification("capex"); } }} />
        </Field>
        <Field label="Type" htmlFor="ex-class" hint={classification === "capex" ? "Capital expenditure — not subtracted from NOI" : "Operating expense — subtracted from NOI"}>
          <EnumSelect id="ex-class" values={["operating", "capex"] as const} value={classification} onChange={(v) => v && setClassification(v)} labels={{ capex: "CapEx" }} />
        </Field>
        <Field label="Description" htmlFor="ex-desc" className="sm:col-span-2">
          <Input id="ex-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it for?" autoFocus={!expenseId} />
        </Field>
        <Field label="Amount" htmlFor="ex-amount">
          <MoneyInput id="ex-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Supplier" htmlFor="ex-supplier">
          <SupplierSelect id="ex-supplier" value={supplierId} onChange={setSupplierId} allowNone />
        </Field>
        <Field label="Expense date" htmlFor="ex-date">
          <Input id="ex-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
        </Field>
        <Field label="Due date" htmlFor="ex-due">
          <Input id="ex-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Payment status" htmlFor="ex-status">
          <EnumSelect id="ex-status" values={EXPENSE_PAYMENT_STATUSES} value={status} onChange={(v) => v && setStatus(v)} />
        </Field>
        {status === "paid" && (
          <Field label="Paid on" htmlFor="ex-paid">
            <Input id="ex-paid" type="date" value={paidDate} max={today()} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
        )}
        <Field label="Invoice number" htmlFor="ex-invoice">
          <Input id="ex-invoice" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Asset (optional)" htmlFor="ex-asset">
          <AssetSelect id="ex-asset" propertyId={propertyId} value={assetId} onChange={setAssetId} allowNone />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Switch id="ex-recurring" checked={recurring} onCheckedChange={setRecurring} />
          <label htmlFor="ex-recurring" className="text-sm">
            Recurring
          </label>
          {recurring && (
            <div className="w-40">
              <EnumSelect values={RECURRENCES} value={recurrence} onChange={(v) => v && setRecurrence(v)} />
            </div>
          )}
        </div>
        <Field label="Notes" htmlFor="ex-notes" className="sm:col-span-2">
          <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {!expenseId && <p className="text-[11px] text-muted-foreground">Attach the invoice from the expense row after saving.</p>}
    </FlowDialog>
  );
}
