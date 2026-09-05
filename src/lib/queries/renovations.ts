import { indexStore } from "@/lib/data/store";
import { daysBetween, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import type { Contract, ID, ISODate, Property, Store } from "@/types";

import { getRenovations, type RenovationRow } from "./operations";

export interface RenovationImpact {
  /** Rent on the contract in force before the works (unit projects). */
  rentBefore: number | null;
  /** Rent on the first contract after the works, or the unit's asking rent when nothing is signed yet. */
  rentAfter: number | null;
  afterIsProjected: boolean;
  monthlyUplift: number | null;
  annualUplift: number | null;
  /** Months of uplift needed to recover the cost. */
  paybackMonths: number | null;
  /** Annual uplift ÷ cost. */
  annualReturn: number | null;
  /** Days the unit sat empty during the works (start → end or today). */
  vacantDays: number | null;
  /** Rent forgone while empty, at the previous rent — an estimate. */
  vacancyCost: number | null;
  /** Building projects: cost spread over the building's units. */
  costPerUnit: number | null;
  scheduleDays: number;
  elapsedDays: number;
  /** Days late (positive) or early (negative) against the target; null while live and on time. */
  slipDays: number | null;
}

export function getRenovationImpact(store: Store, id: ID, base: ISODate = today()): RenovationImpact | null {
  const idx = indexStore(store);
  const r = idx.renovationById.get(id);
  if (!r) return null;
  const end = r.actualEndDate ?? base;
  const cost = r.actualCost > 0 ? r.actualCost : r.budget;
  const scheduleDays = daysBetween(r.startDate, r.targetEndDate);
  const elapsedDays = Math.max(0, daysBetween(r.startDate, r.status === "completed" && r.actualEndDate ? r.actualEndDate : base));
  const slipDays = r.status === "completed" && r.actualEndDate ? daysBetween(r.targetEndDate, r.actualEndDate) : base > r.targetEndDate && r.status !== "cancelled" ? daysBetween(r.targetEndDate, base) : null;
  const empty: RenovationImpact = { rentBefore: null, rentAfter: null, afterIsProjected: false, monthlyUplift: null, annualUplift: null, paybackMonths: null, annualReturn: null, vacantDays: null, vacancyCost: null, costPerUnit: null, scheduleDays, elapsedDays, slipDays };
  if (!r.unitId) {
    const units = idx.unitsByProperty.get(r.propertyId)?.length ?? 0;
    return { ...empty, costPerUnit: units > 0 ? cost / units : null };
  }
  const unit = idx.unitById.get(r.unitId);
  if (!unit) return empty;
  const contracts = (idx.contractsByUnit.get(unit.id) ?? []) as Contract[];
  const before = contracts.filter((c) => c.startDate < r.startDate).sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0] ?? null;
  const after = contracts.filter((c) => c.startDate >= (r.actualEndDate ?? r.targetEndDate)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0] ?? null;
  const rentBefore = before?.monthlyRent ?? null;
  const rentAfter = after?.monthlyRent ?? (unit.marketRent !== null && unit.marketRent > 0 ? unit.marketRent : null);
  const monthlyUplift = rentBefore !== null && rentAfter !== null ? rentAfter - rentBefore : null;
  const annualUplift = monthlyUplift !== null ? monthlyUplift * 12 : null;
  const occupiedDuring = contracts.some((c) => isOccupying(c) && c.startDate <= end && (c.moveOutDate ?? c.endDate) >= r.startDate);
  const vacantDays = occupiedDuring ? 0 : Math.max(0, daysBetween(r.startDate, end));
  return {
    ...empty,
    rentBefore,
    rentAfter,
    afterIsProjected: after === null,
    monthlyUplift,
    annualUplift,
    paybackMonths: monthlyUplift !== null && monthlyUplift > 0 && cost > 0 ? Math.round(cost / monthlyUplift) : null,
    annualReturn: annualUplift !== null && cost > 0 ? annualUplift / cost : null,
    vacantDays,
    vacancyCost: rentBefore !== null ? Math.round((rentBefore / 30) * vacantDays) : null,
  };
}

export interface CapexBuildingRow {
  property: Property;
  projects: number;
  live: number;
  budget: number;
  actual: number;
  variance: number;
  overBudget: number;
  delayed: number;
}

export interface CapexSummary {
  live: number;
  planned: number;
  completedThisYear: number;
  overBudget: number;
  delayed: number;
  budgetLive: number;
  actualLive: number;
  spentThisYear: number;
  spentLastYear: number;
  byBuilding: CapexBuildingRow[];
  byYear: { year: string; budget: number; actual: number }[];
}

/** Portfolio CapEx view: what is committed, spent and slipping (plan §Phase 11). */
export function getCapexSummary(store: Store, base: ISODate = today()): CapexSummary {
  const rows = getRenovations(store, {}, base);
  const year = base.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const live = rows.filter((r) => r.renovation.status === "planned" || r.renovation.status === "in_progress" || r.renovation.status === "on_hold");
  const spentIn = (y: string) => store.expenses.filter((e) => !e.deleted && e.classification === "capex" && e.expenseDate.startsWith(y)).reduce((n, e) => n + e.amount, 0);
  const byBuilding = new Map<ID, CapexBuildingRow>();
  for (const r of rows) {
    if (r.renovation.status === "cancelled") continue;
    const row = byBuilding.get(r.property.id) ?? { property: r.property, projects: 0, live: 0, budget: 0, actual: 0, variance: 0, overBudget: 0, delayed: 0 };
    row.projects += 1;
    if (r.renovation.status !== "completed") row.live += 1;
    row.budget += r.renovation.budget;
    row.actual += r.renovation.actualCost;
    row.variance = row.actual - row.budget;
    if (r.variance > 0 && r.renovation.status !== "completed") row.overBudget += 1;
    if (r.delayed) row.delayed += 1;
    byBuilding.set(r.property.id, row);
  }
  const byYear = new Map<string, { budget: number; actual: number }>();
  for (const r of rows) {
    if (r.renovation.status === "cancelled") continue;
    const y = r.renovation.startDate.slice(0, 4);
    const cur = byYear.get(y) ?? { budget: 0, actual: 0 };
    cur.budget += r.renovation.budget;
    cur.actual += r.renovation.actualCost;
    byYear.set(y, cur);
  }
  return {
    live: live.length,
    planned: rows.filter((r) => r.renovation.status === "planned").length,
    completedThisYear: rows.filter((r) => r.renovation.status === "completed" && (r.renovation.actualEndDate ?? "").startsWith(year)).length,
    overBudget: live.filter((r) => r.variance > 0).length,
    delayed: live.filter((r) => r.delayed).length,
    budgetLive: live.reduce((n, r) => n + r.renovation.budget, 0),
    actualLive: live.reduce((n, r) => n + r.renovation.actualCost, 0),
    spentThisYear: spentIn(year),
    spentLastYear: spentIn(lastYear),
    byBuilding: [...byBuilding.values()].sort((a, b) => b.actual - a.actual),
    byYear: [...byYear.entries()].map(([y, v]) => ({ year: y, ...v })).sort((a, b) => a.year.localeCompare(b.year)),
  };
}

export type { RenovationRow };
