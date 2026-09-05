"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, FileText, History } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { PaymentStatusBadge } from "@/components/common/badges";
import { Field, FlowDialog, MethodSelect, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { unwaivePayment, updatePayment, waivePayment } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, formatDateTime, formatMoney, formatMonth, labelize } from "@/lib/format";
import { getPaymentDetail } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@/types";

/**
 * Payment detail (plan §Phase 4): due period, amounts, method, reference,
 * notes, receipts and the audit history — plus the edits that need care:
 * correcting the recorded amount and waiving a balance (confirmed, audited).
 */
export function PaymentDetailDialog({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const { recordPayment, openTenant, openUnitPage } = useActions();
  const d = useMemo(() => getPaymentDetail(store, paymentId), [store, paymentId]);
  const [mode, setMode] = useState<"view" | "edit" | "waive">("view");
  const [method, setMethod] = useState<PaymentMethod>(d?.payment.method ?? d?.contract.paymentMethod ?? "bank_transfer");
  const [reference, setReference] = useState(d?.payment.reference ?? "");
  const [note, setNote] = useState(d?.payment.note ?? "");
  const [paidDate, setPaidDate] = useState(d?.payment.paidDate ?? "");
  const [amountPaid, setAmountPaid] = useState(d?.payment.amountPaid ?? 0);
  const [reason, setReason] = useState("");

  if (!d) return null;
  const { payment: p, tenant, unit, property, contract } = d;
  const actionable = p.status === "overdue" || p.status === "partial" || p.status === "due";

  function saveEdit() {
    if (!d) return;
    const { undo } = run(updatePayment(paymentId, { method, reference: reference || null, note: note || null, paidDate: paidDate || null, amountPaid }));
    toast.success("Payment updated", { description: "The previous values are kept in the audit log.", action: undo ? { label: "Undo", onClick: undo } : undefined });
    setMode("view");
  }

  function confirmWaive() {
    if (!d || !reason.trim()) return;
    const { undo } = run(waivePayment(paymentId, reason));
    toast.success(`Waived ${formatMoney(d.outstanding)} — ${tenant.fullName}`, { description: reason, action: undo ? { label: "Undo", onClick: undo } : undefined, duration: 8000 });
    setMode("view");
    setReason("");
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${formatMonth(p.periodMonth)} rent — ${tenant.fullName}`}
      description={`${property.name} ${unit.unitNumber} · contract ${contract.contractNumber}`}
      wide
      footer={
        mode === "view" ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {p.status !== "paid" && !p.waived && (
              <Button variant="outline" onClick={() => setMode("waive")}>
                Waive balance
              </Button>
            )}
            {p.waived && (
              <Button variant="outline" onClick={() => { const { undo } = run(unwaivePayment(paymentId)); toast.success("Waiver removed", { action: undo ? { label: "Undo", onClick: undo } : undefined }); }}>
                Remove waiver
              </Button>
            )}
            <Button variant="outline" onClick={() => setMode("edit")}>
              Edit details
            </Button>
            {actionable && (
              <Button onClick={() => { onClose(); recordPayment(p.id); }}>
                <CircleDollarSign className="size-4" /> Record payment
              </Button>
            )}
          </>
        ) : mode === "edit" ? (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={amountPaid < 0}>
              Save changes
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmWaive} disabled={!reason.trim()}>
              Confirm waiver of {formatMoney(d.outstanding)}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
        <span className="text-xs text-muted-foreground">
          Due {formatDate(p.dueDate)} · {labelize(contract.paymentFrequency)} · {labelize(contract.paymentMethod)} expected
        </span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { onClose(); openTenant(tenant.id); }}>
            Tenant
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { onClose(); openUnitPage(unit.id, "payments"); }}>
            Unit
          </Button>
        </span>
      </div>

      {mode === "view" && (
        <>
          <Summary
            rows={[
              ["Amount due", formatMoney(p.amountDue)],
              ["Amount paid", p.amountPaid > 0 ? formatMoney(p.amountPaid) : "—"],
              ["Outstanding", d.outstanding > 0 && !p.waived ? <span className="text-critical">{formatMoney(d.outstanding)}</span> : p.waived ? <span className="text-muted-foreground">waived</span> : "—"],
              ["Paid on", p.paidDate ? `${formatDate(p.paidDate)}${p.daysLate > 0 && p.status === "paid" ? ` · ${p.daysLate} days late` : ""}` : "—"],
              ["Method", p.method ? labelize(p.method) : "—"],
              ["Reference", p.reference ?? "—"],
            ]}
          />
          {p.note && <p className="rounded-md bg-muted/50 p-3 text-sm">{p.note}</p>}

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Receipts</div>
            {d.receipts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No receipt yet — one is generated when a payment is recorded.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {d.receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(r.issuedDate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Ledger context</div>
            <table className="w-full text-xs">
              <tbody className="tabular">
                {d.neighbours.map((n) => (
                  <tr key={n.id} className={cn("border-t first:border-0", n.id === p.id && "bg-accent/50 font-medium")}>
                    <td className="py-1 pr-2">{formatMonth(n.periodMonth)}</td>
                    <td className="py-1 pr-2 text-muted-foreground">due {formatDate(n.dueDate)}</td>
                    <td className="py-1 pr-2 text-right">{formatMoney(n.amountDue)}</td>
                    <td className="py-1 text-right">
                      <PaymentStatusBadge status={n.status} daysLate={n.daysLate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              <History className="size-3" /> Audit history
            </div>
            {d.audit.length === 0 && d.activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No changes recorded since import.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span className="tabular shrink-0 text-muted-foreground">{formatDateTime(a.at)}</span>
                    <span>{a.message}</span>
                  </li>
                ))}
                {d.audit.map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span className="tabular shrink-0 text-muted-foreground">{formatDateTime(a.at)}</span>
                    <span>
                      {a.actor} changed <span className="font-medium">{a.field}</span>
                      {a.previousValue !== null && <span className="text-muted-foreground"> from {a.previousValue}</span>} to <span className="font-medium">{a.newValue ?? "—"}</span>
                      {a.metadata?.reason && <span className="text-muted-foreground"> · {a.metadata.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {mode === "edit" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount paid" htmlFor="pd-amount" hint={`Due ${formatMoney(p.amountDue)} — corrections are audited`}>
            <MoneyInput id="pd-amount" value={amountPaid} onChange={setAmountPaid} />
          </Field>
          <Field label="Paid on" htmlFor="pd-date">
            <Input id="pd-date" type="date" value={paidDate} max={today()} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label="Method" htmlFor="pd-method">
            <MethodSelect id="pd-method" value={method} onChange={setMethod} />
          </Field>
          <Field label="Reference" htmlFor="pd-ref">
            <Input id="pd-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="pd-note" className="sm:col-span-2">
            <Textarea id="pd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}

      {mode === "waive" && (
        <div className="space-y-3">
          <p className="rounded-md border border-warning/40 bg-warning-muted/60 p-3 text-sm">
            Waiving forgives the remaining <strong>{formatMoney(d.outstanding)}</strong> for {formatMonth(p.periodMonth)}. The obligation stays on record as waived, with your reason, and can be reversed.
          </p>
          <Field label="Reason" htmlFor="pd-reason">
            <Textarea id="pd-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Agreed compensation for the week without water" autoFocus />
          </Field>
        </div>
      )}
    </FlowDialog>
  );
}
