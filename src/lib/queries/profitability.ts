import { indexStore } from "@/lib/data/store";
import { addPeriods, daysBetween, lastPeriods, periodOf, today } from "@/lib/date";
import { buildingHealth, collectionRate, isUnpaid, noiFor, occupancyRate, sum, vacancyLoss } from "@/lib/derived/metrics";
import { isOccupying } from "@/lib/derived/occupancy";
import type { ID, ISODate, Property, Store, Unit } from "@/types";

import { getUnit360 } from "./units";

export type ProfitabilityWindow = "month" | "ytd" | "12m";

export function windowRange(window: ProfitabilityWindow, base: ISODate = today()): { from: ISODate; to: ISODate; periods: string[]; label: string } {
  const period = periodOf(base);
  if (window === "month") return { from: `${period}-01`, to: base, periods: [period], label: "This month" };
  if (window === "ytd") {
    const from = `${base.slice(0, 4)}-01-01`;
    const periods = lastPeriods(Number(period.slice(5, 7)), period);
    return { from, to: base, periods, label: "Year to date" };
  }
  const periods = lastPeriods(12, period);
  return { from: `${periods[0]}-01`, to: base, periods, label: "Trailing 12 months" };
}

const MAINTENANCE_CATEGORIES = new Set(["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "contractor"]);
const UTILITY_CATEGORIES = new Set(["water", "electricity"]);

/* --------------------------- Building comparison -------------------------- */

export interface BuildingComparison {
  property: Property;
  units: number;
  occupancy: number;
  revenue: number;
  collected: number;
  collectionRate: number;
  operatingExpenses: number;
  maintenance: number;
  utilities: number;
  capex: number;
  noi: number;
  margin: number;
  outstanding: number;
  vacancyLoss: number;
  health: number;
  /** NOI per unit per month — the like-for-like profitability measure. */
  noiPerUnit: number;
}

export interface PortfolioComparison {
  window: ProfitabilityWindow;
  label: string;
  rows: BuildingComparison[];
  totals: Omit<BuildingComparison, "property" | "health"> & { health: number };
  best: BuildingComparison | null;
  worst: BuildingComparison | null;
}

export function getPortfolioComparison(store: Store, window: ProfitabilityWindow = "12m", base: ISODate = today()): PortfolioComparison {
  const idx = indexStore(store);
  const range = windowRange(window, base);
  const months = range.periods.length;
  const rows: BuildingComparison[] = store.properties.map((property) => {
    const units = idx.unitsByProperty.get(property.id) ?? [];
    const payments = store.payments.filter((p) => p.propertyId === property.id);
    const noi = range.periods.map((p) => noiFor(store, p, property.id));
    const revenue = sum(noi.map((n) => n.income));
    const collected = sum(range.periods.map((p) => collectionRate(payments, p, base).collected));
    const expenses = store.expenses.filter((e) => !e.deleted && e.propertyId === property.id && e.expenseDate >= range.from && e.expenseDate <= range.to);
    const operating = expenses.filter((e) => e.classification === "operating");
    const maintenance = sum(operating.filter((e) => MAINTENANCE_CATEGORIES.has(e.category)).map((e) => e.amount));
    const utilities = sum(operating.filter((e) => UTILITY_CATEGORIES.has(e.category)).map((e) => e.amount));
    const operatingExpenses = sum(operating.map((e) => e.amount));
    const capex = sum(expenses.filter((e) => e.classification === "capex").map((e) => e.amount));
    const net = revenue - operatingExpenses;
    const occ = occupancyRate(units);
    const rentable = Math.max(1, occ.rentable);
    return {
      property,
      units: units.length,
      occupancy: occ.rate,
      revenue,
      collected,
      collectionRate: revenue > 0 ? collected / revenue : 1,
      operatingExpenses,
      maintenance,
      utilities,
      capex,
      noi: net,
      margin: revenue > 0 ? net / revenue : 0,
      outstanding: sum(payments.filter(isUnpaid).map((p) => p.amountDue - p.amountPaid)),
      vacancyLoss: sum(units.filter((u) => u.status === "available").map((u) => vacancyLoss(u, base).loss)),
      health: buildingHealth(store, property.id, base).score,
      noiPerUnit: net / rentable / Math.max(1, months),
    };
  });
  rows.sort((a, b) => b.noiPerUnit - a.noiPerUnit);
  const t = (f: (r: BuildingComparison) => number) => sum(rows.map(f));
  const revenue = t((r) => r.revenue);
  const operatingExpenses = t((r) => r.operatingExpenses);
  const allUnits = t((r) => r.units);
  const rentable = store.units.filter((u) => u.status !== "unavailable").length;
  return {
    window,
    label: range.label,
    rows,
    totals: {
      units: allUnits,
      occupancy: rentable > 0 ? store.units.filter((u) => u.status === "rented").length / rentable : 0,
      revenue,
      collected: t((r) => r.collected),
      collectionRate: revenue > 0 ? t((r) => r.collected) / revenue : 1,
      operatingExpenses,
      maintenance: t((r) => r.maintenance),
      utilities: t((r) => r.utilities),
      capex: t((r) => r.capex),
      noi: revenue - operatingExpenses,
      margin: revenue > 0 ? (revenue - operatingExpenses) / revenue : 0,
      outstanding: t((r) => r.outstanding),
      vacancyLoss: t((r) => r.vacancyLoss),
      health: rows.length > 0 ? Math.round(sum(rows.map((r) => r.health)) / rows.length) : 0,
      noiPerUnit: rentable > 0 ? (revenue - operatingExpenses) / rentable / Math.max(1, months) : 0,
    },
    best: rows[0] ?? null,
    worst: rows.length > 1 ? rows[rows.length - 1] : null,
  };
}

/* ----------------------------- Unit profitability ------------------------- */

export interface UnitProfitability {
  unit: Unit;
  window: ProfitabilityWindow;
  label: string;
  months: number;
  rentBilled: number;
  rentCollected: number;
  operatingExpenses: number;
  maintenanceCost: number;
  capex: number;
  vacancyDays: number;
  vacancyLoss: number;
  /** Rent billed − operating expenses − maintenance not already in expenses. */
  netContribution: number;
  margin: number;
  monthly: { period: string; billed: number; expenses: number; net: number }[];
  breakdown: { label: string; amount: number; tone: "income" | "cost" | "capex" | "estimate" }[];
}

export function getUnitProfitability(store: Store, unitId: ID, window: ProfitabilityWindow = "12m", base: ISODate = today()): UnitProfitability | null {
  const u = getUnit360(store, unitId, base);
  if (!u) return null;
  const range = windowRange(window, base);
  const payments = store.payments.filter((p) => p.unitId === unitId && p.status !== "waived");
  const inRange = (d: ISODate) => d >= range.from && d <= range.to;
  const rentBilled = sum(payments.filter((p) => inRange(`${p.periodMonth}-01`)).map((p) => p.amountDue));
  const rentCollected = sum(payments.filter((p) => p.paidDate && inRange(p.paidDate)).map((p) => p.amountPaid));
  const expenses = u.expenses.filter((e) => inRange(e.expense.expenseDate));
  const operating = expenses.filter((e) => e.expense.classification === "operating");
  const operatingExpenses = sum(operating.map((e) => e.expense.amount));
  const linked = new Set(expenses.map((e) => e.expense.workOrderId).filter(Boolean));
  const maintenanceCost = sum(u.workOrders.filter((w) => w.workOrder.completedAt && inRange(w.workOrder.completedAt) && w.workOrder.actualCost && !linked.has(w.workOrder.id)).map((w) => w.workOrder.actualCost ?? 0));
  const capex = sum(expenses.filter((e) => e.expense.classification === "capex").map((e) => e.expense.amount));
  const reference = u.reference.referenceRent || u.unit.askingRent;
  let vacancyDays = 0;
  for (const v of u.vacancyHistory) {
    const from = v.from > range.from ? v.from : range.from;
    const to = (v.to ?? base) < range.to ? v.to ?? base : range.to;
    if (to > from) vacancyDays += daysBetween(from, to);
  }
  const vacancyLossAmount = Math.round((reference / 30) * vacancyDays);
  const netContribution = rentBilled - operatingExpenses - maintenanceCost;
  const monthly = range.periods.map((period) => {
    const billed = sum(payments.filter((p) => p.periodMonth === period).map((p) => p.amountDue));
    const exp = sum(operating.filter((e) => periodOf(e.expense.expenseDate) === period).map((e) => e.expense.amount)) + sum(u.workOrders.filter((w) => w.workOrder.completedAt && periodOf(w.workOrder.completedAt) === period && w.workOrder.actualCost && !linked.has(w.workOrder.id)).map((w) => w.workOrder.actualCost ?? 0));
    return { period, billed, expenses: exp, net: billed - exp };
  });
  return {
    unit: u.unit,
    window,
    label: range.label,
    months: range.periods.length,
    rentBilled,
    rentCollected,
    operatingExpenses,
    maintenanceCost,
    capex,
    vacancyDays,
    vacancyLoss: vacancyLossAmount,
    netContribution,
    margin: rentBilled > 0 ? netContribution / rentBilled : 0,
    monthly,
    breakdown: [
      { label: "Rent billed", amount: rentBilled, tone: "income" },
      { label: "Rent collected", amount: rentCollected, tone: "income" },
      { label: "Operating expenses attributed", amount: -operatingExpenses, tone: "cost" },
      { label: "Maintenance (work orders without invoices)", amount: -maintenanceCost, tone: "cost" },
      { label: "Renovation / CapEx (excluded from net)", amount: -capex, tone: "capex" },
      { label: `Vacancy loss estimate (${vacancyDays} days)`, amount: -vacancyLossAmount, tone: "estimate" },
    ],
  };
}

/* ------------------------------ Unit ranking ------------------------------ */

export interface UnitRanking {
  unit: Unit;
  property: Property;
  tenant: string | null;
  rentBilled: number;
  costs: number;
  net: number;
  maintenance: number;
  vacancyDays: number;
}

/** Units ranked by net contribution — which apartments carry the building and which drain it. */
export function getUnitRankings(store: Store, window: ProfitabilityWindow = "12m", propertyId?: ID, base: ISODate = today()): UnitRanking[] {
  const idx = indexStore(store);
  return store.units
    .filter((u) => u.status !== "unavailable" && (!propertyId || u.propertyId === propertyId))
    .map((unit) => {
      const p = getUnitProfitability(store, unit.id, window, base);
      const property = idx.propertyById.get(unit.propertyId);
      if (!p || !property) return null;
      const contract = (idx.contractsByUnit.get(unit.id) ?? []).find(isOccupying);
      return {
        unit,
        property,
        tenant: contract ? idx.tenantById.get(contract.tenantId)?.fullName ?? null : null,
        rentBilled: p.rentBilled,
        costs: p.operatingExpenses + p.maintenanceCost,
        net: p.netContribution,
        maintenance: p.maintenanceCost + sum(p.breakdown.filter((b) => b.label.startsWith("Operating")).map(() => 0)),
        vacancyDays: p.vacancyDays,
      };
    })
    .filter((x): x is UnitRanking => x !== null)
    .sort((a, b) => b.net - a.net);
}

export { addPeriods };
