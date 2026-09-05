import { indexStore } from "@/lib/data/store";
import { addPeriods, currentPeriod, daysBetween, daysUntil, lastPeriods, periodEnd, periodOf, today } from "@/lib/date";
import { arrearsAging, collectionRate, isUnpaid, outstandingRent, sum, tenantReliability, type ArrearsAging } from "@/lib/derived/metrics";
import { isOccupying, occupyingAt } from "@/lib/derived/occupancy";
import type { Contract, ID, ISODate, Payment, PaymentStatus, PeriodMonth, Property, SecurityDeposit, Store, Tenant, Unit } from "@/types";
import { FREQUENCY_MONTHS } from "@/types";

import { getLatePayers } from "./lists";

/* -------------------------------- Rent roll ------------------------------- */

export type RentRollStatus = PaymentStatus | "vacant" | "not_billed";

export interface RentRollRow {
  unit: Unit;
  property: Property;
  contract: Contract | null;
  tenant: Tenant | null;
  payment: Payment | null;
  deposit: SecurityDeposit | null;
  rent: number;
  dueDate: ISODate | null;
  amountDue: number;
  amountPaid: number;
  outstanding: number;
  status: RentRollStatus;
  daysOverdue: number;
  depositHeld: number;
  contractEnd: ISODate | null;
  daysToExpiry: number | null;
  occupied: boolean;
}

export interface RentRollFilter {
  period?: PeriodMonth;
  propertyId?: ID;
  occupancy?: "all" | "occupied" | "vacant";
  status?: "all" | "paid" | "partial" | "overdue" | "unpaid" | "due" | "waived";
  /** Only rows overdue at least this many days. */
  overdueMin?: number;
  /** Only rows whose contract ends within 60 days. */
  expiring?: boolean;
}

export interface RentRollSummary {
  period: PeriodMonth;
  units: number;
  occupied: number;
  vacant: number;
  rentRoll: number;
  expected: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
  overdueTenants: number;
  overdueAmount: number;
}

export interface RentRoll {
  rows: RentRollRow[];
  summary: RentRollSummary;
}

/**
 * One row per rentable unit for a period: who occupied it, what was due, what
 * came in, what is still owed — the screen that answers "who hasn't paid?"
 * without a spreadsheet. Past periods show the history as it stands today.
 */
export function getRentRoll(store: Store, filter: RentRollFilter = {}, base: ISODate = today()): RentRoll {
  const idx = indexStore(store);
  const period = filter.period ?? periodOf(base);
  const asOf = period === periodOf(base) ? base : period < periodOf(base) ? periodEnd(period) : `${period}-01`;
  const rows: RentRollRow[] = [];

  for (const unit of store.units) {
    if (unit.status === "unavailable") continue;
    if (filter.propertyId && unit.propertyId !== filter.propertyId) continue;
    const property = idx.propertyById.get(unit.propertyId);
    if (!property) continue;
    const contracts = (idx.contractsByUnit.get(unit.id) ?? []).filter((c) => occupyingAt(c, asOf) || (c.startDate <= asOf && c.endDate >= `${period}-01` && (c.moveOutDate ?? c.endDate) >= `${period}-01` && c.status !== "renewed"));
    const contract = contracts.sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
    const tenant = contract ? idx.tenantById.get(contract.tenantId) ?? null : null;
    const contractPayments = contract ? (idx.paymentsByContract.get(contract.id) ?? []) : [];
    const step = contract ? FREQUENCY_MONTHS[contract.paymentFrequency] ?? 1 : 1;
    let payment = contractPayments.find((p) => p.periodMonth === period) ?? null;
    if (!payment && contract && step > 1) {
      // Quarterly / annual billing: the covering payment starts up to `step - 1` months earlier.
      payment = contractPayments.find((p) => p.periodMonth <= period && addPeriods(p.periodMonth, step - 1) >= period) ?? null;
    }
    const deposit = contract ? idx.depositByContract.get(contract.id) ?? null : null;
    const occupied = contract !== null;

    let status: RentRollStatus;
    if (!contract) status = "vacant";
    else if (!payment) status = "not_billed";
    else status = payment.status;

    const amountDue = payment ? payment.amountDue : 0;
    const amountPaid = payment ? Math.min(payment.amountDue, payment.amountPaid) : 0;
    const outstanding = payment && isUnpaid(payment) ? Math.max(0, payment.amountDue - payment.amountPaid) : 0;
    const daysOverdue = payment && isUnpaid(payment) ? payment.daysLate : 0;

    const row: RentRollRow = {
      unit,
      property,
      contract,
      tenant,
      payment,
      deposit,
      rent: contract?.monthlyRent ?? 0,
      dueDate: payment?.dueDate ?? null,
      amountDue,
      amountPaid,
      outstanding,
      status,
      daysOverdue,
      depositHeld: deposit?.amountHeld ?? contract?.deposit ?? 0,
      contractEnd: contract?.endDate ?? null,
      daysToExpiry: contract ? daysBetween(base, contract.endDate) : null,
      occupied,
    };

    if (filter.occupancy === "occupied" && !occupied) continue;
    if (filter.occupancy === "vacant" && occupied) continue;
    if (filter.status && filter.status !== "all") {
      if (filter.status === "unpaid") {
        if (!(status === "overdue" || status === "partial")) continue;
      } else if (status !== filter.status) continue;
    }
    if (filter.overdueMin && daysOverdue < filter.overdueMin) continue;
    if (filter.expiring && !(row.daysToExpiry !== null && row.daysToExpiry >= 0 && row.daysToExpiry <= 60)) continue;
    rows.push(row);
  }

  rows.sort((a, b) => a.property.name.localeCompare(b.property.name) || a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true }));

  const occupiedRows = rows.filter((r) => r.occupied);
  const expected = sum(rows.map((r) => (r.status === "waived" ? 0 : r.amountDue)));
  const collected = sum(rows.map((r) => (r.status === "waived" ? 0 : r.amountPaid)));
  const overdueRows = rows.filter((r) => r.status === "overdue" || r.status === "partial");
  return {
    rows,
    summary: {
      period,
      units: rows.length,
      occupied: occupiedRows.length,
      vacant: rows.length - occupiedRows.length,
      rentRoll: sum(occupiedRows.map((r) => r.rent)),
      expected,
      collected,
      outstanding: sum(rows.map((r) => r.outstanding)),
      collectionRate: expected > 0 ? collected / expected : 1,
      overdueTenants: new Set(overdueRows.map((r) => r.tenant?.id)).size,
      overdueAmount: sum(overdueRows.map((r) => r.outstanding)),
    },
  };
}

/* --------------------------- Payments dashboard --------------------------- */

export interface CollectionPoint {
  period: PeriodMonth;
  billed: number;
  collected: number;
  /** Cash received in the month, whatever rent period it was for. */
  cashIn: number;
  rate: number;
}

export interface AttentionTenant {
  tenant: Tenant;
  unit: Unit;
  property: Property;
  contract: Contract;
  outstanding: number;
  maxDaysLate: number;
  unpaidCount: number;
  partialCount: number;
  lateCount: number;
  reliabilityScore: number | null;
  reasons: string[];
  /** The payment to record first. */
  nextPaymentId: ID | null;
}

export interface PaymentsDashboard {
  period: PeriodMonth;
  expectedThisMonth: number;
  collectedForMonth: number;
  cashThisMonth: number;
  collectionRateThisMonth: number;
  outstanding: number;
  outstandingCount: number;
  partialAmount: number;
  partialCount: number;
  overdueTenants: number;
  aging: ArrearsAging;
  trend: CollectionPoint[];
  attention: AttentionTenant[];
  dueNext7: { count: number; amount: number };
}

export function getPaymentsDashboard(store: Store, propertyId?: ID, base: ISODate = today()): PaymentsDashboard {
  const idx = indexStore(store);
  const period = periodOf(base);
  const payments = store.payments.filter((p) => !propertyId || p.propertyId === propertyId);
  const forMonth = collectionRate(payments, period, base);
  const cashThisMonth = sum(payments.filter((p) => p.paidDate && periodOf(p.paidDate) === period).map((p) => p.amountPaid));
  const unpaid = payments.filter(isUnpaid);
  const partial = payments.filter((p) => p.status === "partial");

  const trend: CollectionPoint[] = lastPeriods(12, period).map((p) => {
    const r = collectionRate(payments, p, p === period ? base : undefined);
    return { period: p, billed: r.due, collected: r.collected, cashIn: sum(payments.filter((x) => x.paidDate && periodOf(x.paidDate) === p).map((x) => x.amountPaid)), rate: r.rate };
  });

  const late = new Map(getLatePayers(store, store.settings.thresholds.repeatLateWindowMonths, store.settings.thresholds.repeatLateMinCount, propertyId).map((l) => [l.tenant.id, l]));
  const attention: AttentionTenant[] = [];
  for (const tenant of store.tenants) {
    const contract = (idx.contractsByTenant.get(tenant.id) ?? []).find(isOccupying);
    if (!contract || (propertyId && contract.propertyId !== propertyId)) continue;
    const mine = idx.paymentsByTenant.get(tenant.id) ?? [];
    const owed = outstandingRent(mine);
    const unpaidMine = mine.filter(isUnpaid);
    const lateInfo = late.get(tenant.id);
    const reasons: string[] = [];
    if (owed > contract.monthlyRent * store.settings.thresholds.tenantBalanceHighMonths) reasons.push(`owes ${Math.round(owed / contract.monthlyRent)} months of rent`);
    else if (unpaidMine.length > 0) reasons.push(`${unpaidMine.length} unpaid`);
    if (unpaidMine.some((p) => p.status === "partial")) reasons.push("partial payment");
    if (lateInfo) reasons.push(`late ${lateInfo.lateCount} of ${lateInfo.windowMonths} months`);
    if (reasons.length === 0) continue;
    const unit = idx.unitById.get(contract.unitId);
    const property = unit ? idx.propertyById.get(unit.propertyId) : undefined;
    if (!unit || !property) continue;
    const reliability = tenantReliability(mine, base);
    attention.push({
      tenant,
      unit,
      property,
      contract,
      outstanding: owed,
      maxDaysLate: Math.max(0, ...unpaidMine.map((p) => p.daysLate)),
      unpaidCount: unpaidMine.length,
      partialCount: unpaidMine.filter((p) => p.status === "partial").length,
      lateCount: lateInfo?.lateCount ?? mine.filter((p) => p.status === "paid" && p.daysLate > 0).length,
      reliabilityScore: reliability.score,
      reasons,
      nextPaymentId: unpaidMine.sort((a, b) => b.daysLate - a.daysLate)[0]?.id ?? null,
    });
  }
  attention.sort((a, b) => b.outstanding - a.outstanding || b.maxDaysLate - a.maxDaysLate);

  const next7 = payments.filter((p) => (p.status === "due" || p.status === "scheduled") && daysUntil(p.dueDate) >= 0 && daysUntil(p.dueDate) <= 7);

  return {
    period,
    expectedThisMonth: sum(payments.filter((p) => p.periodMonth === period && p.status !== "waived").map((p) => p.amountDue)),
    collectedForMonth: forMonth.collected,
    cashThisMonth,
    collectionRateThisMonth: forMonth.rate,
    outstanding: sum(unpaid.map((p) => p.amountDue - p.amountPaid)),
    outstandingCount: unpaid.length,
    partialAmount: sum(partial.map((p) => p.amountDue - p.amountPaid)),
    partialCount: partial.length,
    overdueTenants: new Set(unpaid.map((p) => p.tenantId)).size,
    aging: arrearsAging(payments),
    trend,
    attention,
    dueNext7: { count: next7.length, amount: sum(next7.map((p) => p.amountDue)) },
  };
}

/* ------------------------------ Payment detail ---------------------------- */

export interface PaymentDetail {
  payment: Payment;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  contract: Contract;
  outstanding: number;
  receipts: Store["documents"];
  audit: Store["audit"];
  activity: Store["activity"];
  /** Same tenant's payments around this one, for context. */
  neighbours: Payment[];
}

export function getPaymentDetail(store: Store, paymentId: ID): PaymentDetail | null {
  const idx = indexStore(store);
  const payment = idx.paymentById.get(paymentId);
  if (!payment) return null;
  const tenant = idx.tenantById.get(payment.tenantId);
  const unit = idx.unitById.get(payment.unitId);
  const property = idx.propertyById.get(payment.propertyId);
  const contract = idx.contractById.get(payment.contractId);
  if (!tenant || !unit || !property || !contract) return null;
  const neighbours = (idx.paymentsByContract.get(contract.id) ?? []).slice().sort((a, b) => (a.periodMonth < b.periodMonth ? -1 : 1));
  const i = neighbours.findIndex((p) => p.id === payment.id);
  return {
    payment,
    tenant,
    unit,
    property,
    contract,
    outstanding: Math.max(0, payment.amountDue - payment.amountPaid),
    receipts: store.documents.filter((d) => !d.deleted && d.paymentId === payment.id),
    audit: store.audit.filter((a) => a.entityType === "payment" && a.entityId === payment.id),
    activity: store.activity.filter((a) => a.paymentId === payment.id),
    neighbours: neighbours.slice(Math.max(0, i - 2), i + 3),
  };
}

export { currentPeriod };
