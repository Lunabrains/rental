import { ids, shortHash, slugify } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addDaysISO, addMonthsISO, daysBetween, periodOf, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney, formatMonth } from "@/lib/format";
import { generateSchedule } from "@/lib/import/apply";
import type { Contract, ID, IdDocumentType, ISODate, Payment, PaymentMethod, Store, StoredDocument, Tenant, Unit } from "@/types";

import { appendActivity, finish, replaceById, type Command } from "./core";

/**
 * The user-facing write flows. Every one returns an `undo` so the toast can
 * reverse it, and every one ends in `recompute()` so alerts, KPIs, ledgers
 * and the bell all move together.
 */

/* ------------------------------ Record payment ---------------------------- */

export interface RecordPaymentInput {
  paymentId: ID;
  amount: number;
  date: ISODate;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
}

export interface RecordPaymentResult {
  payment: Payment;
  receipt: StoredDocument;
  tenantName: string;
  partial: boolean;
  remaining: number;
}

export function recordPayment(input: RecordPaymentInput): Command<RecordPaymentResult> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.paymentById.get(input.paymentId);
    if (!prev) throw new Error("Payment not found");
    const tenant = idx.tenantById.get(prev.tenantId);
    const tenantName = tenant?.fullName ?? "Tenant";
    const amount = Math.max(0, Math.round(input.amount * 100) / 100);
    const reference = input.reference?.trim() || `RCP-${shortHash(`${prev.id}:${input.date}:${amount}`).toUpperCase()}`;

    const payment: Payment = {
      ...prev,
      amountPaid: Math.round((prev.amountPaid + amount) * 100) / 100,
      paidDate: input.date,
      method: input.method,
      reference,
      note: input.note?.trim() || prev.note,
    };
    const remaining = Math.max(0, payment.amountDue - payment.amountPaid);
    const partial = remaining > 0;

    const receipt: StoredDocument = {
      id: ids.document(prev.tenantId, "receipt", `${reference}-${Date.now()}`),
      kind: "receipt",
      title: `Receipt — ${formatMonth(prev.periodMonth)} rent`,
      fileName: `receipt-${reference.toLowerCase()}.pdf`,
      mimeType: "application/pdf",
      sizeKb: 42,
      tenantId: prev.tenantId,
      contractId: prev.contractId,
      unitId: prev.unitId,
      propertyId: prev.propertyId,
      paymentId: prev.id,
      expenseId: null,
      workOrderId: null,
      assetId: null,
      supplierId: null,
      inspectionId: null,
      renovationId: null,
      category: "receipt",
      issuedDate: input.date,
      expiryDate: null,
      uploadedAt: input.date,
      generated: true,
      dataUrl: null,
      deleted: false,
    };

    const next: Store = { ...store, payments: replaceById(store.payments, payment), documents: [...store.documents, receipt] };
    const { store: logged, entry } = appendActivity(next, {
      type: "payment_recorded",
      message: `Payment received — ${formatMoney(amount)} from ${tenantName} for ${formatMonth(prev.periodMonth)}${partial ? ` (partial, ${formatMoney(remaining)} outstanding)` : ""}`,
      entityType: "payment",
      entityId: prev.id,
      propertyId: prev.propertyId,
      unitId: prev.unitId,
      tenantId: prev.tenantId,
      contractId: prev.contractId,
      paymentId: prev.id,
    });

    const undo = (s: Store): Store =>
      recompute({
        ...s,
        payments: replaceById(s.payments, prev),
        documents: s.documents.filter((d) => d.id !== receipt.id),
        activity: s.activity.filter((a) => a.id !== entry.id),
      });

    return finish(logged, { payment, receipt, tenantName, partial, remaining }, undo);
  };
}

/* ------------------------------ Contract numbers -------------------------- */

function nextContractNumber(store: Store, prefix: string): string {
  let max = 0;
  for (const c of store.contracts) {
    const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`, "i").exec(c.contractNumber);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* ------------------------------ Renew contract ---------------------------- */

export interface RenewContractInput {
  contractId: ID;
  startDate: ISODate;
  months: number;
  rent: number;
  deposit: number;
  paymentDay: number;
  method: PaymentMethod;
}

export interface RenewContractResult {
  oldContract: Contract;
  newContract: Contract;
  paymentsScheduled: number;
  tenantName: string;
}

export function renewContract(input: RenewContractInput): Command<RenewContractResult> {
  return (store) => {
    const idx = indexStore(store);
    const old = idx.contractById.get(input.contractId);
    if (!old) throw new Error("Contract not found");
    const tenant = idx.tenantById.get(old.tenantId);
    const tenantName = tenant?.fullName ?? "Tenant";
    const base = today();

    const prefix = old.contractNumber.replace(/-\d+$/, "");
    const contractNumber = nextContractNumber(store, prefix);
    const newContract: Contract = {
      id: uniqueId(ids.contract(contractNumber), (id) => idx.contractById.has(id)),
      contractNumber,
      propertyId: old.propertyId,
      unitId: old.unitId,
      tenantId: old.tenantId,
      startDate: input.startDate,
      endDate: addDaysISO(addMonthsISO(input.startDate, input.months), -1),
      durationMonths: input.months,
      monthlyRent: input.rent,
      deposit: input.deposit,
      paymentDay: Math.min(28, Math.max(1, input.paymentDay)),
      paymentFrequency: old.paymentFrequency,
      paymentMethod: input.method,
      status: "active",
      moveOutDate: null,
      renewedFromContractId: old.id,
      renewedToContractId: null,
      rentIncreaseClause: old.rentIncreaseClause,
      specialTerms: old.specialTerms,
      renewalDecision: null,
      renewalStatus: "not_due",
      proposedRent: null,
      renewalNotes: null,
      notes: null,
      createdAt: base,
    };
    const renewedOld: Contract = { ...old, status: "renewed", renewedToContractId: newContract.id };
    const schedule = generateSchedule(newContract, [], base, false);

    const next: Store = {
      ...store,
      contracts: [...replaceById(store.contracts, renewedOld), newContract],
      payments: [...store.payments, ...schedule],
    };
    const { store: logged, entry } = appendActivity(next, {
      type: "contract_renewed",
      message: `Contract renewed — ${formatMoney(old.monthlyRent)} → ${formatMoney(input.rent)} · ${input.months} months from ${input.startDate}`,
      entityType: "contract",
      entityId: newContract.id,
      propertyId: old.propertyId,
      unitId: old.unitId,
      tenantId: old.tenantId,
      contractId: newContract.id,
    });

    const scheduledIds = new Set(schedule.map((p) => p.id));
    const undo = (s: Store): Store =>
      recompute({
        ...s,
        contracts: replaceById(
          s.contracts.filter((c) => c.id !== newContract.id),
          old,
        ),
        payments: s.payments.filter((p) => !scheduledIds.has(p.id)),
        activity: s.activity.filter((a) => a.id !== entry.id),
      });

    return finish(logged, { oldContract: renewedOld, newContract, paymentsScheduled: schedule.length, tenantName }, undo);
  };
}

/* ------------------------------ Mark as leaving --------------------------- */

export interface MarkAsLeavingInput {
  contractId: ID;
  moveOutDate: ISODate;
  applyNow: boolean;
}

export interface MarkAsLeavingResult {
  contract: Contract;
  tenantName: string;
  unitNumber: string;
  vacatedNow: boolean;
}

export function markAsLeaving(input: MarkAsLeavingInput): Command<MarkAsLeavingResult> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.contractById.get(input.contractId);
    if (!prev) throw new Error("Contract not found");
    const tenant = idx.tenantById.get(prev.tenantId);
    const unit = idx.unitById.get(prev.unitId);
    const tenantName = tenant?.fullName ?? "Tenant";
    const base = today();

    const moveOutDate = input.applyNow ? base : input.moveOutDate;
    const vacatedNow = moveOutDate <= base;
    const contract: Contract = { ...prev, status: vacatedNow ? "terminated" : "notice_given", moveOutDate };

    // Rent is not owed for months after the move-out.
    const cutoff = periodOf(moveOutDate);
    const removed = store.payments.filter((p) => p.contractId === prev.id && p.amountPaid === 0 && p.periodMonth > cutoff);
    const removedIds = new Set(removed.map((p) => p.id));

    let next: Store = {
      ...store,
      contracts: replaceById(store.contracts, contract),
      payments: store.payments.filter((p) => !removedIds.has(p.id)),
    };
    const entries: string[] = [];
    const first = appendActivity(next, {
      type: vacatedNow ? "contract_terminated" : "notice_given",
      message: vacatedNow
        ? `${tenantName} moved out of ${unit?.unitNumber ?? "unit"} — contract ${prev.contractNumber} ended`
        : `Notice given — ${tenantName} is moving out on ${moveOutDate}`,
      entityType: "contract",
      entityId: prev.id,
      propertyId: prev.propertyId,
      unitId: prev.unitId,
      tenantId: prev.tenantId,
      contractId: prev.id,
    });
    next = first.store;
    entries.push(first.entry.id);
    if (vacatedNow) {
      const second = appendActivity(next, {
        type: "unit_became_available",
        message: `Unit ${unit?.unitNumber ?? ""} became available`,
        entityType: "unit",
        entityId: prev.unitId,
        propertyId: prev.propertyId,
        unitId: prev.unitId,
      });
      next = second.store;
      entries.push(second.entry.id);
    }

    const undo = (s: Store): Store =>
      recompute({
        ...s,
        contracts: replaceById(s.contracts, prev),
        payments: [...s.payments, ...removed],
        activity: s.activity.filter((a) => !entries.includes(a.id)),
      });

    return finish(next, { contract, tenantName, unitNumber: unit?.unitNumber ?? "", vacatedNow }, undo);
  };
}

/* ------------------------------ Add tenant -------------------------------- */

export interface AddTenantInput {
  unitId: ID;
  tenant: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    nationality: string;
    idType: IdDocumentType;
    idNumber: string;
  };
  terms: {
    startDate: ISODate;
    months: number;
    rent: number;
    deposit: number;
    paymentDay: number;
    method: PaymentMethod;
  };
}

export interface AddTenantResult {
  tenant: Tenant;
  contract: Contract;
  paymentsScheduled: number;
}

export function addTenantToUnit(input: AddTenantInput): Command<AddTenantResult> {
  return (store) => {
    const idx = indexStore(store);
    const unit = idx.unitById.get(input.unitId);
    if (!unit) throw new Error("Unit not found");
    const property = idx.propertyById.get(unit.propertyId);
    if (!property) throw new Error("Property not found");
    const base = today();

    const fullName = `${input.tenant.firstName.trim()} ${input.tenant.lastName.trim()}`.trim();
    const tenant: Tenant = {
      id: uniqueId(ids.tenant(fullName, input.tenant.phone), (id) => idx.tenantById.has(id)),
      firstName: input.tenant.firstName.trim(),
      lastName: input.tenant.lastName.trim(),
      fullName,
      phone: input.tenant.phone.trim(),
      email: input.tenant.email.trim(),
      nationality: input.tenant.nationality.trim() || "Lebanese",
      idType: input.tenant.idType,
      idNumber: input.tenant.idNumber.trim(),
      photoUrl: null,
      occupation: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      notes: null,
      createdAt: base,
    };

    const contractNumber = nextContractNumber(store, `${property.code}-${unit.unitNumber}`);
    const contract: Contract = {
      id: uniqueId(ids.contract(contractNumber), (id) => idx.contractById.has(id)),
      contractNumber,
      propertyId: unit.propertyId,
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: input.terms.startDate,
      endDate: addDaysISO(addMonthsISO(input.terms.startDate, input.terms.months), -1),
      durationMonths: input.terms.months,
      monthlyRent: input.terms.rent,
      deposit: input.terms.deposit,
      paymentDay: Math.min(28, Math.max(1, input.terms.paymentDay)),
      paymentFrequency: "monthly",
      paymentMethod: input.terms.method,
      status: "active",
      moveOutDate: null,
      renewedFromContractId: null,
      renewedToContractId: null,
      rentIncreaseClause: null,
      specialTerms: null,
      renewalDecision: null,
      renewalStatus: "not_due",
      proposedRent: null,
      renewalNotes: null,
      notes: null,
      createdAt: base,
    };
    const schedule = generateSchedule(contract, [], base, false);

    const next: Store = {
      ...store,
      tenants: [...store.tenants, tenant],
      contracts: [...store.contracts, contract],
      payments: [...store.payments, ...schedule],
    };
    const { store: logged, entry } = appendActivity(next, {
      type: "tenant_added",
      message: `${fullName} moved into ${property.name} ${unit.unitNumber} — ${formatMoney(input.terms.rent)}/month for ${input.terms.months} months`,
      entityType: "tenant",
      entityId: tenant.id,
      propertyId: unit.propertyId,
      unitId: unit.id,
      tenantId: tenant.id,
      contractId: contract.id,
    });

    const scheduledIds = new Set(schedule.map((p) => p.id));
    const undo = (s: Store): Store =>
      recompute({
        ...s,
        tenants: s.tenants.filter((t) => t.id !== tenant.id),
        contracts: s.contracts.filter((c) => c.id !== contract.id),
        payments: s.payments.filter((p) => !scheduledIds.has(p.id)),
        activity: s.activity.filter((a) => a.id !== entry.id),
      });

    return finish(logged, { tenant, contract, paymentsScheduled: schedule.length }, undo);
  };
}

/* ------------------------------ Basic edits ------------------------------- */

export type UnitPatch = Partial<Pick<Unit, "askingRent" | "askingDeposit" | "bedrooms" | "bathrooms" | "sizeSqm" | "furnished" | "notes" | "status" | "marketRent" | "condition">>;

export function updateUnit(unitId: ID, patch: UnitPatch): Command<Unit> {
  return (store) => {
    const prev = indexStore(store).unitById.get(unitId);
    if (!prev) throw new Error("Unit not found");
    const unit: Unit = { ...prev, ...patch };
    const { store: logged, entry } = appendActivity({ ...store, units: replaceById(store.units, unit) }, {
      type: "unit_updated",
      message: `Unit ${unit.unitNumber} details updated`,
      entityType: "unit",
      entityId: unit.id,
      propertyId: unit.propertyId,
      unitId: unit.id,
    });
    const undo = (s: Store): Store => recompute({ ...s, units: replaceById(s.units, prev), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, unit, undo);
  };
}

export type TenantPatch = Partial<
  Pick<Tenant, "firstName" | "lastName" | "phone" | "email" | "nationality" | "idType" | "idNumber" | "occupation" | "emergencyContactName" | "emergencyContactPhone" | "notes">
>;

export function updateTenant(tenantId: ID, patch: TenantPatch): Command<Tenant> {
  return (store) => {
    const prev = indexStore(store).tenantById.get(tenantId);
    if (!prev) throw new Error("Tenant not found");
    const merged = { ...prev, ...patch };
    const tenant: Tenant = { ...merged, fullName: `${merged.firstName} ${merged.lastName}`.trim() };
    const { store: logged, entry } = appendActivity({ ...store, tenants: replaceById(store.tenants, tenant) }, {
      type: "tenant_updated",
      message: `${tenant.fullName}'s details updated`,
      entityType: "tenant",
      entityId: tenant.id,
      tenantId: tenant.id,
    });
    const undo = (s: Store): Store => recompute({ ...s, tenants: replaceById(s.tenants, prev), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, tenant, undo);
  };
}

/** Suggested renewal start: the day after the current contract ends. */
export function suggestedRenewalStart(contract: Contract): ISODate {
  const base = today();
  return contract.endDate >= base ? addDaysISO(contract.endDate, 1) : base;
}

/** "+5%" quick button, rounded to the nearest $5. */
export function bumpRent(rent: number, pct = 0.05): number {
  return Math.round((rent * (1 + pct)) / 5) * 5;
}

export function contractLengthDays(c: Contract): number {
  return daysBetween(c.startDate, c.endDate);
}

export { slugify };
