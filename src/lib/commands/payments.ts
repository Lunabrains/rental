import { indexStore } from "@/lib/data/store";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney, formatMonth } from "@/lib/format";
import type { ID, ISODate, Payment, PaymentMethod, Store } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Payment edits beyond recording money (plan §Phase 4): method, reference,
 * notes, paid date, and waiving a balance. Every change is audited with the
 * previous value; waiving requires the owner's explicit confirmation in the
 * UI and records the reason.
 */

export interface PaymentPatch {
  method?: PaymentMethod | null;
  reference?: string | null;
  note?: string | null;
  paidDate?: ISODate | null;
  /** Correct the recorded amount (e.g. a typo). Never negative. */
  amountPaid?: number;
}

export function updatePayment(paymentId: ID, patch: PaymentPatch): Command<Payment> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.paymentById.get(paymentId);
    if (!prev) throw new Error("Payment not found");
    if (patch.amountPaid !== undefined && patch.amountPaid < 0) throw new Error("Payment amount cannot be negative");
    if (patch.amountPaid !== undefined && patch.amountPaid > prev.amountDue * 2) throw new Error("Amount paid is far above the amount due — check the figure");
    const payment: Payment = {
      ...prev,
      method: patch.method === undefined ? prev.method : patch.method,
      reference: patch.reference === undefined ? prev.reference : patch.reference?.trim() || null,
      note: patch.note === undefined ? prev.note : patch.note?.trim() || null,
      paidDate: patch.paidDate === undefined ? prev.paidDate : patch.paidDate,
      amountPaid: patch.amountPaid === undefined ? prev.amountPaid : Math.round(patch.amountPaid * 100) / 100,
    };
    if (payment.amountPaid > 0 && !payment.paidDate) payment.paidDate = prev.paidDate ?? prev.dueDate;
    const tenant = idx.tenantById.get(prev.tenantId);
    const label = `${tenant?.fullName ?? "Tenant"} · ${formatMonth(prev.periodMonth)}`;
    const audited = auditChanges({ ...store, payments: replaceById(store.payments, payment) }, "payment", payment.id, label, prev, payment, ["status", "daysLate"]);
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "payment_updated",
      message: `Payment updated — ${label}${patch.amountPaid !== undefined && patch.amountPaid !== prev.amountPaid ? ` · amount ${formatMoney(prev.amountPaid)} → ${formatMoney(payment.amountPaid)}` : ""}`,
      entityType: "payment",
      entityId: payment.id,
      propertyId: payment.propertyId,
      unitId: payment.unitId,
      tenantId: payment.tenantId,
      contractId: payment.contractId,
      paymentId: payment.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, payments: replaceById(s.payments, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, payment, undo);
  };
}

/** Forgive the unpaid balance of a rent obligation. Audited with the reason. */
export function waivePayment(paymentId: ID, reason: string): Command<Payment> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.paymentById.get(paymentId);
    if (!prev) throw new Error("Payment not found");
    if (!reason.trim()) throw new Error("A reason is required to waive rent");
    const balance = Math.max(0, prev.amountDue - prev.amountPaid);
    const payment: Payment = { ...prev, waived: true, note: [prev.note, `Waived: ${reason.trim()}`].filter(Boolean).join(" · ") };
    const tenant = idx.tenantById.get(prev.tenantId);
    const label = `${tenant?.fullName ?? "Tenant"} · ${formatMonth(prev.periodMonth)}`;
    const audited = appendAudit({ ...store, payments: replaceById(store.payments, payment) }, {
      action: "update",
      entityType: "payment",
      entityId: payment.id,
      entityLabel: label,
      field: "waived",
      previousValue: false,
      newValue: true,
      metadata: { reason: reason.trim(), balance: String(balance) },
    });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "payment_waived",
      message: `Waived ${formatMoney(balance)} — ${label} · ${reason.trim()}`,
      entityType: "payment",
      entityId: payment.id,
      propertyId: payment.propertyId,
      unitId: payment.unitId,
      tenantId: payment.tenantId,
      contractId: payment.contractId,
      paymentId: payment.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, payments: replaceById(s.payments, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id]));
    return finish(logged, payment, undo);
  };
}

export function unwaivePayment(paymentId: ID): Command<Payment> {
  return (store) => {
    const prev = indexStore(store).paymentById.get(paymentId);
    if (!prev) throw new Error("Payment not found");
    const payment: Payment = { ...prev, waived: false };
    const audited = appendAudit({ ...store, payments: replaceById(store.payments, payment) }, { action: "update", entityType: "payment", entityId: payment.id, entityLabel: formatMonth(prev.periodMonth), field: "waived", previousValue: true, newValue: false });
    return finish(audited.store, payment, (s) => recompute(removeAudit({ ...s, payments: replaceById(s.payments, prev) }, [audited.entry.id])));
  };
}
