import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/recompute";
import { addDaysISO, addPeriods, currentPeriod, daysSince, daysUntil, today } from "@/lib/date";
import type { Alert, AlertCategory, AlertSeverity, Contract, ID, ISODate, Property, Store, Tenant, Unit } from "@/types";

import { contractRow, paymentRow, type ContractRow, type PaymentRow } from "./entities";

/* -------------------------------- Contracts ------------------------------- */

export function getExpiringContracts(store: Store, days: number, propertyId?: ID, base: ISODate = today()): ContractRow[] {
  const limit = addDaysISO(base, days);
  return store.contracts
    .filter((c) => isOccupying(c) && c.endDate >= base && c.endDate <= limit && (!propertyId || c.propertyId === propertyId))
    .map((c) => contractRow(store, c))
    .filter((x): x is ContractRow => x !== null)
    .sort((a, b) => (a.contract.endDate < b.contract.endDate ? -1 : 1));
}

/* -------------------------------- Payments -------------------------------- */

export function getUpcomingPayments(store: Store, days: number, propertyId?: ID, base: ISODate = today()): PaymentRow[] {
  const limit = addDaysISO(base, days);
  return store.payments
    .filter(
      (p) =>
        (p.status === "due" || p.status === "scheduled") &&
        p.dueDate >= base &&
        p.dueDate <= limit &&
        (!propertyId || p.propertyId === propertyId),
    )
    .map((p) => paymentRow(store, p))
    .filter((x): x is PaymentRow => x !== null)
    .sort((a, b) => (a.payment.dueDate < b.payment.dueDate ? -1 : 1));
}

export function getOverduePayments(store: Store, propertyId?: ID): PaymentRow[] {
  return store.payments
    .filter((p) => (p.status === "overdue" || p.status === "partial") && (!propertyId || p.propertyId === propertyId))
    .map((p) => paymentRow(store, p))
    .filter((x): x is PaymentRow => x !== null)
    .sort((a, b) => b.payment.daysLate - a.payment.daysLate || b.outstanding - a.outstanding);
}

export interface LatePayer {
  tenant: Tenant;
  unit: Unit;
  property: Property;
  contract: Contract;
  /** Months in the window in which the payment was late or is still unpaid. */
  lateCount: number;
  windowMonths: number;
  avgDaysLate: number;
  currentlyOverdue: boolean;
  outstanding: number;
  lateMonths: string[];
}

/** Tenants late in at least `minLateCount` of the last `monthsWindow` months. */
export function getLatePayers(store: Store, monthsWindow: number, minLateCount: number, propertyId?: ID): LatePayer[] {
  const idx = indexStore(store);
  const from = addPeriods(currentPeriod(), -(monthsWindow - 1));
  const out: LatePayer[] = [];

  for (const tenant of store.tenants) {
    const payments = (idx.paymentsByTenant.get(tenant.id) ?? []).filter(
      (p) => p.periodMonth >= from && p.periodMonth <= currentPeriod() && (!propertyId || p.propertyId === propertyId),
    );
    const late = payments.filter(
      (p) => (p.status === "paid" && p.daysLate > 0) || p.status === "overdue" || p.status === "partial",
    );
    if (late.length < minLateCount) continue;
    const current = (idx.contractsByTenant.get(tenant.id) ?? []).find(isOccupying);
    const unit = current ? idx.unitById.get(current.unitId) : undefined;
    const property = unit ? idx.propertyById.get(unit.propertyId) : undefined;
    if (!current || !unit || !property) continue;
    const lateDays = late.map((p) => p.daysLate).filter((d) => d > 0);
    out.push({
      tenant,
      unit,
      property,
      contract: current,
      lateCount: late.length,
      windowMonths: monthsWindow,
      avgDaysLate: lateDays.length > 0 ? Math.round(lateDays.reduce((n, d) => n + d, 0) / lateDays.length) : 0,
      currentlyOverdue: late.some((p) => p.status === "overdue" || p.status === "partial"),
      outstanding: late.reduce((n, p) => n + Math.max(0, p.amountDue - p.amountPaid), 0),
      lateMonths: late.map((p) => p.periodMonth).sort(),
    });
  }
  return out.sort((a, b) => b.lateCount - a.lateCount || b.outstanding - a.outstanding);
}

export interface OutstandingBalance {
  total: number;
  count: number;
  byProperty: { property: Property; amount: number; count: number; share: number }[];
}

export function getOutstandingBalance(store: Store): OutstandingBalance {
  const idx = indexStore(store);
  const byProperty = new Map<ID, { amount: number; count: number }>();
  let total = 0;
  let count = 0;
  for (const p of store.payments) {
    if (p.status !== "overdue" && p.status !== "partial") continue;
    const amount = p.amountDue - p.amountPaid;
    total += amount;
    count++;
    const cur = byProperty.get(p.propertyId) ?? { amount: 0, count: 0 };
    byProperty.set(p.propertyId, { amount: cur.amount + amount, count: cur.count + 1 });
  }
  return {
    total,
    count,
    byProperty: [...byProperty.entries()]
      .map(([pid, v]) => ({ property: idx.propertyById.get(pid)!, amount: v.amount, count: v.count, share: total > 0 ? v.amount / total : 0 }))
      .filter((x) => x.property)
      .sort((a, b) => b.amount - a.amount),
  };
}

/* --------------------------------- Units ---------------------------------- */

export interface VacantRow {
  unit: Unit;
  property: Property;
  daysVacant: number;
  askingRent: number;
  previousTenant: Tenant | null;
  lostRevenue: number;
}

export function getVacantUnits(store: Store, minDays = 0, propertyId?: ID): VacantRow[] {
  const idx = indexStore(store);
  return store.units
    .filter((u) => u.status === "available" && (!propertyId || u.propertyId === propertyId))
    .map((unit) => {
      const daysVacant = unit.availableSince ? Math.max(0, daysSince(unit.availableSince)) : 0;
      const askingRent = unit.askingRent || unit.lastRent || 0;
      return {
        unit,
        property: idx.propertyById.get(unit.propertyId)!,
        daysVacant,
        askingRent,
        previousTenant: unit.previousTenantId ? idx.tenantById.get(unit.previousTenantId) ?? null : null,
        lostRevenue: Math.round((askingRent / 30) * daysVacant),
      };
    })
    .filter((r) => r.property && r.daysVacant >= minDays)
    .sort((a, b) => b.daysVacant - a.daysVacant);
}

/* --------------------------------- Alerts --------------------------------- */

export interface AlertFilter {
  severity?: AlertSeverity;
  category?: AlertCategory;
  propertyId?: ID;
  unreadOnly?: boolean;
  includeDismissed?: boolean;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, attention: 2, info: 3 };

export function getAlerts(store: Store, filter: AlertFilter = {}): Alert[] {
  return store.alerts
    .filter(
      (a) =>
        (filter.includeDismissed || !a.dismissed) &&
        (!filter.severity || a.severity === filter.severity) &&
        (!filter.category || a.category === filter.category) &&
        (!filter.propertyId || a.propertyId === filter.propertyId) &&
        (!filter.unreadOnly || !a.read),
    )
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.weight - a.weight);
}

/* --------------------------------- Search --------------------------------- */

export interface SearchResults {
  query: string;
  tenants: { tenant: Tenant; unit: Unit | null; property: Property | null }[];
  units: { unit: Unit; property: Property; tenant: Tenant | null }[];
  properties: Property[];
  contracts: { contract: Contract; tenant: Tenant | null; unit: Unit | null }[];
  total: number;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function searchAll(store: Store, query: string, limit = 8): SearchResults {
  const q = norm(query);
  const empty: SearchResults = { query, tenants: [], units: [], properties: [], contracts: [], total: 0 };
  if (q.length < 1) return empty;
  const idx = indexStore(store);
  const digits = q.replace(/\D/g, "");

  const tenants = store.tenants
    .filter(
      (t) =>
        norm(t.fullName).includes(q) ||
        norm(t.email).includes(q) ||
        (digits.length >= 4 && t.phone.replace(/\D/g, "").includes(digits)) ||
        norm(t.idNumber).includes(q),
    )
    .slice(0, limit)
    .map((tenant) => {
      const c = (idx.contractsByTenant.get(tenant.id) ?? []).find(isOccupying);
      const unit = c ? idx.unitById.get(c.unitId) ?? null : null;
      return { tenant, unit, property: unit ? idx.propertyById.get(unit.propertyId) ?? null : null };
    });

  const properties = store.properties.filter((p) => norm(p.name).includes(q) || norm(p.code).includes(q) || norm(p.district).includes(q)).slice(0, limit);

  const units = store.units
    .filter((u) => {
      const p = idx.propertyById.get(u.propertyId);
      const label = `${p?.name ?? ""} ${u.unitNumber}`;
      return norm(u.unitNumber) === q || norm(u.unitNumber).startsWith(q) || norm(label).includes(q);
    })
    .slice(0, limit)
    .map((unit) => {
      const c = idx.activeContractByUnit.get(unit.id);
      return { unit, property: idx.propertyById.get(unit.propertyId)!, tenant: c ? idx.tenantById.get(c.tenantId) ?? null : null };
    })
    .filter((x) => x.property);

  const contracts = store.contracts
    .filter((c) => norm(c.contractNumber).includes(q))
    .slice(0, limit)
    .map((contract) => ({ contract, tenant: idx.tenantById.get(contract.tenantId) ?? null, unit: idx.unitById.get(contract.unitId) ?? null }));

  return { query, tenants, units, properties, contracts, total: tenants.length + units.length + properties.length + contracts.length };
}

/* ---------------------------- Since last login ---------------------------- */

export interface SinceLastLogin {
  paymentsReceived: number;
  paymentsAmount: number;
  unitsVacated: number;
  newAlerts: number;
  contractsExpiringSoon: number;
  windowDays: number;
}

export function getSinceLastLogin(store: Store, windowDays = 2, base: ISODate = today()): SinceLastLogin {
  const from = addDaysISO(base, -windowDays);
  const received = store.payments.filter((p) => p.paidDate !== null && p.paidDate > from && p.paidDate <= base);
  const vacated = store.units.filter((u) => u.status === "available" && u.availableSince !== null && u.availableSince > from);
  const newAlerts = store.alerts.filter((a) => !a.dismissed && !a.read && a.severity === "critical").length;
  return {
    paymentsReceived: received.length,
    paymentsAmount: received.reduce((n, p) => n + p.amountPaid, 0),
    unitsVacated: vacated.length,
    newAlerts,
    contractsExpiringSoon: store.contracts.filter((c) => isOccupying(c) && daysUntil(c.endDate) >= 0 && daysUntil(c.endDate) <= 7).length,
    windowDays,
  };
}
