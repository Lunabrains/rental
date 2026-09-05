import { freshId } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addMonthsISO, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney } from "@/lib/format";
import type { Expense, ExpenseCategory, ExpenseClassification, ExpensePaymentStatus, ID, ISODate, Recurrence, Store } from "@/types";
import { FREQUENCY_MONTHS } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Expense management (plan §Phase 5). Amounts can never be negative, every
 * edit is audited field by field, and deletion is soft so financial history
 * is never lost.
 */

export interface ExpenseInput {
  propertyId: ID;
  unitId?: ID | null;
  supplierId?: ID | null;
  category: ExpenseCategory;
  amount: number;
  expenseDate: ISODate;
  dueDate?: ISODate | null;
  paymentStatus?: ExpensePaymentStatus;
  paidDate?: ISODate | null;
  recurring?: boolean;
  recurrence?: Recurrence | null;
  description: string;
  classification?: ExpenseClassification;
  invoiceNumber?: string | null;
  workOrderId?: ID | null;
  renovationId?: ID | null;
  assetId?: ID | null;
  notes?: string | null;
}

function validate(input: Partial<ExpenseInput>): void {
  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount < 0)) throw new Error("Expense amount cannot be negative");
  if (input.description !== undefined && !input.description.trim()) throw new Error("A description is required");
  if (input.expenseDate && input.dueDate && input.dueDate < input.expenseDate) throw new Error("Due date cannot be before the expense date");
  if (input.paidDate && input.expenseDate && input.paidDate < input.expenseDate) throw new Error("Paid date cannot be before the expense date");
}

export function addExpense(input: ExpenseInput): Command<Expense> {
  return (store) => {
    const idx = indexStore(store);
    validate(input);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    const status: ExpensePaymentStatus = input.paymentStatus ?? (input.paidDate ? "paid" : "unpaid");
    const expense: Expense = {
      id: freshId("e"),
      propertyId: property.id,
      unitId: input.unitId ?? null,
      supplierId: input.supplierId ?? null,
      category: input.category,
      amount: Math.round(input.amount * 100) / 100,
      expenseDate: input.expenseDate,
      dueDate: input.dueDate ?? null,
      paymentStatus: status,
      paidDate: status === "paid" ? input.paidDate ?? input.expenseDate : null,
      recurring: input.recurring ?? false,
      recurrence: input.recurring ? input.recurrence ?? "monthly" : null,
      description: input.description.trim(),
      documentId: null,
      classification: input.classification ?? (input.category === "renovation" || input.renovationId ? "capex" : "operating"),
      workOrderId: input.workOrderId ?? null,
      renovationId: input.renovationId ?? null,
      assetId: input.assetId ?? null,
      invoiceNumber: input.invoiceNumber?.trim() || null,
      notes: input.notes?.trim() || null,
      deleted: false,
      createdAt: today(),
    };
    const audited = appendAudit({ ...store, expenses: [...store.expenses, expense] }, { action: "create", entityType: "expense", entityId: expense.id, entityLabel: expense.description, newValue: expense.amount });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "expense_added",
      message: `Expense added — ${expense.description} · ${formatMoney(expense.amount)} · ${property.name}`,
      entityType: "expense",
      entityId: expense.id,
      propertyId: expense.propertyId,
      unitId: expense.unitId,
      expenseId: expense.id,
      supplierId: expense.supplierId,
      workOrderId: expense.workOrderId,
      renovationId: expense.renovationId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, expenses: s.expenses.filter((e) => e.id !== expense.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id]));
    return finish(logged, expense, undo);
  };
}

export type ExpensePatch = Partial<Omit<ExpenseInput, "propertyId">> & { propertyId?: ID; documentId?: ID | null };

export function updateExpense(expenseId: ID, patch: ExpensePatch): Command<Expense> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.expenseById.get(expenseId);
    if (!prev) throw new Error("Expense not found");
    validate({ ...prev, ...patch });
    const expense: Expense = {
      ...prev,
      ...patch,
      amount: patch.amount === undefined ? prev.amount : Math.round(patch.amount * 100) / 100,
      description: patch.description === undefined ? prev.description : patch.description.trim(),
      invoiceNumber: patch.invoiceNumber === undefined ? prev.invoiceNumber : patch.invoiceNumber?.trim() || null,
      notes: patch.notes === undefined ? prev.notes : patch.notes?.trim() || null,
      recurrence: (patch.recurring ?? prev.recurring) ? (patch.recurrence === undefined ? prev.recurrence ?? "monthly" : patch.recurrence) : null,
      paymentStatus: patch.paymentStatus ?? prev.paymentStatus,
    } as Expense;
    if (expense.paymentStatus === "paid" && !expense.paidDate) expense.paidDate = today();
    if (expense.paymentStatus !== "paid") expense.paidDate = null;
    const audited = auditChanges({ ...store, expenses: replaceById(store.expenses, expense) }, "expense", expense.id, expense.description, prev, expense);
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "expense_updated",
      message: `Expense updated — ${expense.description}${expense.amount !== prev.amount ? ` · ${formatMoney(prev.amount)} → ${formatMoney(expense.amount)}` : ""}`,
      entityType: "expense",
      entityId: expense.id,
      propertyId: expense.propertyId,
      unitId: expense.unitId,
      expenseId: expense.id,
      supplierId: expense.supplierId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, expenses: replaceById(s.expenses, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, expense, undo);
  };
}

export function markExpensePaid(expenseId: ID, paidDate: ISODate = today()): Command<Expense> {
  return (store) => {
    const prev = indexStore(store).expenseById.get(expenseId);
    if (!prev) throw new Error("Expense not found");
    if (paidDate < prev.expenseDate) throw new Error("Paid date cannot be before the expense date");
    const expense: Expense = { ...prev, paymentStatus: "paid", paidDate };
    const audited = auditChanges({ ...store, expenses: replaceById(store.expenses, expense) }, "expense", expense.id, expense.description, prev, expense);
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "expense_paid",
      message: `Invoice paid — ${expense.description} · ${formatMoney(expense.amount)}`,
      entityType: "expense",
      entityId: expense.id,
      propertyId: expense.propertyId,
      unitId: expense.unitId,
      expenseId: expense.id,
      supplierId: expense.supplierId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, expenses: replaceById(s.expenses, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, expense, undo);
  };
}

/** Soft delete — the record stays (hidden) for the audit trail and can be restored. */
export function deleteExpense(expenseId: ID, reason?: string): Command<Expense> {
  return (store) => {
    const prev = indexStore(store).expenseById.get(expenseId);
    if (!prev) throw new Error("Expense not found");
    const expense: Expense = { ...prev, deleted: true };
    const audited = appendAudit({ ...store, expenses: replaceById(store.expenses, expense) }, { action: "delete", entityType: "expense", entityId: expense.id, entityLabel: expense.description, previousValue: expense.amount, metadata: reason ? { reason } : null });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "expense_deleted",
      message: `Expense removed — ${expense.description} · ${formatMoney(expense.amount)}${reason ? ` · ${reason}` : ""}`,
      entityType: "expense",
      entityId: expense.id,
      propertyId: expense.propertyId,
      unitId: expense.unitId,
      expenseId: expense.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, expenses: replaceById(s.expenses, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id]));
    return finish(logged, expense, undo);
  };
}

export function restoreExpense(expenseId: ID): Command<Expense> {
  return (store) => {
    const prev = indexStore(store).expenseById.get(expenseId);
    if (!prev) throw new Error("Expense not found");
    const expense: Expense = { ...prev, deleted: false };
    const audited = appendAudit({ ...store, expenses: replaceById(store.expenses, expense) }, { action: "restore", entityType: "expense", entityId: expense.id, entityLabel: expense.description });
    return finish(audited.store, expense, (s) => recompute(removeAudit({ ...s, expenses: replaceById(s.expenses, prev) }, [audited.entry.id])));
  };
}

/** Clone a recurring expense into its next period as a scheduled, unpaid item. */
export function scheduleNextOccurrence(expenseId: ID): Command<Expense> {
  return (store) => {
    const prev = indexStore(store).expenseById.get(expenseId);
    if (!prev) throw new Error("Expense not found");
    if (!prev.recurring) throw new Error("This expense is not recurring");
    const months = FREQUENCY_MONTHS[prev.recurrence ?? "monthly"] ?? 1;
    const expenseDate = addMonthsISO(prev.expenseDate, months);
    const already = store.expenses.find((e) => !e.deleted && e.propertyId === prev.propertyId && e.category === prev.category && e.description === prev.description.replace(/ — .*$/, "") && e.expenseDate === expenseDate);
    if (already) throw new Error("The next occurrence already exists");
    const next: Expense = {
      ...prev,
      id: freshId("e"),
      expenseDate,
      dueDate: prev.dueDate ? addMonthsISO(prev.dueDate, months) : null,
      paymentStatus: "scheduled",
      paidDate: null,
      documentId: null,
      invoiceNumber: null,
      deleted: false,
      createdAt: today(),
    };
    const audited = appendAudit({ ...store, expenses: [...store.expenses, next] }, { action: "create", entityType: "expense", entityId: next.id, entityLabel: next.description, newValue: next.amount, metadata: { recurringFrom: prev.id } });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "expense_added",
      message: `Next ${next.recurrence ?? "monthly"} occurrence scheduled — ${next.description} · ${formatMoney(next.amount)} on ${expenseDate}`,
      entityType: "expense",
      entityId: next.id,
      propertyId: next.propertyId,
      unitId: next.unitId,
      expenseId: next.id,
      supplierId: next.supplierId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, expenses: s.expenses.filter((e) => e.id !== next.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id]));
    return finish(logged, next, undo);
  };
}
