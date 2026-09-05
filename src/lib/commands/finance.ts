import { freshId, ids } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney } from "@/lib/format";
import { allocateCharge } from "@/lib/import/apply";
import type { AllocationMethod, Budget, CommonCharge, DepositDeduction, ExpenseCategory, ID, ISODate, SecurityDeposit, Store, UtilityMeter, UtilityReading } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Budgets, security deposits, utilities and common charges (plan §Phase 6).
 * Same rules as everywhere: validated, audited, undoable, then recomputed.
 */

/* --------------------------------- Budgets -------------------------------- */

export interface BudgetInput {
  propertyId: ID;
  periodType: Budget["periodType"];
  period: string;
  category: ExpenseCategory;
  amount: number;
  notes?: string | null;
}

export function setBudget(input: BudgetInput): Command<Budget> {
  return (store) => {
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error("Budget cannot be negative");
    if (!/^\d{4}(-\d{2})?$/.test(input.period)) throw new Error("Period must be YYYY or YYYY-MM");
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    const id = ids.budget(property.id, input.period, input.category);
    const prev = idx.budgetById.get(id);
    const budget: Budget = { id, propertyId: property.id, periodType: input.periodType, period: input.period, category: input.category, amount: Math.round(input.amount), notes: input.notes?.trim() || null };
    const label = `${property.name} · ${input.category} · ${input.period}`;
    const audited = prev
      ? auditChanges({ ...store, budgets: replaceById(store.budgets, budget) }, "budget", id, label, prev, budget)
      : (() => {
          const r = appendAudit({ ...store, budgets: [...store.budgets, budget] }, { action: "create", entityType: "budget", entityId: id, entityLabel: label, newValue: budget.amount });
          return { store: r.store, entryIds: [r.entry.id] };
        })();
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "budget_updated",
      message: `Budget ${prev ? "updated" : "set"} — ${label} · ${formatMoney(budget.amount)}`,
      entityType: "budget",
      entityId: id,
      propertyId: property.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, budgets: prev ? replaceById(s.budgets, prev) : s.budgets.filter((b) => b.id !== id), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, budget, undo);
  };
}

export function deleteBudget(budgetId: ID): Command {
  return (store) => {
    const prev = indexStore(store).budgetById.get(budgetId);
    if (!prev) throw new Error("Budget not found");
    const audited = appendAudit({ ...store, budgets: store.budgets.filter((b) => b.id !== budgetId) }, { action: "delete", entityType: "budget", entityId: budgetId, entityLabel: `${prev.category} · ${prev.period}`, previousValue: prev.amount });
    return finish(audited.store, undefined, (s) => recompute(removeAudit({ ...s, budgets: [...s.budgets, prev] }, [audited.entry.id])));
  };
}

/* --------------------------------- Deposits ------------------------------- */

function depositLabel(store: Store, d: SecurityDeposit): string {
  const idx = indexStore(store);
  return `${idx.tenantById.get(d.tenantId)?.fullName ?? "Tenant"} · ${idx.unitById.get(d.unitId)?.unitNumber ?? ""}`;
}

export function receiveDeposit(depositId: ID, amount: number, date: ISODate = today()): Command<SecurityDeposit> {
  return (store) => {
    const prev = indexStore(store).depositById.get(depositId);
    if (!prev) throw new Error("Deposit not found");
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount cannot be negative");
    const deposit: SecurityDeposit = { ...prev, amountReceived: Math.round((prev.amountReceived + amount) * 100) / 100, receivedDate: prev.receivedDate ?? date };
    const label = depositLabel(store, prev);
    const audited = auditChanges({ ...store, deposits: replaceById(store.deposits, deposit) }, "deposit", deposit.id, label, prev, deposit, ["status", "amountHeld"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "deposit_updated", message: `Deposit received — ${formatMoney(amount)} from ${label}`, entityType: "deposit", entityId: deposit.id, propertyId: deposit.propertyId, unitId: deposit.unitId, tenantId: deposit.tenantId, contractId: deposit.contractId });
    return finish(logged, deposit, (s) => recompute(removeAudit({ ...s, deposits: replaceById(s.deposits, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

export function addDeduction(depositId: ID, input: { description: string; amount: number; date?: ISODate }): Command<SecurityDeposit> {
  return (store) => {
    const prev = indexStore(store).depositById.get(depositId);
    if (!prev) throw new Error("Deposit not found");
    if (!input.description.trim()) throw new Error("Describe the deduction");
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Deduction must be a positive amount");
    if (prev.settlementDate) throw new Error("This deposit is already settled");
    const deducted = prev.deductions.reduce((n, d) => n + d.amount, 0);
    if (deducted + input.amount > prev.amountReceived) throw new Error(`Deductions cannot exceed the ${formatMoney(prev.amountReceived)} received`);
    const deduction: DepositDeduction = { id: freshId("ded"), description: input.description.trim(), amount: Math.round(input.amount * 100) / 100, date: input.date ?? today() };
    const deposit: SecurityDeposit = { ...prev, deductions: [...prev.deductions, deduction] };
    const label = depositLabel(store, prev);
    const audited = appendAudit({ ...store, deposits: replaceById(store.deposits, deposit) }, { action: "update", entityType: "deposit", entityId: deposit.id, entityLabel: label, field: "deductions", previousValue: deducted, newValue: deducted + deduction.amount, metadata: { description: deduction.description } });
    const { store: logged, entry } = appendActivity(audited.store, { type: "deposit_updated", message: `Deduction — ${formatMoney(deduction.amount)} for ${deduction.description} · ${label}`, entityType: "deposit", entityId: deposit.id, propertyId: deposit.propertyId, unitId: deposit.unitId, tenantId: deposit.tenantId, contractId: deposit.contractId });
    return finish(logged, deposit, (s) => recompute(removeAudit({ ...s, deposits: replaceById(s.deposits, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function removeDeduction(depositId: ID, deductionId: ID): Command<SecurityDeposit> {
  return (store) => {
    const prev = indexStore(store).depositById.get(depositId);
    if (!prev) throw new Error("Deposit not found");
    if (prev.settlementDate) throw new Error("This deposit is already settled");
    const removed = prev.deductions.find((d) => d.id === deductionId);
    if (!removed) throw new Error("Deduction not found");
    const deposit: SecurityDeposit = { ...prev, deductions: prev.deductions.filter((d) => d.id !== deductionId) };
    const audited = appendAudit({ ...store, deposits: replaceById(store.deposits, deposit) }, { action: "update", entityType: "deposit", entityId: deposit.id, entityLabel: depositLabel(store, prev), field: "deductions", previousValue: removed.amount, newValue: 0, metadata: { removed: removed.description } });
    return finish(audited.store, deposit, (s) => recompute(removeAudit({ ...s, deposits: replaceById(s.deposits, prev) }, [audited.entry.id])));
  };
}

export interface SettleDepositInput {
  depositId: ID;
  refund: number;
  date?: ISODate;
  notes?: string | null;
  /** Owner explicitly overrides a refund above the amount held (audited). */
  overrideReason?: string | null;
}

/** Final settlement: refund what is held after deductions. A larger refund needs an explicit reason. */
export function settleDeposit(input: SettleDepositInput): Command<SecurityDeposit> {
  return (store) => {
    const prev = indexStore(store).depositById.get(input.depositId);
    if (!prev) throw new Error("Deposit not found");
    if (prev.settlementDate) throw new Error("This deposit is already settled");
    if (!Number.isFinite(input.refund) || input.refund < 0) throw new Error("Refund cannot be negative");
    const held = prev.amountReceived - prev.deductions.reduce((n, d) => n + d.amount, 0);
    if (input.refund > held + 0.005 && !input.overrideReason?.trim()) throw new Error(`Refund exceeds the ${formatMoney(held)} held — give a reason to override`);
    const deposit: SecurityDeposit = { ...prev, finalRefund: Math.round(input.refund * 100) / 100, settlementDate: input.date ?? today(), settlementNotes: [input.notes?.trim() || null, input.overrideReason ? `Override: ${input.overrideReason.trim()}` : null].filter(Boolean).join(" · ") || null };
    const label = depositLabel(store, prev);
    const audited = auditChanges({ ...store, deposits: replaceById(store.deposits, deposit) }, "deposit", deposit.id, label, prev, deposit, ["status", "amountHeld"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "deposit_settled", message: `Deposit settled — ${formatMoney(deposit.finalRefund ?? 0)} refunded to ${label}${deposit.deductions.length > 0 ? ` · ${formatMoney(deposit.deductions.reduce((n, d) => n + d.amount, 0))} deducted` : ""}`, entityType: "deposit", entityId: deposit.id, propertyId: deposit.propertyId, unitId: deposit.unitId, tenantId: deposit.tenantId, contractId: deposit.contractId });
    return finish(logged, deposit, (s) => recompute(removeAudit({ ...s, deposits: replaceById(s.deposits, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/* -------------------------------- Utilities ------------------------------- */

export interface MeterInput {
  propertyId: ID;
  unitId?: ID | null;
  utilityType: UtilityMeter["utilityType"];
  meterNumber: string;
  billingMethod?: UtilityMeter["billingMethod"];
  unitRate?: number | null;
  unitLabel?: string;
}

export function addMeter(input: MeterInput): Command<UtilityMeter> {
  return (store) => {
    const idx = indexStore(store);
    if (!idx.propertyById.has(input.propertyId)) throw new Error("Building not found");
    if (!input.meterNumber.trim()) throw new Error("Meter number is required");
    if (store.meters.some((m) => m.meterNumber.toUpperCase() === input.meterNumber.trim().toUpperCase())) throw new Error("A meter with this number already exists");
    if (input.unitRate !== undefined && input.unitRate !== null && input.unitRate < 0) throw new Error("Rate cannot be negative");
    const meter: UtilityMeter = { id: ids.meter(input.meterNumber.trim()), propertyId: input.propertyId, unitId: input.unitId ?? null, utilityType: input.utilityType, meterNumber: input.meterNumber.trim(), billingMethod: input.billingMethod ?? "metered", unitRate: input.unitRate ?? null, unitLabel: input.unitLabel?.trim() || (input.utilityType === "water" ? "m³" : "kWh"), createdAt: today() };
    const { store: logged, entry } = appendActivity({ ...store, meters: [...store.meters, meter] }, { type: "meter_added", message: `Meter added — ${meter.meterNumber} (${meter.utilityType})`, entityType: "meter", entityId: meter.id, propertyId: meter.propertyId, unitId: meter.unitId });
    return finish(logged, meter, (s) => recompute({ ...s, meters: s.meters.filter((m) => m.id !== meter.id), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export interface ReadingInput {
  meterId: ID;
  readingDate: ISODate;
  currentReading: number;
  previousReading?: number | null;
  meterReset?: boolean;
  note?: string | null;
  /** Also book the calculated amount as a utility expense on the building. */
  bookExpense?: boolean;
}

export function recordReading(input: ReadingInput): Command<UtilityReading> {
  return (store) => {
    const idx = indexStore(store);
    const meter = idx.meterById.get(input.meterId);
    if (!meter) throw new Error("Meter not found");
    if (!Number.isFinite(input.currentReading) || input.currentReading < 0) throw new Error("Reading cannot be negative");
    const readings = (idx.readingsByMeter.get(meter.id) ?? []).slice().sort((a, b) => (a.readingDate < b.readingDate ? -1 : 1));
    const last = readings.filter((r) => r.readingDate <= input.readingDate).pop() ?? null;
    const previous = input.previousReading ?? last?.currentReading ?? 0;
    if (input.currentReading < previous && !input.meterReset) throw new Error(`Reading ${input.currentReading} is lower than the previous ${previous} — mark a meter reset if the meter was replaced`);
    if (readings.some((r) => r.readingDate === input.readingDate)) throw new Error("A reading already exists for that date");
    const consumption = input.meterReset ? input.currentReading : Math.max(0, input.currentReading - previous);
    const reading: UtilityReading = { id: ids.reading(meter.id, input.readingDate), meterId: meter.id, readingDate: input.readingDate, previousReading: previous, currentReading: input.currentReading, consumption, calculatedAmount: meter.unitRate === null ? null : Math.round(consumption * meter.unitRate * 100) / 100, documentId: null, meterReset: input.meterReset ?? false, note: input.note?.trim() || null };
    let next: Store = { ...store, readings: [...store.readings, reading] };
    let expenseId: ID | null = null;
    if (input.bookExpense && reading.calculatedAmount && reading.calculatedAmount > 0) {
      expenseId = freshId("e");
      next = {
        ...next,
        expenses: [
          ...next.expenses,
          { id: expenseId, propertyId: meter.propertyId, unitId: meter.unitId, supplierId: null, category: meter.utilityType === "water" ? "water" : meter.utilityType === "generator" ? "generator" : "electricity", amount: reading.calculatedAmount, expenseDate: input.readingDate, dueDate: null, paymentStatus: "unpaid", paidDate: null, recurring: false, recurrence: null, description: `${meter.utilityType} · meter ${meter.meterNumber} · ${consumption.toLocaleString("en-US")} ${meter.unitLabel}`, documentId: null, classification: "operating", workOrderId: null, renovationId: null, assetId: null, invoiceNumber: null, notes: "Booked from a meter reading", deleted: false, createdAt: today() },
        ],
      };
    }
    const { store: logged, entry } = appendActivity(next, { type: "reading_recorded", message: `Reading recorded — ${meter.meterNumber}: ${input.currentReading.toLocaleString("en-US")} (${consumption.toLocaleString("en-US")} ${meter.unitLabel})${reading.calculatedAmount ? ` · ${formatMoney(reading.calculatedAmount)}` : ""}`, entityType: "meter", entityId: meter.id, propertyId: meter.propertyId, unitId: meter.unitId, expenseId });
    return finish(logged, reading, (s) => recompute({ ...s, readings: s.readings.filter((r) => r.id !== reading.id), expenses: expenseId ? s.expenses.filter((e) => e.id !== expenseId) : s.expenses, activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

/* ------------------------------ Common charges ---------------------------- */

export interface ChargeInput {
  propertyId: ID;
  period: string;
  category: string;
  totalAmount: number;
  allocationMethod: AllocationMethod;
  /** Required when the method is custom: unitId → amount. */
  custom?: Record<ID, number>;
  notes?: string | null;
}

export function addCommonCharge(input: ChargeInput): Command<CommonCharge> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    if (!Number.isFinite(input.totalAmount) || input.totalAmount < 0) throw new Error("Amount cannot be negative");
    if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error("Period must be YYYY-MM");
    if (!input.category.trim()) throw new Error("Category is required");
    const id = ids.charge(property.id, input.period, input.category.trim());
    if (idx.chargeById.has(id)) throw new Error("A charge for this category and month already exists");
    const units = idx.unitsByProperty.get(property.id) ?? [];
    const allocations =
      input.allocationMethod === "custom" && input.custom
        ? Object.entries(input.custom).filter(([unitId]) => units.some((u) => u.id === unitId)).map(([unitId, amount]) => ({ unitId, amount: Math.round(amount * 100) / 100, paid: false, paidDate: null }))
        : allocateCharge(input.totalAmount, units, input.allocationMethod).map((a) => ({ ...a, paid: false, paidDate: null }));
    const charge: CommonCharge = { id, propertyId: property.id, period: input.period, category: input.category.trim(), totalAmount: Math.round(input.totalAmount * 100) / 100, allocationMethod: input.allocationMethod, allocations, notes: input.notes?.trim() || null, createdAt: today() };
    const audited = appendAudit({ ...store, commonCharges: [...store.commonCharges, charge] }, { action: "create", entityType: "property", entityId: charge.id, entityLabel: `${property.name} · ${charge.category} · ${charge.period}`, newValue: charge.totalAmount });
    const { store: logged, entry } = appendActivity(audited.store, { type: "charge_added", message: `Common charge — ${charge.category} ${charge.period} · ${formatMoney(charge.totalAmount)} across ${allocations.length} units · ${property.name}`, entityType: "property", entityId: property.id, propertyId: property.id });
    return finish(logged, charge, (s) => recompute(removeAudit({ ...s, commonCharges: s.commonCharges.filter((c) => c.id !== id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function setAllocationPaid(chargeId: ID, unitId: ID, paid: boolean, date: ISODate = today()): Command<CommonCharge> {
  return (store) => {
    const prev = indexStore(store).chargeById.get(chargeId);
    if (!prev) throw new Error("Charge not found");
    if (!prev.allocations.some((a) => a.unitId === unitId)) throw new Error("Unit is not part of this charge");
    const charge: CommonCharge = { ...prev, allocations: prev.allocations.map((a) => (a.unitId === unitId ? { ...a, paid, paidDate: paid ? date : null } : a)) };
    const { store: logged, entry } = appendActivity({ ...store, commonCharges: replaceById(store.commonCharges, charge) }, { type: "charge_updated", message: `${prev.category} ${prev.period} — ${indexStore(store).unitById.get(unitId)?.unitNumber ?? unitId} marked ${paid ? "paid" : "unpaid"}`, entityType: "property", entityId: prev.propertyId, propertyId: prev.propertyId, unitId });
    return finish(logged, charge, (s) => recompute({ ...s, commonCharges: replaceById(s.commonCharges, prev), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export function deleteCommonCharge(chargeId: ID): Command {
  return (store) => {
    const prev = indexStore(store).chargeById.get(chargeId);
    if (!prev) throw new Error("Charge not found");
    if (prev.allocations.some((a) => a.paid)) throw new Error("Some units already paid this charge — it cannot be removed");
    const audited = appendAudit({ ...store, commonCharges: store.commonCharges.filter((c) => c.id !== chargeId) }, { action: "delete", entityType: "property", entityId: chargeId, entityLabel: `${prev.category} · ${prev.period}`, previousValue: prev.totalAmount });
    return finish(audited.store, undefined, (s) => recompute(removeAudit({ ...s, commonCharges: [...s.commonCharges, prev] }, [audited.entry.id])));
  };
}
