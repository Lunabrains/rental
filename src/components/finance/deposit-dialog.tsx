"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/common/status-badge";
import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDeduction, receiveDeposit, removeDeduction, settleDeposit } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, formatMoney } from "@/lib/format";
import { depositRow, getInspections } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The move-out deposit calculation (plan §Phase 6 / §Phase 10): what was
 * received, what is deducted and why, what goes back to the tenant. A refund
 * above the amount held needs an explicit reason and is audited.
 */
export function DepositDialog({ depositId, onClose }: { depositId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const row = useMemo(() => {
    const d = indexStore(store).depositById.get(depositId);
    return d ? depositRow(store, d) : null;
  }, [store, depositId]);
  const moveOut = useMemo(() => (row ? getInspections(store, { unitId: row.unit.id, type: "move_out", tenantId: row.tenant.id })[0] ?? null : null), [store, row]);
  const [mode, setMode] = useState<"view" | "receive" | "deduct" | "settle">("view");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [refund, setRefund] = useState(0);
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState("");

  if (!row) return null;
  const d = row.deposit;
  const held = d.amountReceived - row.deducted;
  const outstandingRent = store.payments.filter((p) => p.contractId === d.contractId && (p.status === "overdue" || p.status === "partial")).reduce((n, p) => n + p.amountDue - p.amountPaid, 0);
  const failedItems = moveOut?.inspection.items.filter((i) => i.result === "fail" || i.result === "attention") ?? [];

  const act = (fn: () => { undo: (() => void) | null }, message: string) => {
    try {
      const { undo } = fn();
      toast.success(message, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      setMode("view");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Deposit — ${row.tenant.fullName}`}
      description={`${row.property.name} ${row.unit.unitNumber} · ${row.contract.contractNumber}${row.tenancyEnded ? ` · tenancy ended ${formatDate(row.endedOn)}` : " · current tenancy"}`}
      wide
      footer={
        mode === "view" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {d.status !== "settled" && d.amountReceived < d.amountExpected && (
              <Button variant="outline" onClick={() => { setAmount(d.amountExpected - d.amountReceived); setMode("receive"); }}>
                Record receipt
              </Button>
            )}
            {d.status !== "settled" && d.amountReceived > 0 && (
              <Button variant="outline" onClick={() => setMode("deduct")}>
                Add deduction
              </Button>
            )}
            {d.status !== "settled" && d.amountReceived > 0 && (
              <Button onClick={() => { setRefund(Math.max(0, held)); setMode("settle"); }}>
                Settle & refund
              </Button>
            )}
          </>
        ) : mode === "receive" ? (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
            <Button onClick={() => act(() => run(receiveDeposit(d.id, amount, date)), `Received ${formatMoney(amount)}`)} disabled={amount <= 0}>Record {formatMoney(amount)}</Button>
          </>
        ) : mode === "deduct" ? (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
            <Button onClick={() => act(() => run(addDeduction(d.id, { description, amount, date })), `Deduction added — ${formatMoney(amount)}`)} disabled={amount <= 0 || !description.trim()}>Deduct {formatMoney(amount)}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
            <Button variant={refund > held ? "destructive" : "default"} onClick={() => act(() => run(settleDeposit({ depositId: d.id, refund, date, notes, overrideReason: override || null })), `Deposit settled — ${formatMoney(refund)} refunded`)} disabled={refund < 0 || (refund > held + 0.005 && !override.trim())}>
              Confirm settlement
            </Button>
          </>
        )
      }
    >
      <div className="flex items-center gap-2">
        <StatusBadge value={d.status} label={d.status === "held" && row.tenancyEnded ? "Awaiting settlement" : undefined} tone={d.status === "held" && row.tenancyEnded ? "warning" : undefined} />
        <span className="text-xs text-muted-foreground">Contract deposit {formatMoney(row.contract.deposit)}</span>
      </div>
      <Summary
        rows={[
          ["Expected", formatMoney(d.amountExpected)],
          ["Received", d.amountReceived > 0 ? `${formatMoney(d.amountReceived)} · ${formatDate(d.receivedDate)}` : <span className="text-warning-foreground">not yet</span>],
          ["Deductions", row.deducted > 0 ? <span className="text-critical">−{formatMoney(row.deducted)}</span> : "—"],
          ["Held", <span key="h" className="font-semibold">{formatMoney(d.amountHeld)}</span>],
          ...(d.settlementDate ? ([["Refunded", `${formatMoney(d.finalRefund ?? 0)} · ${formatDate(d.settlementDate)}`]] as [string, React.ReactNode][]) : []),
        ]}
      />
      {d.settlementNotes && <p className="rounded-md bg-muted/50 p-3 text-sm">{d.settlementNotes}</p>}

      {mode === "view" && (
        <>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Deductions</div>
            {d.deductions.length === 0 ? (
              <p className="text-xs text-muted-foreground">None recorded.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {d.deductions.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="flex-1">{x.description}</span>
                    <span className="tabular text-muted-foreground">{formatDate(x.date)}</span>
                    <span className="tabular font-medium">−{formatMoney(x.amount)}</span>
                    {d.status !== "settled" && (
                      <Button size="icon" variant="ghost" className="size-7" aria-label="Remove deduction" onClick={() => act(() => run(removeDeduction(d.id, x.id)), "Deduction removed")}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {(outstandingRent > 0 || failedItems.length > 0) && d.status !== "settled" && (
            <div className="rounded-md border border-warning/40 bg-warning-muted/50 p-3 text-sm">
              <p className="font-medium">Before settling</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {outstandingRent > 0 && <li>{formatMoney(outstandingRent)} of rent is still outstanding on this contract — consider a deduction.</li>}
                {failedItems.map((i) => (
                  <li key={i.id}>
                    Move-out inspection: {i.area} · {i.item} — {i.result}
                    {i.notes ? ` (${i.notes})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {mode === "receive" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount received" htmlFor="dp-amount">
            <MoneyInput id="dp-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Date" htmlFor="dp-date">
            <Input id="dp-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      )}

      {mode === "deduct" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason" htmlFor="dp-desc" className="sm:col-span-2">
            <Input id="dp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Repaint living room, broken tiles, unpaid August rent…" autoFocus />
          </Field>
          <Field label="Amount" htmlFor="dp-ded" hint={`Up to ${formatMoney(held)} can still be deducted`}>
            <MoneyInput id="dp-ded" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Date" htmlFor="dp-ded-date">
            <Input id="dp-ded-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      )}

      {mode === "settle" && (
        <div className="space-y-4">
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex justify-between"><span>Received</span><span className="tabular">{formatMoney(d.amountReceived)}</span></div>
            <div className="flex justify-between"><span>Deductions</span><span className="tabular">−{formatMoney(row.deducted)}</span></div>
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Available to refund</span><span className="tabular">{formatMoney(held)}</span></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Refund to tenant" htmlFor="dp-refund" hint={refund > held ? "Above the amount held — a reason is required" : undefined}>
              <MoneyInput id="dp-refund" value={refund} onChange={setRefund} />
            </Field>
            <Field label="Settlement date" htmlFor="dp-sdate">
              <Input id="dp-sdate" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Notes" htmlFor="dp-notes" className="sm:col-span-2">
              <Textarea id="dp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How it was paid, agreements made…" />
            </Field>
            {refund > held + 0.005 && (
              <Field label="Override reason" htmlFor="dp-override" className="sm:col-span-2">
                <Input id="dp-override" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Why the refund exceeds the amount held" className={cn(!override && "border-critical")} />
              </Field>
            )}
          </div>
        </div>
      )}
    </FlowDialog>
  );
}
