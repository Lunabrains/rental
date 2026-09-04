import { daysBetween, today } from "@/lib/date";
import type { Contract, ISODate, Payment, PaymentStatus, Store, Unit } from "@/types";

import { computeAlerts } from "./alerts";

/**
 * A contract "occupies" its unit while it is active, while notice has been
 * given but the tenant has not moved out, or when it has expired and the
 * tenant is still in place (no move-out, no successor).
 */
export function isOccupying(c: Contract): boolean {
  if (c.status === "active" || c.status === "notice_given") return true;
  return c.status === "expired" && c.moveOutDate === null && c.renewedToContractId === null;
}

function deriveContractStatus(c: Contract, base: ISODate): Contract {
  if (c.status === "active" && c.endDate < base) return { ...c, status: "expired" };
  if (c.status === "notice_given" && c.moveOutDate !== null && c.moveOutDate < base) {
    return { ...c, status: "terminated" };
  }
  return c;
}

function derivePayment(p: Payment, base: ISODate, dueSoonDays: number): Payment {
  let status: PaymentStatus;
  let daysLate = 0;

  if (p.amountPaid >= p.amountDue && p.amountDue > 0) {
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

  const status = unit.status === "maintenance" || unit.status === "reserved" ? unit.status : "available";
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

/**
 * The single derivation pass. Runs after load and after every command:
 * contract statuses → payment statuses → unit statuses → alerts.
 * Pure — returns a new store snapshot.
 */
export function recompute(store: Store, base: ISODate = today()): Store {
  const contracts = store.contracts.map((c) => deriveContractStatus(c, base));

  const payments = store.payments.map((p) => derivePayment(p, base, store.settings.thresholds.paymentDueSoonDays));

  const contractsByUnit = new Map<string, Contract[]>();
  for (const c of contracts) {
    const list = contractsByUnit.get(c.unitId);
    if (list) list.push(c);
    else contractsByUnit.set(c.unitId, [c]);
  }
  const units = store.units.map((u) => deriveUnit(u, contractsByUnit.get(u.id) ?? []));

  const draft: Store = { ...store, contracts, payments, units };
  const alerts = computeAlerts(draft, base);
  return { ...draft, alerts };
}
