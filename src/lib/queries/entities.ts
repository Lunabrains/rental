import { indexStore } from "@/lib/data/store";
import { isOccupying } from "@/lib/derived/recompute";
import { daysSince, daysUntil, today } from "@/lib/date";
import type {
  ActivityLog,
  Alert,
  Contract,
  ID,
  ISODate,
  Payment,
  Property,
  Store,
  StoredDocument,
  Tenant,
  Unit,
} from "@/types";

/* ------------------------------ Building grid ----------------------------- */

export interface UnitCell {
  unit: Unit;
  tenant: Tenant | null;
  contract: Contract | null;
  hasOverdue: boolean;
  expiringInDays: number | null;
  daysVacant: number | null;
}

export interface FloorRow {
  floor: number;
  units: UnitCell[];
}

function buildCell(store: Store, unit: Unit): UnitCell {
  const idx = indexStore(store);
  const contract = idx.activeContractByUnit.get(unit.id) ?? (idx.contractsByUnit.get(unit.id) ?? []).find(isOccupying) ?? null;
  const tenant = contract ? idx.tenantById.get(contract.tenantId) ?? null : null;
  const hasOverdue = contract
    ? (idx.paymentsByContract.get(contract.id) ?? []).some((p) => p.status === "overdue" || p.status === "partial")
    : false;
  return {
    unit,
    tenant,
    contract,
    hasOverdue,
    expiringInDays: contract ? daysUntil(contract.endDate) : null,
    daysVacant: unit.status === "available" && unit.availableSince ? Math.max(0, daysSince(unit.availableSince)) : null,
  };
}

/** Floors stacked highest first; units left→right by number within a floor. */
export function getUnitsByProperty(store: Store, propertyId: ID): FloorRow[] {
  const units = (indexStore(store).unitsByProperty.get(propertyId) ?? []).slice();
  const byFloor = new Map<number, Unit[]>();
  for (const u of units) {
    const list = byFloor.get(u.floor);
    if (list) list.push(u);
    else byFloor.set(u.floor, [u]);
  }
  return [...byFloor.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([floor, list]) => ({
      floor,
      units: list
        .sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }))
        .map((u) => buildCell(store, u)),
    }));
}

/* ------------------------------ Ledger totals ----------------------------- */

export interface LedgerTotals {
  paid: number;
  outstanding: number;
  lateCount: number;
  avgDaysLate: number;
  onTimeRate: number;
}

export function ledgerTotals(payments: Payment[]): LedgerTotals {
  const settled = payments.filter((p) => p.status === "paid");
  const late = settled.filter((p) => p.daysLate > 0);
  const unpaid = payments.filter((p) => p.status === "overdue" || p.status === "partial");
  const lateCount = late.length + unpaid.filter((p) => p.dueDate < today()).length;
  const avg = late.length > 0 ? late.reduce((n, p) => n + p.daysLate, 0) / late.length : 0;
  const counted = settled.length + unpaid.length;
  return {
    paid: payments.reduce((n, p) => n + p.amountPaid, 0),
    outstanding: unpaid.reduce((n, p) => n + (p.amountDue - p.amountPaid), 0),
    lateCount,
    avgDaysLate: Math.round(avg * 10) / 10,
    onTimeRate: counted > 0 ? (counted - lateCount) / counted : 1,
  };
}

/* ------------------------------- Unit detail ------------------------------ */

export interface UnitDetails {
  unit: Unit;
  property: Property;
  contract: Contract | null;
  tenant: Tenant | null;
  payments: Payment[];
  totals: LedgerTotals;
  documents: StoredDocument[];
  activity: ActivityLog[];
  alerts: Alert[];
  previousTenant: Tenant | null;
  daysVacant: number | null;
  history: Contract[];
}

export function getUnitDetails(store: Store, unitId: ID): UnitDetails | null {
  const idx = indexStore(store);
  const unit = idx.unitById.get(unitId);
  if (!unit) return null;
  const property = idx.propertyById.get(unit.propertyId);
  if (!property) return null;

  const cell = buildCell(store, unit);
  const contract = cell.contract;
  const tenant = cell.tenant;
  // The ledger follows the tenant in this unit across renewals, so a renewed
  // contract's last month and the new one's first month sit in one list.
  const payments = contract
    ? (idx.paymentsByTenant.get(contract.tenantId) ?? [])
        .filter((p) => p.unitId === unit.id)
        .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
    : [];
  const documents = tenant
    ? (idx.documentsByTenant.get(tenant.id) ?? []).filter((d) => !d.contractId || d.contractId === contract?.id || d.unitId === unit.id)
    : [];
  const activity = store.activity
    .filter((a) => a.unitId === unit.id || (tenant && a.tenantId === tenant.id) || (contract && a.contractId === contract.id))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const alerts = store.alerts.filter(
    (a) => !a.dismissed && (a.unitId === unit.id || (tenant && a.tenantId === tenant.id) || (contract && a.entityType === "contract" && a.entityId === contract.id)),
  );
  const history = (idx.contractsByUnit.get(unit.id) ?? []).slice().sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  return {
    unit,
    property,
    contract,
    tenant,
    payments,
    totals: ledgerTotals(payments),
    documents,
    activity,
    alerts,
    previousTenant: unit.previousTenantId ? idx.tenantById.get(unit.previousTenantId) ?? null : null,
    daysVacant: cell.daysVacant,
    history,
  };
}

/* ------------------------------ Tenant detail ----------------------------- */

export interface ContractWithPlace {
  contract: Contract;
  unit: Unit;
  property: Property;
  daysRemaining: number;
}

export interface TenantDetails {
  tenant: Tenant;
  current: ContractWithPlace | null;
  contracts: ContractWithPlace[];
  payments: Payment[];
  totals: LedgerTotals;
  documents: StoredDocument[];
  activity: ActivityLog[];
  alerts: Alert[];
  /** Months as a tenant across all contracts. */
  tenureMonths: number;
}

export function withPlace(store: Store, contract: Contract): ContractWithPlace | null {
  const idx = indexStore(store);
  const unit = idx.unitById.get(contract.unitId);
  const property = unit ? idx.propertyById.get(unit.propertyId) : undefined;
  if (!unit || !property) return null;
  return { contract, unit, property, daysRemaining: daysUntil(contract.endDate) };
}

export function getTenantDetails(store: Store, tenantId: ID): TenantDetails | null {
  const idx = indexStore(store);
  const tenant = idx.tenantById.get(tenantId);
  if (!tenant) return null;
  const contracts = (idx.contractsByTenant.get(tenant.id) ?? [])
    .slice()
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .map((c) => withPlace(store, c))
    .filter((x): x is ContractWithPlace => x !== null);
  const current = contracts.find((c) => isOccupying(c.contract)) ?? null;
  const payments = (idx.paymentsByTenant.get(tenant.id) ?? []).slice().sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const tenureMonths = contracts.reduce((n, c) => n + c.contract.durationMonths, 0);
  return {
    tenant,
    current,
    contracts,
    payments,
    totals: ledgerTotals(payments),
    documents: (idx.documentsByTenant.get(tenant.id) ?? []).slice(),
    activity: store.activity.filter((a) => a.tenantId === tenant.id).sort((a, b) => (a.at < b.at ? 1 : -1)),
    alerts: store.alerts.filter((a) => !a.dismissed && a.tenantId === tenant.id),
    tenureMonths,
  };
}

/* ----------------------------- Contract detail ---------------------------- */

export interface ContractDetails extends ContractWithPlace {
  tenant: Tenant;
  payments: Payment[];
  totals: LedgerTotals;
  previous: Contract | null;
  next: Contract | null;
  documents: StoredDocument[];
}

export function getContractDetails(store: Store, contractId: ID): ContractDetails | null {
  const idx = indexStore(store);
  const contract = idx.contractById.get(contractId);
  if (!contract) return null;
  const place = withPlace(store, contract);
  const tenant = idx.tenantById.get(contract.tenantId);
  if (!place || !tenant) return null;
  const payments = (idx.paymentsByContract.get(contract.id) ?? []).slice().sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  return {
    ...place,
    tenant,
    payments,
    totals: ledgerTotals(payments),
    previous: contract.renewedFromContractId ? idx.contractById.get(contract.renewedFromContractId) ?? null : null,
    next: contract.renewedToContractId ? idx.contractById.get(contract.renewedToContractId) ?? null : null,
    documents: store.documents.filter((d) => d.contractId === contract.id),
  };
}

/* ------------------------------ List queries ------------------------------ */

export interface TenantRow {
  tenant: Tenant;
  current: ContractWithPlace | null;
  outstanding: number;
  lateCount: number;
  hasOverdue: boolean;
}

export function getTenants(store: Store): TenantRow[] {
  const idx = indexStore(store);
  return store.tenants
    .map((tenant) => {
      const contracts = idx.contractsByTenant.get(tenant.id) ?? [];
      const currentContract = contracts.filter(isOccupying).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
      const payments = idx.paymentsByTenant.get(tenant.id) ?? [];
      const totals = ledgerTotals(payments);
      return {
        tenant,
        current: currentContract ? withPlace(store, currentContract) : null,
        outstanding: totals.outstanding,
        lateCount: totals.lateCount,
        hasOverdue: payments.some((p) => p.status === "overdue" || p.status === "partial"),
      };
    })
    .sort((a, b) => a.tenant.fullName.localeCompare(b.tenant.fullName));
}

export interface ContractRow extends ContractWithPlace {
  tenant: Tenant;
  outstanding: number;
  hasOverdue: boolean;
  /** Never late across the whole ledger. */
  reliable: boolean;
  lateCount: number;
}

export function contractRow(store: Store, contract: Contract): ContractRow | null {
  const idx = indexStore(store);
  const place = withPlace(store, contract);
  const tenant = idx.tenantById.get(contract.tenantId);
  if (!place || !tenant) return null;
  const payments = idx.paymentsByTenant.get(tenant.id) ?? [];
  const totals = ledgerTotals(payments);
  return {
    ...place,
    tenant,
    outstanding: totals.outstanding,
    hasOverdue: payments.some((p) => p.status === "overdue" || p.status === "partial"),
    // Reliable = a full year of rent, never a day late.
    reliable: totals.lateCount === 0 && payments.filter((p) => p.status === "paid").length >= 12,
    lateCount: totals.lateCount,
  };
}

export function getContracts(store: Store): ContractRow[] {
  return store.contracts
    .map((c) => contractRow(store, c))
    .filter((x): x is ContractRow => x !== null)
    .sort((a, b) => (a.contract.endDate < b.contract.endDate ? -1 : 1));
}

export interface PaymentRow {
  payment: Payment;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  contract: Contract;
  outstanding: number;
}

export function paymentRow(store: Store, payment: Payment): PaymentRow | null {
  const idx = indexStore(store);
  const tenant = idx.tenantById.get(payment.tenantId);
  const unit = idx.unitById.get(payment.unitId);
  const property = idx.propertyById.get(payment.propertyId);
  const contract = idx.contractById.get(payment.contractId);
  if (!tenant || !unit || !property || !contract) return null;
  return { payment, tenant, unit, property, contract, outstanding: Math.max(0, payment.amountDue - payment.amountPaid) };
}

export function getPayments(store: Store): PaymentRow[] {
  return store.payments
    .map((p) => paymentRow(store, p))
    .filter((x): x is PaymentRow => x !== null)
    .sort((a, b) => (a.payment.dueDate < b.payment.dueDate ? 1 : -1));
}

export function getDocuments(store: Store): (StoredDocument & { tenant: Tenant | null; property: Property | null })[] {
  const idx = indexStore(store);
  return store.documents
    .map((d) => ({
      ...d,
      tenant: d.tenantId ? idx.tenantById.get(d.tenantId) ?? null : null,
      property: d.propertyId ? idx.propertyById.get(d.propertyId) ?? null : null,
    }))
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
}

export function getActivity(store: Store, entityType?: ActivityLog["entityType"], entityId?: ID, limit = 50): ActivityLog[] {
  return store.activity
    .filter((a) => (!entityType || a.entityType === entityType) && (!entityId || a.entityId === entityId))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}

export function daysRemainingLabel(endDate: ISODate): string {
  const d = daysUntil(endDate);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "ends today";
  return `${d}d left`;
}

/* -------------------------------- Timeline -------------------------------- */

export type TimelineTone = "default" | "success" | "warning" | "critical" | "info";

export interface TimelineEvent {
  id: string;
  /** ISO date or datetime — sorted descending. */
  at: string;
  title: string;
  detail: string | null;
  tone: TimelineTone;
  kind: "contract" | "payment" | "document" | "activity" | "unit" | "maintenance" | "asset" | "inspection" | "renovation" | "expense" | "deposit";
}

/**
 * A unit's story: contract starts/renewals/ends, every rent payment (late
 * ones flagged), documents, and the activity log — newest first.
 */
export function getUnitTimeline(store: Store, unitId: ID, limit = 60): TimelineEvent[] {
  const idx = indexStore(store);
  const events: TimelineEvent[] = [];
  const base = today();

  for (const c of idx.contractsByUnit.get(unitId) ?? []) {
    const name = idx.tenantById.get(c.tenantId)?.fullName ?? "Tenant";
    const renewal = c.renewedFromContractId !== null;
    if (c.startDate <= base) {
      events.push({
        id: `c-start-${c.id}`,
        at: c.startDate,
        title: renewal ? `Contract renewed — ${name}` : `${name} moved in`,
        detail: `${c.contractNumber} · ${c.durationMonths} months · $${c.monthlyRent.toLocaleString("en-US")}/month`,
        tone: "success",
        kind: "contract",
      });
    }
    const leftOn = c.moveOutDate ?? (c.status === "expired" || c.status === "terminated" || c.status === "renewed" ? c.endDate : null);
    if (leftOn && leftOn <= base && c.status !== "renewed") {
      events.push({
        id: `c-end-${c.id}`,
        at: leftOn,
        title: c.status === "terminated" ? `${name} moved out (contract ended early)` : `${name} moved out`,
        detail: `${c.contractNumber} ended`,
        tone: "warning",
        kind: "contract",
      });
    }
    if (c.status === "notice_given" && c.moveOutDate) {
      events.push({
        id: `c-notice-${c.id}`,
        at: c.createdAt,
        title: `${name} gave notice`,
        detail: `Moving out ${c.moveOutDate}`,
        tone: "warning",
        kind: "contract",
      });
    }
  }

  for (const p of store.payments) {
    if (p.unitId !== unitId) continue;
    const name = idx.tenantById.get(p.tenantId)?.fullName ?? "Tenant";
    if (p.status === "paid" && p.paidDate) {
      events.push({
        id: `p-${p.id}`,
        at: p.paidDate,
        title: p.daysLate > 0 ? `Rent paid ${p.daysLate} days late — ${name}` : `Rent paid — ${name}`,
        detail: `$${p.amountPaid.toLocaleString("en-US")} for ${p.periodMonth}${p.reference ? ` · ${p.reference}` : ""}`,
        tone: p.daysLate > 3 ? "warning" : "default",
        kind: "payment",
      });
    } else if (p.status === "partial" && p.paidDate) {
      events.push({
        id: `p-${p.id}`,
        at: p.paidDate,
        title: `Partial payment — ${name}`,
        detail: `$${p.amountPaid.toLocaleString("en-US")} of $${p.amountDue.toLocaleString("en-US")} for ${p.periodMonth}`,
        tone: "warning",
        kind: "payment",
      });
    } else if (p.status === "overdue") {
      events.push({
        id: `p-${p.id}`,
        at: p.dueDate,
        title: `Rent overdue — ${name}`,
        detail: `$${p.amountDue.toLocaleString("en-US")} for ${p.periodMonth} · ${p.daysLate} days late`,
        tone: "critical",
        kind: "payment",
      });
    }
  }

  for (const d of store.documents) {
    const belongs = d.unitId === unitId || (d.tenantId && (idx.contractsByUnit.get(unitId) ?? []).some((c) => c.tenantId === d.tenantId));
    if (!belongs) continue;
    events.push({
      id: `d-${d.id}`,
      at: d.uploadedAt,
      title: d.generated ? `Receipt generated — ${d.title}` : `Document added — ${d.title}`,
      detail: d.fileName,
      tone: "info",
      kind: "document",
    });
  }

  const tenantIds = new Set((idx.contractsByUnit.get(unitId) ?? []).map((c) => c.tenantId));
  for (const a of store.activity) {
    if (a.unitId === unitId || (a.tenantId && tenantIds.has(a.tenantId))) {
      events.push({ id: `a-${a.id}`, at: a.at, title: a.message, detail: `by ${a.actor}`, tone: "info", kind: "activity" });
    }
  }

  return events
    .filter((e) => e.at.slice(0, 10) <= base)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/** A tenant's story across every unit they have rented — newest first. */
export function getTenantTimeline(store: Store, tenantId: ID, limit = 80): TimelineEvent[] {
  const idx = indexStore(store);
  const tenant = idx.tenantById.get(tenantId);
  if (!tenant) return [];
  const unitIds = new Set((idx.contractsByTenant.get(tenantId) ?? []).map((c) => c.unitId));
  const seen = new Set<string>();
  const events: TimelineEvent[] = [];
  for (const unitId of unitIds) {
    for (const e of getUnitTimeline(store, unitId, 500)) {
      // Keep only events that belong to this tenant (payments, contracts,
      // documents and activity all mention them or are keyed to them).
      const mine =
        e.kind === "activity"
          ? store.activity.some((a) => `a-${a.id}` === e.id && a.tenantId === tenantId)
          : e.kind === "payment"
            ? store.payments.some((p) => `p-${p.id}` === e.id && p.tenantId === tenantId)
            : e.kind === "contract"
              ? store.contracts.some((c) => (`c-start-${c.id}` === e.id || `c-end-${c.id}` === e.id || `c-notice-${c.id}` === e.id) && c.tenantId === tenantId)
              : e.kind === "document"
                ? store.documents.some((d) => `d-${d.id}` === e.id && d.tenantId === tenantId)
                : false;
      if (mine && !seen.has(e.id)) {
        seen.add(e.id);
        events.push(e);
      }
    }
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}
