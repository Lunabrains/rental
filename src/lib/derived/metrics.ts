import { addPeriods, daysBetween, lastPeriods, periodOf, today } from "@/lib/date";
import type { Budget, Expense, ISODate, Payment, PeriodMonth, Store, Unit, WorkOrder } from "@/types";

import { isOccupying, occupyingAt } from "./occupancy";

/**
 * The shared formulas (plan §5–§8). Dashboard, reports, alerts and the AI
 * tool layer all call these so every screen agrees on the numbers. Pure
 * functions — no store mutation, no UI.
 */

/* --------------------------------- §5 ------------------------------------ */

/** Units the owner can rent: everything not marked unavailable. */
export function rentableUnits(units: Unit[]): Unit[] {
  return units.filter((u) => u.status !== "unavailable");
}

export interface OccupancyRate {
  occupied: number;
  rentable: number;
  rate: number;
}

export function occupancyRate(units: Unit[]): OccupancyRate {
  const rentable = rentableUnits(units);
  const occupied = rentable.filter((u) => u.status === "rented").length;
  return { occupied, rentable: rentable.length, rate: rentable.length > 0 ? occupied / rentable.length : 0 };
}

export interface CollectionRate {
  due: number;
  collected: number;
  rate: number;
}

/**
 * Rent collected for a period ÷ rent due for that period. Waived rent is
 * excluded from both; with `asOf`, rent not yet due on that date is ignored.
 */
export function collectionRate(payments: Payment[], period: PeriodMonth, asOf?: ISODate): CollectionRate {
  let due = 0;
  let collected = 0;
  for (const p of payments) {
    if (p.periodMonth !== period || p.status === "waived") continue;
    if (asOf && p.dueDate > asOf) continue;
    due += p.amountDue;
    collected += Math.min(p.amountDue, p.amountPaid);
  }
  return { due, collected, rate: due > 0 ? collected / due : 1 };
}

export function isUnpaid(p: Payment): boolean {
  return p.status === "overdue" || p.status === "partial";
}

/** Σ (amount due − amount paid) over unpaid / partial rent obligations. */
export function outstandingRent(payments: Payment[]): number {
  return payments.reduce((n, p) => (isUnpaid(p) ? n + Math.max(0, p.amountDue - p.amountPaid) : n), 0);
}

export interface AgingBucket {
  key: "0-30" | "31-60" | "61-90" | "90+";
  label: string;
  minDays: number;
  maxDays: number | null;
  amount: number;
  count: number;
  paymentIds: string[];
}

export interface ArrearsAging {
  buckets: AgingBucket[];
  total: number;
  count: number;
}

export function arrearsAging(payments: Payment[]): ArrearsAging {
  const buckets: AgingBucket[] = [
    { key: "0-30", label: "0–30 days", minDays: 0, maxDays: 30, amount: 0, count: 0, paymentIds: [] },
    { key: "31-60", label: "31–60 days", minDays: 31, maxDays: 60, amount: 0, count: 0, paymentIds: [] },
    { key: "61-90", label: "61–90 days", minDays: 61, maxDays: 90, amount: 0, count: 0, paymentIds: [] },
    { key: "90+", label: "90+ days", minDays: 91, maxDays: null, amount: 0, count: 0, paymentIds: [] },
  ];
  let total = 0;
  let count = 0;
  for (const p of payments) {
    if (!isUnpaid(p)) continue;
    const amount = Math.max(0, p.amountDue - p.amountPaid);
    const b = buckets.find((x) => p.daysLate >= x.minDays && (x.maxDays === null || p.daysLate <= x.maxDays)) ?? buckets[0];
    b.amount += amount;
    b.count++;
    b.paymentIds.push(p.id);
    total += amount;
    count++;
  }
  return { buckets, total, count };
}

export function inPeriod(date: ISODate, period: string): boolean {
  return period.length === 4 ? date.startsWith(period) : periodOf(date) === period;
}

/** Live (not deleted) expenses for a building/period, optionally one category. */
export function expensesFor(expenses: Expense[], opts: { propertyId?: string; period?: string; category?: string; classification?: Expense["classification"]; unitId?: string }): Expense[] {
  return expenses.filter(
    (e) =>
      !e.deleted &&
      (!opts.propertyId || e.propertyId === opts.propertyId) &&
      (!opts.period || inPeriod(e.expenseDate, opts.period)) &&
      (!opts.category || e.category === opts.category) &&
      (!opts.classification || e.classification === opts.classification) &&
      (!opts.unitId || e.unitId === opts.unitId),
  );
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export interface NoiResult {
  period: string;
  /** Rent billed for the period — the operating income on an accrual basis. */
  income: number;
  collected: number;
  operatingExpenses: number;
  capex: number;
  noi: number;
  margin: number;
}

/**
 * Net operating income = operating income − operating expenses.
 * CapEx is reported alongside but never subtracted; there is no debt layer.
 */
export function noiFor(store: Store, period: string, propertyId?: string): NoiResult {
  let income = 0;
  let collected = 0;
  for (const p of store.payments) {
    if (propertyId && p.propertyId !== propertyId) continue;
    if (p.status === "waived") continue;
    if (inPeriod(p.periodMonth + "-01", period)) income += p.amountDue;
    if (p.paidDate && inPeriod(p.paidDate, period)) collected += p.amountPaid;
  }
  const operatingExpenses = sum(expensesFor(store.expenses, { propertyId, period, classification: "operating" }).map((e) => e.amount));
  const capex = sum(expensesFor(store.expenses, { propertyId, period, classification: "capex" }).map((e) => e.amount));
  const noi = income - operatingExpenses;
  return { period, income, collected, operatingExpenses, capex, noi, margin: income > 0 ? noi / income : 0 };
}

export interface VacancyLoss {
  referenceRent: number;
  source: "last_rent" | "market_rent" | "asking_rent" | "none";
  daysVacant: number;
  /** Estimated — daily reference rent × vacant days. */
  loss: number;
}

/** Reference-rent priority: previous contracted rent → market rent → asking rent. Always an estimate. */
export function vacancyLoss(unit: Unit, base: ISODate = today()): VacancyLoss {
  const daysVacant = unit.status === "available" && unit.availableSince ? Math.max(0, daysBetween(unit.availableSince, base)) : 0;
  let referenceRent = 0;
  let source: VacancyLoss["source"] = "none";
  if (unit.lastRent) {
    referenceRent = unit.lastRent;
    source = "last_rent";
  } else if (unit.marketRent) {
    referenceRent = unit.marketRent;
    source = "market_rent";
  } else if (unit.askingRent) {
    referenceRent = unit.askingRent;
    source = "asking_rent";
  }
  return { referenceRent, source, daysVacant, loss: Math.round((referenceRent / 30) * daysVacant) };
}

export interface BudgetVariance {
  budget: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  over: boolean;
}

export function budgetVariance(budget: number, actual: number, overPct = 0): BudgetVariance {
  const variance = actual - budget;
  return { budget, actual, variance, variancePct: budget !== 0 ? variance / budget : null, over: budget > 0 ? actual > budget * (1 + overPct) : actual > 0 };
}

/** Actual spend matching a budget line (month or whole year). */
export function budgetActual(expenses: Expense[], b: Budget): number {
  return sum(expensesFor(expenses, { propertyId: b.propertyId, period: b.period, category: b.category, classification: "operating" }).map((e) => e.amount));
}

/* --------------------------------- §6 ------------------------------------ */

export type ReliabilityLabel = "Excellent" | "Reliable" | "Watch" | "High attention" | "Insufficient data";

export interface ReliabilityComponent {
  key: string;
  label: string;
  weight: number;
  /** 0–1 */
  score: number;
  detail: string;
}

export interface ReliabilityScore {
  /** null when fewer than 3 settled/overdue payments exist. */
  score: number | null;
  label: ReliabilityLabel;
  components: ReliabilityComponent[];
  metrics: {
    counted: number;
    onTime: number;
    late: number;
    avgDaysLate: number;
    missed: number;
    partial: number;
    outstanding: number;
    totalPaid: number;
    recentOnTimeRate: number;
  };
}

export function reliabilityLabel(score: number | null): ReliabilityLabel {
  if (score === null) return "Insufficient data";
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Reliable";
  if (score >= 60) return "Watch";
  return "High attention";
}

/**
 * Transparent 0–100 payment reliability. Weights follow the plan: on-time
 * ratio 45, average days late 20, missed periods 15, partial payments 10,
 * recent three-month trend 10. Not a credit score — an internal indicator
 * computed only from this ledger.
 */
export function tenantReliability(payments: Payment[], base: ISODate = today()): ReliabilityScore {
  const counted = payments.filter((p) => p.status === "paid" || p.status === "overdue" || p.status === "partial");
  const late = counted.filter((p) => p.daysLate > 0 || p.status === "overdue" || p.status === "partial");
  const onTime = counted.length - late.length;
  const lateDays = late.map((p) => p.daysLate).filter((d) => d > 0);
  const avgDaysLate = lateDays.length > 0 ? sum(lateDays) / lateDays.length : 0;
  const missed = counted.filter((p) => (p.status === "overdue" || p.status === "partial") && p.daysLate > 30).length;
  const partial = counted.filter((p) => p.status === "partial" || (p.status === "paid" && p.amountPaid < p.amountDue)).length;
  const recentFrom = addPeriods(periodOf(base), -2);
  const recent = counted.filter((p) => p.periodMonth >= recentFrom);
  const recentOnTime = recent.filter((p) => p.status === "paid" && p.daysLate === 0).length;
  const recentOnTimeRate = recent.length > 0 ? recentOnTime / recent.length : 1;

  const metrics = {
    counted: counted.length,
    onTime,
    late: late.length,
    avgDaysLate: Math.round(avgDaysLate * 10) / 10,
    missed,
    partial,
    outstanding: outstandingRent(payments),
    totalPaid: sum(payments.map((p) => p.amountPaid)),
    recentOnTimeRate,
  };

  if (counted.length < 3) {
    return { score: null, label: "Insufficient data", components: [], metrics };
  }

  const onTimeRatio = onTime / counted.length;
  const components: ReliabilityComponent[] = [
    { key: "on_time", label: "On-time payments", weight: 45, score: onTimeRatio, detail: `${onTime} of ${counted.length} paid on the due date` },
    { key: "days_late", label: "Average days late", weight: 20, score: Math.max(0, 1 - avgDaysLate / 30), detail: lateDays.length > 0 ? `${metrics.avgDaysLate} days on average when late` : "never late" },
    { key: "missed", label: "Missed periods", weight: 15, score: Math.max(0, 1 - missed / 3), detail: missed > 0 ? `${missed} period${missed === 1 ? "" : "s"} unpaid for more than 30 days` : "no missed periods" },
    { key: "partial", label: "Partial payments", weight: 10, score: 1 - Math.min(1, (partial / counted.length) * 3), detail: partial > 0 ? `${partial} partial payment${partial === 1 ? "" : "s"}` : "always pays in full" },
    { key: "trend", label: "Last 3 months", weight: 10, score: recentOnTimeRate, detail: recent.length > 0 ? `${recentOnTime} of ${recent.length} recent payments on time` : "no recent payments" },
  ];
  const score = Math.round(sum(components.map((c) => c.weight * c.score)));
  return { score, label: reliabilityLabel(score), components, metrics };
}

/* --------------------------------- §7 ------------------------------------ */

export interface HealthComponent {
  key: string;
  label: string;
  weight: number;
  /** 0–100 */
  score: number;
  detail: string;
}

export interface HealthScore {
  score: number;
  components: HealthComponent[];
}

export function combineHealth(components: HealthComponent[]): HealthScore {
  const total = sum(components.map((c) => c.weight));
  const score = total > 0 ? Math.round(sum(components.map((c) => (c.weight * Math.max(0, Math.min(100, c.score))) / total))) : 0;
  return { score, components };
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export const isOpenWorkOrder = (w: WorkOrder): boolean =>
  w.status === "open" || w.status === "assigned" || w.status === "awaiting_quote" || w.status === "awaiting_approval" || w.status === "in_progress";

/**
 * Building health (0–100): collections 25, occupancy 20, profitability 20,
 * maintenance 15, budget control 10, contract/compliance 10. Every component
 * carries the sentence that explains it.
 */
export function buildingHealth(store: Store, propertyId: string, base: ISODate = today()): HealthScore {
  const t = store.settings.thresholds;
  const period = periodOf(base);
  const units = store.units.filter((u) => u.propertyId === propertyId);
  const payments = store.payments.filter((p) => p.propertyId === propertyId);

  // Collections: last three periods, weighted equally.
  const periods = lastPeriods(3, period);
  const rates = periods.map((p) => collectionRate(payments, p, base)).filter((r) => r.due > 0);
  const collection = rates.length > 0 ? sum(rates.map((r) => r.rate)) / rates.length : 1;

  const occ = occupancyRate(units);
  const occupancyScore = clamp100((occ.rate / 0.95) * 100);

  const noiNow = noiFor(store, period, propertyId);
  const prev3 = lastPeriods(3, addPeriods(period, -1)).map((p) => noiFor(store, p, propertyId));
  const avgPrev = prev3.length > 0 ? sum(prev3.map((x) => x.noi)) / prev3.length : noiNow.noi;
  const marginScore = clamp100(noiNow.margin * 125); // 80 % margin → 100
  const trendScore = avgPrev > 0 ? clamp100(50 + ((noiNow.noi - avgPrev) / avgPrev) * 250) : 50;
  const profitability = Math.round(marginScore * 0.6 + trendScore * 0.4);

  const orders = store.workOrders.filter((w) => w.propertyId === propertyId);
  const open = orders.filter(isOpenWorkOrder);
  const emergencies = open.filter((w) => w.priority === "emergency").length;
  const stale = open.filter((w) => daysBetween(w.reportedAt, base) > t.workOrderOpenTooLongDays).length;
  const overduePlans = store.preventivePlans.filter((p) => p.propertyId === propertyId && p.status === "active" && p.nextServiceDate < base).length;
  const brokenAssets = store.assets.filter((a) => a.propertyId === propertyId && a.status === "out_of_service").length;
  const maintenanceScore = clamp100(100 - emergencies * 30 - stale * 12 - overduePlans * 10 - brokenAssets * 20);

  const budgets = store.budgets.filter((b) => b.propertyId === propertyId && (b.period === period || b.period === period.slice(0, 4)));
  const over = budgets.filter((b) => budgetVariance(b.amount, budgetActual(store.expenses, b), t.budgetOverPct).over).length;
  const budgetScore = budgets.length === 0 ? 80 : clamp100(100 - (over / budgets.length) * 100);

  const occupying = store.contracts.filter((c) => c.propertyId === propertyId && isOccupying(c));
  const undecided = occupying.filter((c) => daysBetween(base, c.endDate) <= t.contractWarningDays && c.renewalStatus !== "renew" && c.renewalStatus !== "do_not_renew").length;
  const expiredOccupied = occupying.filter((c) => c.endDate < base).length;
  const property = store.properties.find((p) => p.id === propertyId);
  const insuranceLapsing = property?.insuranceExpiry ? daysBetween(base, property.insuranceExpiry) <= t.insuranceExpiringDays : false;
  const complianceScore = clamp100(100 - undecided * 10 - expiredOccupied * 25 - (insuranceLapsing ? 20 : 0));

  return combineHealth([
    { key: "collections", label: "Rent collection", weight: 25, score: Math.round(collection * 100), detail: rates.length > 0 ? `${Math.round(collection * 100)}% of rent due in the last 3 months collected` : "no rent due yet" },
    { key: "occupancy", label: "Occupancy", weight: 20, score: Math.round(occupancyScore), detail: `${occ.occupied} of ${occ.rentable} rentable units occupied (${Math.round(occ.rate * 100)}%)` },
    { key: "profitability", label: "Profitability", weight: 20, score: profitability, detail: `NOI margin ${Math.round(noiNow.margin * 100)}% this month${avgPrev > 0 ? `, ${noiNow.noi >= avgPrev ? "up" : "down"} vs the 3-month average` : ""}` },
    { key: "maintenance", label: "Maintenance", weight: 15, score: Math.round(maintenanceScore), detail: `${open.length} open work order${open.length === 1 ? "" : "s"}${emergencies > 0 ? `, ${emergencies} emergency` : ""}${overduePlans > 0 ? `, ${overduePlans} overdue service${overduePlans === 1 ? "" : "s"}` : ""}${brokenAssets > 0 ? `, ${brokenAssets} asset${brokenAssets === 1 ? "" : "s"} out of service` : ""}` },
    { key: "budget", label: "Budget control", weight: 10, score: Math.round(budgetScore), detail: budgets.length === 0 ? "no budget set" : over === 0 ? "every category within budget" : `${over} of ${budgets.length} categories over budget` },
    { key: "compliance", label: "Contracts & compliance", weight: 10, score: Math.round(complianceScore), detail: `${undecided} expiring contract${undecided === 1 ? "" : "s"} without a decision${expiredOccupied > 0 ? `, ${expiredOccupied} expired but occupied` : ""}${insuranceLapsing ? ", insurance expiring" : ""}` },
  ]);
}

/* --------------------------------- §8 ------------------------------------ */

/**
 * Unit health (0–100): maintenance cost trend, repeated issues, condition /
 * last inspection, vacancy duration, current tenancy payment problems and
 * renovation need. Informational — the components are the explanation.
 */
export function unitHealth(store: Store, unitId: string, base: ISODate = today()): HealthScore {
  const t = store.settings.thresholds;
  const unit = store.units.find((u) => u.id === unitId);
  if (!unit) return combineHealth([]);
  const period = periodOf(base);

  const recentSpend = sum(lastPeriods(6, period).map((p) => sum(expensesFor(store.expenses, { unitId, period: p }).map((e) => e.amount))));
  const priorSpend = sum(lastPeriods(6, addPeriods(period, -6)).map((p) => sum(expensesFor(store.expenses, { unitId, period: p }).map((e) => e.amount))));
  const costScore = priorSpend > 0 ? clamp100(100 - ((recentSpend - priorSpend) / priorSpend) * 100) : recentSpend > 0 ? 70 : 100;

  const orders = store.workOrders.filter((w) => w.unitId === unitId);
  const windowFrom = daysBetween(base, base) === 0 ? base : base;
  const recentOrders = orders.filter((w) => daysBetween(w.reportedAt, windowFrom) <= t.repeatIssueWindowDays);
  const byCategory = new Map<string, number>();
  for (const w of recentOrders) byCategory.set(w.category, (byCategory.get(w.category) ?? 0) + 1);
  const repeats = [...byCategory.values()].filter((n) => n >= t.repeatIssueMinCount).length;
  const repeatScore = clamp100(100 - repeats * 40 - Math.max(0, recentOrders.length - 1) * 10);

  const inspections = store.inspections.filter((i) => i.unitId === unitId && i.status === "completed").sort((a, b) => ((a.completedDate ?? "") < (b.completedDate ?? "") ? 1 : -1));
  const lastInspection = inspections[0];
  const conditionBase = unit.condition === "good" ? 100 : unit.condition === "fair" ? 75 : unit.condition === "needs_work" ? 45 : 20;
  const inspectionAdj = lastInspection?.overallResult === "fail" ? -30 : lastInspection?.overallResult === "attention" ? -10 : 0;
  const conditionScore = clamp100(conditionBase + inspectionAdj);

  const vacancy = vacancyLoss(unit, base);
  const vacancyScore = unit.status !== "available" ? 100 : clamp100(100 - (vacancy.daysVacant / t.vacantCriticalDays) * 60);

  const current = store.contracts.filter((c) => c.unitId === unitId && isOccupying(c))[0];
  const tenancyPayments = current ? store.payments.filter((p) => p.contractId === current.id) : [];
  const unpaid = tenancyPayments.filter(isUnpaid);
  const lateCount = tenancyPayments.filter((p) => p.daysLate > 0).length;
  const paymentScore = current ? clamp100(100 - unpaid.length * 25 - lateCount * 8) : 100;

  const renovationOpen = store.renovations.some((r) => r.unitId === unitId && (r.status === "planned" || r.status === "in_progress" || r.status === "on_hold"));
  const renovationScore = unit.status === "renovation" ? 40 : renovationOpen ? 55 : unit.condition === "poor" ? 30 : 100;

  return combineHealth([
    { key: "cost", label: "Maintenance cost trend", weight: 20, score: Math.round(costScore), detail: priorSpend > 0 ? `$${Math.round(recentSpend)} in the last 6 months vs $${Math.round(priorSpend)} before` : recentSpend > 0 ? `$${Math.round(recentSpend)} spent in the last 6 months` : "no maintenance spend recorded" },
    { key: "repeats", label: "Repeated issues", weight: 20, score: Math.round(repeatScore), detail: repeats > 0 ? `${repeats} category${repeats === 1 ? "" : "ies"} with ${t.repeatIssueMinCount}+ work orders in ${t.repeatIssueWindowDays} days` : `${recentOrders.length} work order${recentOrders.length === 1 ? "" : "s"} in the last ${t.repeatIssueWindowDays} days` },
    { key: "condition", label: "Condition & inspection", weight: 20, score: Math.round(conditionScore), detail: `${unit.condition.replace("_", " ")}${lastInspection ? ` · last inspection ${lastInspection.overallResult ?? "completed"} on ${lastInspection.completedDate}` : " · no completed inspection"}` },
    { key: "vacancy", label: "Vacancy", weight: 15, score: Math.round(vacancyScore), detail: unit.status === "available" ? `vacant ${vacancy.daysVacant} days · est. $${vacancy.loss} lost` : "occupied" },
    { key: "payments", label: "Current tenancy payments", weight: 15, score: Math.round(paymentScore), detail: current ? `${unpaid.length} unpaid, ${lateCount} late in this tenancy` : "no current tenancy" },
    { key: "renovation", label: "Renovation need", weight: 10, score: renovationScore, detail: unit.status === "renovation" ? "under renovation" : renovationOpen ? "renovation project open" : unit.condition === "poor" ? "condition poor — consider renovation" : "none flagged" },
  ]);
}

/* ---------------------------- Maintenance helpers ------------------------ */

export function maintenanceSpend(expenses: Expense[], propertyId: string, period: PeriodMonth): number {
  return sum(
    expensesFor(expenses, { propertyId, period, classification: "operating" })
      .filter((e) => ["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "contractor"].includes(e.category))
      .map((e) => e.amount),
  );
}

export { isOccupying, occupyingAt };
