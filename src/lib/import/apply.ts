import { ids, normalizePhone, shortHash } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addDaysISO, addPeriods, daysBetween, dueDateFor, periodOf, today } from "@/lib/date";
import type { Contract, ISODate, Payment, Property, Store, StoredDocument, Tenant, Unit } from "@/types";

import { IMPORT_ORDER, type ImportEntity } from "./template";
import { EMPTY_COUNTS, type ImportPlan, type ImportSummary, type PatternEntry } from "./types";

/* --------------------------- Payment scheduling --------------------------- */

function reference(paymentId: string): string {
  return `TRX-${shortHash(paymentId).toUpperCase()}`;
}

/**
 * Generate the monthly schedule for a contract. Past periods are paid on time
 * by default; `pattern` entries re-script individual payments relative to
 * today so the demo cast behaves the same on any calendar day.
 */
export function generateSchedule(contract: Contract, pattern: PatternEntry[], base: ISODate, assumePaid = true): Payment[] {
  // One payment per contract month, so a 12-month lease bills 12 times and a
  // renewal never double-bills the hand-over month. Early move-out truncates.
  // `assumePaid` treats past due dates as settled (seed history); renewals and
  // new tenants pass false so nothing is paid until it is recorded.
  const end =
    contract.moveOutDate && contract.moveOutDate < contract.endDate ? contract.moveOutDate : contract.endDate;
  const lastPeriod = periodOf(end);
  const payments: Payment[] = [];

  let period = periodOf(contract.startDate);
  for (let i = 0; i < contract.durationMonths && period <= lastPeriod; i++, period = addPeriods(period, 1)) {
    let dueDate = dueDateFor(period, contract.paymentDay);
    if (dueDate < contract.startDate) dueDate = contract.startDate;
    const id = ids.payment(contract.id, period);
    const paid = assumePaid && dueDate < base;
    payments.push({
      id,
      contractId: contract.id,
      propertyId: contract.propertyId,
      unitId: contract.unitId,
      tenantId: contract.tenantId,
      periodMonth: period,
      dueDate,
      amountDue: contract.monthlyRent,
      amountPaid: paid ? contract.monthlyRent : 0,
      paidDate: paid ? dueDate : null,
      method: paid ? contract.paymentMethod : null,
      reference: paid ? reference(id) : null,
      note: null,
      status: "scheduled",
      daysLate: 0,
    });
  }

  for (const entry of pattern) {
    const target = addDaysISO(base, entry.offsetDays);
    let best: Payment | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of payments) {
      const d = Math.abs(daysBetween(p.dueDate, target));
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    if (!best) continue;
    switch (entry.kind) {
      case "overdue":
      case "unpaid":
        best.amountPaid = 0;
        best.paidDate = null;
        best.method = null;
        best.reference = null;
        break;
      case "late":
        best.amountPaid = best.amountDue;
        best.paidDate = addDaysISO(best.dueDate, Math.max(1, entry.arg ?? 1));
        best.method = contract.paymentMethod;
        best.reference = reference(best.id);
        break;
      case "partial":
        best.amountPaid = Math.min(best.amountDue, Math.max(0, entry.arg ?? 0));
        best.paidDate = best.amountPaid > 0 ? best.dueDate : null;
        best.method = best.amountPaid > 0 ? contract.paymentMethod : null;
        best.reference = best.amountPaid > 0 ? reference(best.id) : null;
        break;
    }
  }

  return payments;
}

/* -------------------------------- Helpers --------------------------------- */

function mimeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  return "application/octet-stream";
}

function replaceById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/* --------------------------------- Apply ---------------------------------- */

export interface ApplyResult {
  store: Store;
  summary: ImportSummary;
  /** Contract ids created — used by the command layer for activity logging. */
  createdContractIds: string[];
}

/**
 * Write a validated plan into the store. Pure: returns a new store. Nothing is
 * touched for rows with action = skip. The caller runs `recompute()`.
 */
export function applyImport(store: Store, plan: ImportPlan, base: ISODate = today()): ApplyResult {
  const started = performance.now();
  const created = EMPTY_COUNTS();
  const updated = EMPTY_COUNTS();
  const skipped = EMPTY_COUNTS();
  for (const e of IMPORT_ORDER) skipped[e] = plan.counts[e].skip;

  let properties = store.properties.slice();
  let units = store.units.slice();
  let tenants = store.tenants.slice();
  let contracts = store.contracts.slice();
  let payments = store.payments.slice();
  let documents = store.documents.slice();

  const idx = indexStore(store);

  // Working lookups that include rows created earlier in this same import.
  const propertyByCode = new Map<string, Property>(store.properties.map((p) => [p.code.toUpperCase(), p]));
  const unitByKey = new Map<string, Unit>();
  for (const u of store.units) {
    const p = idx.propertyById.get(u.propertyId);
    if (p) unitByKey.set(`${p.code.toUpperCase()}:${u.unitNumber}`, u);
  }
  const tenantByPhone = new Map<string, Tenant>();
  const tenantByIdNumber = new Map<string, Tenant>();
  for (const t of store.tenants) {
    if (t.phone) tenantByPhone.set(normalizePhone(t.phone), t);
    if (t.idNumber) tenantByIdNumber.set(t.idNumber.toUpperCase(), t);
  }
  const contractByNumber = new Map<string, Contract>(store.contracts.map((c) => [c.contractNumber.toUpperCase(), c]));
  const takenPropertyIds = new Set(store.properties.map((p) => p.id));
  const takenTenantIds = new Set(store.tenants.map((t) => t.id));

  /* Properties */
  for (const row of plan.rows.properties) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const existing = row.existingId ? idx.propertyById.get(row.existingId) : undefined;
    const property: Property = existing
      ? { ...existing, ...d }
      : {
          id: uniqueId(ids.property(d.name), takenPropertyIds),
          ...d,
          imageUrl: null,
          createdAt: base,
        };
    takenPropertyIds.add(property.id);
    properties = replaceById(properties, property);
    propertyByCode.set(property.code.toUpperCase(), property);
    if (existing) updated.properties++;
    else created.properties++;
  }

  /* Units */
  for (const row of plan.rows.units) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.unitById.get(row.existingId) : undefined;
    const physical = {
      unitNumber: d.unitNumber,
      floor: d.floor,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      sizeSqm: d.sizeSqm,
      furnished: d.furnished,
      askingRent: d.askingRent,
      askingDeposit: d.askingDeposit,
      notes: d.notes,
    };
    const unit: Unit = existing
      ? {
          ...existing,
          ...physical,
          status: d.statusOverride ?? (existing.status === "maintenance" || existing.status === "reserved" ? "available" : existing.status),
        }
      : {
          id: ids.unit(property.id, d.unitNumber),
          propertyId: property.id,
          ...physical,
          status: d.statusOverride ?? "available",
          availableSince: null,
          lastRent: null,
          previousTenantId: null,
        };
    units = replaceById(units, unit);
    unitByKey.set(`${property.code.toUpperCase()}:${unit.unitNumber}`, unit);
    if (existing) updated.units++;
    else created.units++;
  }

  /* Tenants */
  for (const row of plan.rows.tenants) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const existing = row.existingId ? idx.tenantById.get(row.existingId) : undefined;
    const fullName = `${d.firstName} ${d.lastName}`.trim();
    const tenant: Tenant = existing
      ? { ...existing, ...d, fullName }
      : {
          id: uniqueId(ids.tenant(fullName, d.phone || d.idNumber), takenTenantIds),
          ...d,
          fullName,
          photoUrl: null,
          createdAt: base,
        };
    takenTenantIds.add(tenant.id);
    tenants = replaceById(tenants, tenant);
    if (tenant.phone) tenantByPhone.set(normalizePhone(tenant.phone), tenant);
    if (tenant.idNumber) tenantByIdNumber.set(tenant.idNumber.toUpperCase(), tenant);
    if (existing) updated.tenants++;
    else created.tenants++;
  }

  /* Contracts (+ generated payment schedule) */
  const createdContractIds: string[] = [];
  let paymentsGenerated = 0;
  for (const row of plan.rows.contracts) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const unit = unitByKey.get(`${d.propertyCode}:${d.unitNumber}`);
    const tenant = tenantByPhone.get(d.tenantPhone);
    if (!unit || !tenant) continue;
    const existing = row.existingId ? idx.contractById.get(row.existingId) : undefined;
    const durationMonths = Math.max(1, Math.round(daysBetween(d.startDate, d.endDate) / 30.4375));
    const terms = {
      propertyId: unit.propertyId,
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: d.startDate,
      endDate: d.endDate,
      durationMonths,
      monthlyRent: d.monthlyRent,
      deposit: d.deposit,
      paymentDay: d.paymentDay,
      paymentMethod: d.paymentMethod,
      status: d.status,
      moveOutDate: d.moveOutDate,
      notes: d.notes,
    };

    if (existing) {
      const contract: Contract = { ...existing, ...terms };
      contracts = replaceById(contracts, contract);
      contractByNumber.set(contract.contractNumber.toUpperCase(), contract);
      // Keep paid history; refresh unpaid rows and add any new periods.
      const have = new Set(payments.filter((p) => p.contractId === contract.id).map((p) => p.periodMonth));
      const fresh = generateSchedule(contract, d.paymentPattern, base);
      for (const p of fresh) {
        if (!have.has(p.periodMonth)) {
          payments.push(p);
          paymentsGenerated++;
        }
      }
      payments = payments.map((p) =>
        p.contractId === contract.id && p.amountPaid === 0
          ? { ...p, amountDue: contract.monthlyRent, dueDate: dueDateFor(p.periodMonth, contract.paymentDay) }
          : p,
      );
      updated.contracts++;
    } else {
      const contract: Contract = {
        id: ids.contract(d.contractNumber),
        contractNumber: d.contractNumber,
        ...terms,
        renewedFromContractId: null,
        renewedToContractId: null,
        createdAt: base,
      };
      contracts.push(contract);
      contractByNumber.set(contract.contractNumber.toUpperCase(), contract);
      const schedule = generateSchedule(contract, d.paymentPattern, base);
      payments.push(...schedule);
      paymentsGenerated += schedule.length;
      createdContractIds.push(contract.id);
      created.contracts++;
    }
  }

  /* Documents */
  for (const row of plan.rows.documents) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const tenant = tenantByPhone.get(d.tenantPhone);
    if (!tenant) continue;
    const contract = d.contractNumber ? contractByNumber.get(d.contractNumber.toUpperCase()) ?? null : null;
    const existing = row.existingId ? idx.documentById.get(row.existingId) : undefined;
    const fields = {
      kind: d.kind,
      title: d.title,
      fileName: d.fileName,
      mimeType: mimeFor(d.fileName),
      tenantId: tenant.id,
      contractId: contract?.id ?? null,
      unitId: contract?.unitId ?? null,
      propertyId: contract?.propertyId ?? null,
      issuedDate: d.issuedDate,
      expiryDate: d.expiryDate,
    };
    const doc: StoredDocument = existing
      ? { ...existing, ...fields }
      : {
          id: ids.document(tenant.id, d.kind, d.fileName),
          ...fields,
          paymentId: null,
          sizeKb: 120 + (parseInt(shortHash(d.fileName), 36) % 900),
          uploadedAt: d.issuedDate ?? base,
          generated: false,
        };
    documents = replaceById(documents, doc);
    if (existing) updated.documents++;
    else created.documents++;
  }

  const next: Store = { ...store, properties, units, tenants, contracts, payments, documents };

  return {
    store: next,
    summary: {
      fileName: plan.fileName,
      created,
      updated,
      skipped,
      paymentsGenerated,
      durationMs: Math.round(performance.now() - started),
    },
    createdContractIds,
  };
}

export function summarize(summary: ImportSummary): string {
  const parts: string[] = [];
  const label: Record<ImportEntity, [string, string]> = {
    properties: ["property", "properties"],
    units: ["unit", "units"],
    tenants: ["tenant", "tenants"],
    contracts: ["contract", "contracts"],
    documents: ["document", "documents"],
  };
  for (const e of IMPORT_ORDER) {
    const c = summary.created[e];
    const u = summary.updated[e];
    if (c > 0) parts.push(`${c} ${c === 1 ? label[e][0] : label[e][1]} created`);
    if (u > 0) parts.push(`${u} ${u === 1 ? label[e][0] : label[e][1]} updated`);
  }
  return parts.length > 0 ? parts.join(", ") + "." : "Nothing to import.";
}
