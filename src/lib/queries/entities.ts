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
  const payments = contract
    ? (idx.paymentsByContract.get(contract.id) ?? []).slice().sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))
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
    reliable: totals.lateCount === 0 && payments.filter((p) => p.status === "paid").length >= 3,
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
