import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/recompute";
import { currentPeriod, daysSince, lastPeriods, periodEnd, periodOf, previousPeriod, today } from "@/lib/date";
import type { Contract, ID, ISODate, PeriodMonth, Property, Store, Unit } from "@/types";

/* ------------------------------ Shared helpers ---------------------------- */

/** Was this contract occupying its unit on date `d`? */
export function occupyingAt(c: Contract, d: ISODate): boolean {
  if (c.startDate > d) return false;
  const leftOn = c.moveOutDate ?? (isOccupying(c) ? null : c.endDate);
  return leftOn === null || leftOn >= d;
}

function occupancyAt(store: Store, d: ISODate, propertyId?: ID): { occupied: number; units: number } {
  const units = propertyId ? store.units.filter((u) => u.propertyId === propertyId) : store.units;
  const unitIds = new Set(units.filter((u) => u.status !== "maintenance").map((u) => u.id));
  const occupiedIds = new Set<ID>();
  for (const c of store.contracts) {
    if (unitIds.has(c.unitId) && occupyingAt(c, d)) occupiedIds.add(c.unitId);
  }
  return { occupied: occupiedIds.size, units: units.length };
}

function rentRollAt(store: Store, d: ISODate, propertyId?: ID): number {
  const seen = new Set<ID>();
  let total = 0;
  for (const c of store.contracts) {
    if (propertyId && c.propertyId !== propertyId) continue;
    if (seen.has(c.unitId) || !occupyingAt(c, d)) continue;
    seen.add(c.unitId);
    total += c.monthlyRent;
  }
  return total;
}

/** Outstanding balance as of date `d`: past due by then, not yet paid by then. */
function outstandingAt(store: Store, d: ISODate, propertyId?: ID): number {
  let total = 0;
  for (const p of store.payments) {
    if (propertyId && p.propertyId !== propertyId) continue;
    if (p.dueDate >= d) continue;
    const paidByThen = p.paidDate !== null && p.paidDate <= d ? p.amountPaid : 0;
    total += Math.max(0, p.amountDue - paidByThen);
  }
  return total;
}

/* ------------------------------- Overview --------------------------------- */

export interface Trend {
  current: number;
  previous: number;
  delta: number;
}

function trend(current: number, previous: number): Trend {
  return { current, previous, delta: current - previous };
}

export interface PortfolioOverview {
  buildings: number;
  units: number;
  occupied: number;
  available: number;
  maintenance: number;
  occupancy: Trend;
  monthlyRevenue: Trend;
  outstanding: Trend;
  criticalAlerts: { total: number; unread: number };
  overdueCount: number;
  expiring30: number;
  expiring60: number;
  vacantOver45: number;
  asOf: ISODate;
}

export function getPortfolioOverview(store: Store, base: ISODate = today()): PortfolioOverview {
  const lastMonthEnd = periodEnd(previousPeriod(periodOf(base)));
  const now = occupancyAt(store, base);
  const prev = occupancyAt(store, lastMonthEnd);
  const occupancyNow = now.units > 0 ? now.occupied / now.units : 0;
  const occupancyPrev = prev.units > 0 ? prev.occupied / prev.units : 0;

  const critical = store.alerts.filter((a) => a.severity === "critical" && !a.dismissed);
  const thresholds = store.settings.thresholds;

  return {
    buildings: store.properties.length,
    units: store.units.length,
    occupied: store.units.filter((u) => u.status === "rented").length,
    available: store.units.filter((u) => u.status === "available").length,
    maintenance: store.units.filter((u) => u.status === "maintenance" || u.status === "reserved").length,
    occupancy: trend(occupancyNow, occupancyPrev),
    monthlyRevenue: trend(rentRollAt(store, base), rentRollAt(store, lastMonthEnd)),
    outstanding: trend(outstandingAt(store, base), outstandingAt(store, lastMonthEnd)),
    criticalAlerts: { total: critical.length, unread: critical.filter((a) => !a.read).length },
    overdueCount: store.payments.filter((p) => p.status === "overdue" || p.status === "partial").length,
    expiring30: store.contracts.filter((c) => isOccupying(c) && c.endDate >= base && daysSince(c.endDate) >= -30).length,
    expiring60: store.contracts.filter((c) => isOccupying(c) && c.endDate >= base && daysSince(c.endDate) >= -60).length,
    vacantOver45: store.units.filter(
      (u) => u.status === "available" && u.availableSince !== null && daysSince(u.availableSince) > thresholds.vacantWarningDays,
    ).length,
    asOf: base,
  };
}

/* ---------------------------- Revenue history ----------------------------- */

export interface RevenuePoint {
  period: PeriodMonth;
  /** Rent due that month (rent roll). */
  billed: number;
  /** Cash received that month, whatever period it was for. */
  collected: number;
  occupancy: number;
}

export function getRevenueHistory(store: Store, months = 12, base: ISODate = today(), propertyId?: ID): RevenuePoint[] {
  const periods = lastPeriods(months, periodOf(base));
  return periods.map((period) => {
    let billed = 0;
    let collected = 0;
    for (const p of store.payments) {
      if (propertyId && p.propertyId !== propertyId) continue;
      if (p.periodMonth === period) billed += p.amountDue;
      if (p.paidDate !== null && periodOf(p.paidDate) === period) collected += p.amountPaid;
    }
    const end = period === currentPeriod() ? base : periodEnd(period);
    const occ = occupancyAt(store, end, propertyId);
    return { period, billed, collected, occupancy: occ.units > 0 ? occ.occupied / occ.units : 0 };
  });
}

/* ------------------------------- Properties ------------------------------- */

export interface PropertySummary {
  property: Property;
  id: ID;
  name: string;
  units: number;
  rented: number;
  available: number;
  maintenance: number;
  occupancy: number;
  monthlyRevenue: number;
  outstanding: number;
  overdueCount: number;
  expiring30: number;
  criticalAlerts: number;
  score: number;
  /** Portfolio share of outstanding, 0–1. */
  outstandingShare: number;
}

function summarizeProperty(store: Store, property: Property, portfolioOutstanding: number, base: ISODate): PropertySummary {
  const idx = indexStore(store);
  const units = idx.unitsByProperty.get(property.id) ?? [];
  const rented = units.filter((u) => u.status === "rented").length;
  const available = units.filter((u) => u.status === "available").length;
  const maintenance = units.length - rented - available;
  const occupancy = units.length > 0 ? rented / units.length : 0;

  // Rent roll is date-aware: a renewal that starts next month counts from
  // its start date, while the current contract keeps counting until then.
  let monthlyRevenue = 0;
  let expiring30 = 0;
  const seenUnits = new Set<ID>();
  for (const c of store.contracts) {
    if (c.propertyId !== property.id) continue;
    if (occupyingAt(c, base) && !seenUnits.has(c.unitId)) {
      seenUnits.add(c.unitId);
      monthlyRevenue += c.monthlyRent;
    }
    if (!isOccupying(c)) continue;
    const d = -daysSince(c.endDate);
    if (d >= 0 && d <= 30) expiring30++;
  }

  let outstanding = 0;
  let overdueCount = 0;
  for (const p of store.payments) {
    if (p.propertyId !== property.id) continue;
    if (p.status === "overdue" || p.status === "partial") {
      outstanding += p.amountDue - p.amountPaid;
      overdueCount++;
    }
  }

  const criticalAlerts = store.alerts.filter(
    (a) => a.severity === "critical" && !a.dismissed && a.propertyId === property.id,
  ).length;

  const score = computePropertyScore({ occupancy, outstanding, monthlyRevenue, expiring30, rented });

  void base;
  return {
    property,
    id: property.id,
    name: property.name,
    units: units.length,
    rented,
    available,
    maintenance,
    occupancy,
    monthlyRevenue,
    outstanding,
    overdueCount,
    expiring30,
    criticalAlerts,
    score,
    outstandingShare: portfolioOutstanding > 0 ? outstanding / portfolioOutstanding : 0,
  };
}

/**
 * 0–100 health score. Occupancy dominates; collection and renewal risk
 * refine it. Tuned so a full, well-collected building sits in the 90s.
 */
export function computePropertyScore(input: {
  occupancy: number;
  outstanding: number;
  monthlyRevenue: number;
  expiring30: number;
  rented: number;
}): number {
  const occupancyPts = 70 * Math.min(1, input.occupancy / 0.9);
  const collectionRate = input.monthlyRevenue > 0 ? Math.max(0, 1 - input.outstanding / input.monthlyRevenue) : 1;
  const collectionPts = 20 * collectionRate;
  const renewalRisk = input.rented > 0 ? input.expiring30 / input.rented : 0;
  const stabilityPts = 10 * (1 - Math.min(1, renewalRisk * 2));
  return Math.round(occupancyPts + collectionPts + stabilityPts);
}

export function getProperties(store: Store, base: ISODate = today()): PropertySummary[] {
  const portfolioOutstanding = store.payments.reduce(
    (n, p) => n + (p.status === "overdue" || p.status === "partial" ? p.amountDue - p.amountPaid : 0),
    0,
  );
  return store.properties
    .map((p) => summarizeProperty(store, p, portfolioOutstanding, base))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPropertyDetails(store: Store, propertyId: ID, base: ISODate = today()): PropertySummary | null {
  const property = indexStore(store).propertyById.get(propertyId);
  if (!property) return null;
  const portfolioOutstanding = store.payments.reduce(
    (n, p) => n + (p.status === "overdue" || p.status === "partial" ? p.amountDue - p.amountPaid : 0),
    0,
  );
  return summarizeProperty(store, property, portfolioOutstanding, base);
}

export interface PropertyPerformance {
  rows: PropertySummary[];
  total: Omit<PropertySummary, "property" | "id" | "score"> & { score: number };
}

/** Ranking for the dashboard: sorted by occupancy, plus a portfolio total row. */
export function getPropertyPerformance(store: Store, base: ISODate = today()): PropertyPerformance {
  const rows = getProperties(store, base).sort((a, b) => b.occupancy - a.occupancy || b.score - a.score);
  const sum = (f: (r: PropertySummary) => number) => rows.reduce((n, r) => n + f(r), 0);
  const units = sum((r) => r.units);
  const rented = sum((r) => r.rented);
  const monthlyRevenue = sum((r) => r.monthlyRevenue);
  const outstanding = sum((r) => r.outstanding);
  const expiring30 = sum((r) => r.expiring30);
  return {
    rows,
    total: {
      name: "Portfolio",
      units,
      rented,
      available: sum((r) => r.available),
      maintenance: sum((r) => r.maintenance),
      occupancy: units > 0 ? rented / units : 0,
      monthlyRevenue,
      outstanding,
      overdueCount: sum((r) => r.overdueCount),
      expiring30,
      criticalAlerts: sum((r) => r.criticalAlerts),
      outstandingShare: 1,
      score: computePropertyScore({ occupancy: units > 0 ? rented / units : 0, outstanding, monthlyRevenue, expiring30, rented }),
    },
  };
}

/* --------------------------- Vacancy opportunity -------------------------- */

export interface VacancyOpportunity {
  vacantUnits: number;
  /** Sum of asking rents of available units — monthly revenue on the table. */
  monthlyPotential: number;
  annualPotential: number;
  longest: { unit: Unit; property: Property; daysVacant: number; askingRent: number }[];
  /** Building with the most vacant units. */
  worstProperty: { property: Property; vacant: number } | null;
}

export function computeVacancyOpportunity(store: Store, base: ISODate = today()): VacancyOpportunity {
  const idx = indexStore(store);
  const vacant = store.units.filter((u) => u.status === "available");
  const monthlyPotential = vacant.reduce((n, u) => n + (u.askingRent || u.lastRent || 0), 0);
  const byProperty = new Map<ID, number>();
  for (const u of vacant) byProperty.set(u.propertyId, (byProperty.get(u.propertyId) ?? 0) + 1);
  let worst: { property: Property; vacant: number } | null = null;
  for (const [pid, n] of byProperty) {
    const property = idx.propertyById.get(pid);
    if (property && (!worst || n > worst.vacant)) worst = { property, vacant: n };
  }
  const longest = vacant
    .map((unit) => ({
      unit,
      property: idx.propertyById.get(unit.propertyId)!,
      daysVacant: unit.availableSince ? Math.max(0, daysSince(unit.availableSince)) : 0,
      askingRent: unit.askingRent || unit.lastRent || 0,
    }))
    .filter((x) => x.property)
    .sort((a, b) => b.daysVacant - a.daysVacant)
    .slice(0, 3);
  void base;
  return {
    vacantUnits: vacant.length,
    monthlyPotential,
    annualPotential: monthlyPotential * 12,
    longest,
    worstProperty: worst,
  };
}
