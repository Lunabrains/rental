import { indexStore } from "@/lib/data/store";
import { daysUntil, today } from "@/lib/date";
import { tenantReliability, type ReliabilityScore } from "@/lib/derived/metrics";
import { isOccupying } from "@/lib/derived/occupancy";
import type { ID, ISODate, Payment, Reminder, Store } from "@/types";

import { contractRow, getTenantDetails, getTenantTimeline, type ContractRow, type TenantDetails, type TimelineEvent } from "./entities";
import { getDeposits, getInspections, getKeys, getParking, getReminders, getWorkOrders, type DepositRow, type InspectionRow, type KeyRow, type ParkingRow, type WorkOrderRow } from "./operations";

/** Tenant 360° — the plan's §Phase 3 profile, built on the existing details. */
export interface Tenant360 extends TenantDetails {
  reliability: ReliabilityScore;
  latePayments: Payment[];
  workOrders: WorkOrderRow[];
  deposits: DepositRow[];
  inspections: InspectionRow[];
  keys: KeyRow[];
  parking: ParkingRow[];
  reminders: Reminder[];
  timeline: TimelineEvent[];
  /** Same tenant's contract rows including renewal status. */
  contractRows: ContractRow[];
}

export function getTenant360(store: Store, tenantId: ID, base: ISODate = today()): Tenant360 | null {
  const details = getTenantDetails(store, tenantId);
  if (!details) return null;
  const unitIds = new Set(details.contracts.map((c) => c.unit.id));
  const tenancyWindows = details.contracts.map((c) => ({ unitId: c.unit.id, from: c.contract.startDate, to: c.contract.moveOutDate ?? (isOccupying(c.contract) ? null : c.contract.endDate) }));
  // Work orders they raised, plus any on a unit while they lived there.
  const workOrders = getWorkOrders(store, {}, base).filter(
    (w) => w.workOrder.tenantId === tenantId || (w.workOrder.unitId && unitIds.has(w.workOrder.unitId) && tenancyWindows.some((t) => t.unitId === w.workOrder.unitId && w.workOrder.reportedAt >= t.from && (t.to === null || w.workOrder.reportedAt <= t.to))),
  );
  const timeline = getTenantTimeline(store, tenantId, 120);
  for (const w of workOrders) {
    timeline.push({ id: `wo-${w.workOrder.id}`, at: w.workOrder.reportedAt, title: `Maintenance request — ${w.workOrder.title}`, detail: `${w.workOrder.number} · ${w.unit?.unitNumber ?? ""} · ${w.workOrder.status.replace("_", " ")}`, tone: w.isOpen ? "warning" : "default", kind: "maintenance" });
  }
  const reminders = getReminders(store, { includeDone: true }).filter((r) => r.tenantId === tenantId);
  for (const r of reminders) {
    if (r.done && r.doneAt) timeline.push({ id: `rem-${r.id}`, at: r.doneAt, title: `Reminder done — ${r.title}`, detail: r.note, tone: "default", kind: "activity" });
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    ...details,
    reliability: tenantReliability(details.payments, base),
    latePayments: details.payments.filter((p) => (p.status === "paid" && p.daysLate > 0) || p.status === "overdue" || p.status === "partial").sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1)),
    workOrders,
    deposits: getDeposits(store, { tenantId }),
    inspections: getInspections(store, { tenantId }, base),
    keys: getKeys(store, { tenantId }),
    parking: getParking(store, { tenantId }),
    reminders,
    timeline,
    contractRows: details.contracts.map((c) => contractRow(store, c.contract)).filter((x): x is ContractRow => x !== null),
  };
}

/* ------------------------------- Renewals --------------------------------- */

export interface RenewalRow extends ContractRow {
  reliability: ReliabilityScore;
  /** Proposed rent or a suggestion from the increase clause. */
  suggestedRent: number | null;
  clauseSuggestion: string | null;
}

/** Parse "5% on renewal" / "3%" / "CPI" clauses into a suggested rent. */
export function suggestFromClause(rent: number, clause: string | null): { rent: number; label: string } | null {
  if (!clause) return null;
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(clause);
  if (m) {
    const pct = Number(m[1]) / 100;
    return { rent: Math.round((rent * (1 + pct)) / 5) * 5, label: `+${m[1]}% per clause` };
  }
  if (/cpi|index/i.test(clause)) return { rent: Math.round((rent * 1.03) / 5) * 5, label: "CPI-linked (≈3%)" };
  return null;
}

/** Occupying contracts ending within `days`, with everything a renewal decision needs. */
export function getRenewals(store: Store, days = 90, propertyId?: ID, base: ISODate = today()): RenewalRow[] {
  const idx = indexStore(store);
  return store.contracts
    .filter((c) => isOccupying(c) && daysUntil(c.endDate) <= days && (!propertyId || c.propertyId === propertyId))
    .map((c) => contractRow(store, c))
    .filter((x): x is ContractRow => x !== null)
    .map((row) => {
      const payments = idx.paymentsByTenant.get(row.tenant.id) ?? [];
      const clause = suggestFromClause(row.contract.monthlyRent, row.contract.rentIncreaseClause);
      return { ...row, reliability: tenantReliability(payments, base), suggestedRent: row.contract.proposedRent ?? clause?.rent ?? null, clauseSuggestion: clause?.label ?? null };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export interface RenewalSummary {
  total: number;
  awaiting: number;
  renew: number;
  doNotRenew: number;
  undecided: number;
  rentAtStake: number;
  expired: number;
}

export function summarizeRenewals(rows: RenewalRow[]): RenewalSummary {
  return {
    total: rows.length,
    awaiting: rows.filter((r) => r.contract.renewalStatus === "awaiting_decision").length,
    renew: rows.filter((r) => r.contract.renewalStatus === "renew").length,
    doNotRenew: rows.filter((r) => r.contract.renewalStatus === "do_not_renew").length,
    undecided: rows.filter((r) => r.contract.renewalStatus === "upcoming" || r.contract.renewalStatus === "not_due").length,
    rentAtStake: rows.reduce((n, r) => n + r.contract.monthlyRent, 0),
    expired: rows.filter((r) => r.daysRemaining < 0).length,
  };
}
