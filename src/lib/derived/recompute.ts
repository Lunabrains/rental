import { daysBetween, today } from "@/lib/date";
import type {
  Asset,
  Contract,
  Expense,
  ISODate,
  Payment,
  PaymentStatus,
  PreventivePlan,
  Renovation,
  RenewalStatus,
  SecurityDeposit,
  Store,
  Unit,
  UtilityReading,
} from "@/types";

import { computeAlertSets } from "./alerts";
import { isOccupying } from "./occupancy";

export { isOccupying };

function deriveContractStatus(c: Contract, base: ISODate, upcomingDays: number): Contract {
  let status = c.status;
  if (status === "active" && c.endDate < base) status = "expired";
  if (status === "notice_given" && c.moveOutDate !== null && c.moveOutDate < base) status = "terminated";

  let renewalStatus: RenewalStatus;
  if (status === "renewed") renewalStatus = "renewed";
  else if (status === "terminated" || (status === "expired" && (c.moveOutDate !== null || c.renewedToContractId !== null))) renewalStatus = "ended";
  else if (c.renewalDecision) renewalStatus = c.renewalDecision;
  else renewalStatus = daysBetween(base, c.endDate) <= upcomingDays ? "upcoming" : "not_due";

  if (status === c.status && renewalStatus === c.renewalStatus) return c;
  return { ...c, status, renewalStatus };
}

function derivePayment(p: Payment, base: ISODate, dueSoonDays: number): Payment {
  let status: PaymentStatus;
  let daysLate = 0;

  if (p.waived && p.amountPaid < p.amountDue) {
    status = "waived";
  } else if (p.amountPaid >= p.amountDue && p.amountDue > 0) {
    status = "paid";
    daysLate = p.paidDate ? Math.max(0, daysBetween(p.dueDate, p.paidDate)) : 0;
  } else if (p.amountPaid > 0) {
    status = "partial";
    daysLate = p.dueDate < base ? daysBetween(p.dueDate, base) : 0;
  } else if (p.dueDate < base) {
    status = "overdue";
    daysLate = daysBetween(p.dueDate, base);
  } else if (daysBetween(base, p.dueDate) <= dueSoonDays) {
    status = "due";
  } else {
    status = "scheduled";
  }

  if (status === p.status && daysLate === p.daysLate) return p;
  return { ...p, status, daysLate };
}

/** Statuses the owner sets by hand — contracts never override them. */
const OVERRIDE: Unit["status"][] = ["maintenance", "reserved", "renovation", "unavailable"];

function deriveUnit(unit: Unit, unitContracts: Contract[]): Unit {
  const occupying = unitContracts.filter(isOccupying).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;

  if (occupying) {
    if (unit.status === "rented" && unit.availableSince === null) return unit;
    return { ...unit, status: "rented", availableSince: null };
  }

  const history = unitContracts
    .filter((c) => !isOccupying(c))
    .sort((a, b) => ((a.moveOutDate ?? a.endDate) < (b.moveOutDate ?? b.endDate) ? 1 : -1));
  const last = history[0] ?? null;

  const status = OVERRIDE.includes(unit.status) ? unit.status : "available";
  const availableSince = last ? (last.moveOutDate ?? last.endDate) : unit.availableSince;
  const lastRent = last ? last.monthlyRent : unit.lastRent;
  const previousTenantId = last ? last.tenantId : unit.previousTenantId;

  if (
    unit.status === status &&
    unit.availableSince === availableSince &&
    unit.lastRent === lastRent &&
    unit.previousTenantId === previousTenantId
  ) {
    return unit;
  }
  return { ...unit, status, availableSince, lastRent, previousTenantId };
}

function deriveDeposit(d: SecurityDeposit): SecurityDeposit {
  const deducted = d.deductions.reduce((n, x) => n + x.amount, 0);
  const amountHeld = Math.max(0, Math.round((d.amountReceived - deducted - (d.finalRefund ?? 0)) * 100) / 100);
  const status: SecurityDeposit["status"] = d.settlementDate ? "settled" : d.amountReceived > 0 ? "held" : "pending";
  if (status === d.status && amountHeld === d.amountHeld) return d;
  return { ...d, status, amountHeld };
}

function deriveExpense(e: Expense, base: ISODate): Expense {
  // A scheduled expense whose due date has passed is simply unpaid.
  if (e.paymentStatus === "scheduled" && e.dueDate !== null && e.dueDate < base) return { ...e, paymentStatus: "unpaid" };
  return e;
}

function deriveReadings(readings: UtilityReading[], rateByMeter: Map<string, number | null>): UtilityReading[] {
  return readings.map((r) => {
    const consumption = r.meterReset ? r.currentReading : Math.max(0, r.currentReading - r.previousReading);
    const rate = rateByMeter.get(r.meterId) ?? null;
    const calculatedAmount = rate === null ? null : Math.round(consumption * rate * 100) / 100;
    if (consumption === r.consumption && calculatedAmount === r.calculatedAmount) return r;
    return { ...r, consumption, calculatedAmount };
  });
}

function deriveAsset(a: Asset, plans: PreventivePlan[]): Asset {
  const active = plans.filter((p) => p.status === "active").sort((x, y) => (x.nextServiceDate < y.nextServiceDate ? -1 : 1));
  const next = active[0]?.nextServiceDate ?? a.nextServiceDate;
  const last = plans.reduce<ISODate | null>((m, p) => (p.lastServiceDate && (!m || p.lastServiceDate > m) ? p.lastServiceDate : m), a.lastServiceDate);
  if (next === a.nextServiceDate && last === a.lastServiceDate) return a;
  return { ...a, nextServiceDate: next, lastServiceDate: last };
}

function deriveRenovation(r: Renovation, expenses: Expense[]): Renovation {
  const actualCost = expenses.filter((e) => e.renovationId === r.id && !e.deleted).reduce((n, e) => n + e.amount, 0);
  const done = r.tasks.filter((t) => t.done).length;
  const progressPercent = r.status === "completed" ? 100 : r.tasks.length > 0 ? Math.round((done / r.tasks.length) * 100) : r.progressPercent;
  if (actualCost === r.actualCost && progressPercent === r.progressPercent) return r;
  return { ...r, actualCost, progressPercent };
}

/**
 * The single derivation pass. Runs after load and after every command:
 * contract statuses → payment statuses → unit statuses → deposits, expenses,
 * readings, assets, renovations → alerts. Pure — returns a new store snapshot.
 */
export function recompute(store: Store, base: ISODate = today()): Store {
  const t = store.settings.thresholds;
  const contracts = store.contracts.map((c) => deriveContractStatus(c, base, t.contractInfoDays));

  const payments = store.payments.map((p) => derivePayment(p, base, t.paymentDueSoonDays));

  const contractsByUnit = new Map<string, Contract[]>();
  for (const c of contracts) {
    const list = contractsByUnit.get(c.unitId);
    if (list) list.push(c);
    else contractsByUnit.set(c.unitId, [c]);
  }
  const units = store.units.map((u) => deriveUnit(u, contractsByUnit.get(u.id) ?? []));

  const deposits = store.deposits.map(deriveDeposit);
  const expenses = store.expenses.map((e) => deriveExpense(e, base));

  const rateByMeter = new Map(store.meters.map((m) => [m.id, m.unitRate]));
  const readings = deriveReadings(store.readings, rateByMeter);

  const plansByAsset = new Map<string, PreventivePlan[]>();
  for (const p of store.preventivePlans) {
    if (!p.assetId) continue;
    const list = plansByAsset.get(p.assetId);
    if (list) list.push(p);
    else plansByAsset.set(p.assetId, [p]);
  }
  const assets = store.assets.map((a) => deriveAsset(a, plansByAsset.get(a.id) ?? []));
  const renovations = store.renovations.map((r) => deriveRenovation(r, expenses));

  const draft: Store = { ...store, contracts, payments, units, deposits, expenses, readings, assets, renovations };
  const { alerts, mutedAlerts } = computeAlertSets(draft, base);
  return { ...draft, alerts, mutedAlerts };
}
