import { ids, normalizePhone, shortHash, slugify } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addDaysISO, addMonthsISO, addPeriods, daysBetween, dueDateFor, periodOf, today } from "@/lib/date";
import type {
  Asset,
  Budget,
  ChargeAllocation,
  CommonCharge,
  Contract,
  Expense,
  ID,
  Inspection,
  ISODate,
  KeyItem,
  ParkingSpace,
  Payment,
  PreventivePlan,
  Property,
  Renovation,
  SecurityDeposit,
  Store,
  StoredDocument,
  Supplier,
  Tenant,
  Unit,
  UtilityMeter,
  UtilityReading,
  WorkOrder,
  WorkOrderStatus,
} from "@/types";
import { FREQUENCY_MONTHS } from "@/types";

import { ENTITY_LABELS, IMPORT_ORDER, type ImportEntity } from "./template";
import { EMPTY_COUNTS, type ImportPlan, type ImportSummary, type PatternEntry } from "./types";

/* --------------------------- Payment scheduling --------------------------- */

function reference(paymentId: string): string {
  return `TRX-${shortHash(paymentId).toUpperCase()}`;
}

/**
 * Generate the payment schedule for a contract — one payment per billing
 * period (monthly by default; quarterly / semi-annual / annual bill several
 * months at once). Past periods are paid on time by default; `pattern`
 * entries re-script individual payments relative to today so the demo cast
 * behaves the same on any calendar day.
 */
export function generateSchedule(contract: Contract, pattern: PatternEntry[], base: ISODate, assumePaid = true): Payment[] {
  // `assumePaid` treats past due dates as settled (seed history); renewals and
  // new tenants pass false so nothing is paid until it is recorded.
  const end =
    contract.moveOutDate && contract.moveOutDate < contract.endDate ? contract.moveOutDate : contract.endDate;
  const lastPeriod = periodOf(end);
  const step = FREQUENCY_MONTHS[contract.paymentFrequency] ?? 1;
  const amount = contract.monthlyRent * step;
  const payments: Payment[] = [];

  let period = periodOf(contract.startDate);
  for (let i = 0; i < contract.durationMonths && period <= lastPeriod; i += step, period = addPeriods(period, step)) {
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
      amountDue: amount,
      amountPaid: paid ? amount : 0,
      paidDate: paid ? dueDate : null,
      method: paid ? contract.paymentMethod : null,
      reference: paid ? reference(id) : null,
      note: null,
      waived: false,
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

export function mimeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["jpg", "jpeg"].includes(ext)) return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (["xlsx", "xls"].includes(ext)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "txt") return "text/plain";
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split a building charge across its units by the chosen method. */
export function allocateCharge(total: number, units: Unit[], method: CommonCharge["allocationMethod"]): { unitId: ID; amount: number }[] {
  const eligible = units.filter((u) => u.status !== "unavailable");
  if (eligible.length === 0) return [];
  const weight = (u: Unit): number => (method === "by_area" ? Math.max(1, u.sizeSqm) : method === "by_bedrooms" ? Math.max(1, u.bedrooms) : 1);
  const totalWeight = eligible.reduce((n, u) => n + weight(u), 0);
  const out = eligible.map((u) => ({ unitId: u.id, amount: round2((total * weight(u)) / totalWeight) }));
  // Push rounding drift onto the last unit so the parts add up exactly.
  const drift = round2(total - out.reduce((n, x) => n + x.amount, 0));
  if (out.length > 0 && drift !== 0) out[out.length - 1].amount = round2(out[out.length - 1].amount + drift);
  return out;
}

function historyFor(status: WorkOrderStatus, dates: { reportedAt: ISODate; approvedAt: ISODate | null; startedAt: ISODate | null; completedAt: ISODate | null; closedAt: ISODate | null }): WorkOrder["statusHistory"] {
  const at = (d: ISODate) => `${d}T09:00:00.000Z`;
  const h: WorkOrder["statusHistory"] = [{ status: "open", at: at(dates.reportedAt), note: null }];
  const order: WorkOrderStatus[] = ["open", "assigned", "awaiting_quote", "awaiting_approval", "in_progress", "completed", "closed"];
  const target = status === "cancelled" ? 0 : order.indexOf(status);
  const stamp = (s: WorkOrderStatus): ISODate => {
    if (s === "in_progress" && dates.startedAt) return dates.startedAt;
    if (s === "awaiting_approval" && dates.approvedAt) return dates.approvedAt;
    if (s === "completed" && dates.completedAt) return dates.completedAt;
    if (s === "closed" && (dates.closedAt ?? dates.completedAt)) return dates.closedAt ?? dates.completedAt!;
    return dates.reportedAt;
  };
  for (let i = 1; i <= target; i++) {
    const s = order[i];
    // Skip quote/approval stages for work that went straight to a technician.
    if ((s === "awaiting_quote" || s === "awaiting_approval") && status !== s && !dates.approvedAt) continue;
    h.push({ status: s, at: at(stamp(s)), note: null });
  }
  if (status === "cancelled") h.push({ status: "cancelled", at: at(dates.closedAt ?? dates.reportedAt), note: null });
  return h;
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
  const count = (entity: ImportEntity, existing: boolean) => (existing ? updated[entity]++ : created[entity]++);

  let properties = store.properties.slice();
  let units = store.units.slice();
  let tenants = store.tenants.slice();
  let contracts = store.contracts.slice();
  let payments = store.payments.slice();
  let documents = store.documents.slice();
  let suppliers = store.suppliers.slice();
  let assets = store.assets.slice();
  let workOrders = store.workOrders.slice();
  let preventivePlans = store.preventivePlans.slice();
  let expenses = store.expenses.slice();
  let budgets = store.budgets.slice();
  let deposits = store.deposits.slice();
  let meters = store.meters.slice();
  let readings = store.readings.slice();
  let commonCharges = store.commonCharges.slice();
  let inspections = store.inspections.slice();
  let renovations = store.renovations.slice();
  let parking = store.parking.slice();
  let keys = store.keys.slice();

  const idx = indexStore(store);

  // Working lookups that include rows created earlier in this same import.
  const propertyByCode = new Map<string, Property>(store.properties.map((p) => [p.code.toUpperCase(), p]));
  const unitByKey = new Map<string, Unit>();
  for (const u of store.units) {
    const p = idx.propertyById.get(u.propertyId);
    if (p) unitByKey.set(`${p.code.toUpperCase()}:${u.unitNumber}`, u);
  }
  const tenantByPhone = new Map<string, Tenant>();
  for (const t of store.tenants) if (t.phone) tenantByPhone.set(normalizePhone(t.phone), t);
  const contractByNumber = new Map<string, Contract>(store.contracts.map((c) => [c.contractNumber.toUpperCase(), c]));
  const supplierByName = new Map<string, Supplier>(store.suppliers.map((s) => [s.name.toUpperCase(), s]));
  const assetByKey = new Map<string, Asset>();
  for (const a of store.assets) {
    const p = idx.propertyById.get(a.propertyId);
    if (p) assetByKey.set(`${p.code.toUpperCase()}:${a.name.toUpperCase()}`, a);
  }
  const workOrderByNumber = new Map<string, WorkOrder>(store.workOrders.map((w) => [w.number.toUpperCase(), w]));
  const renovationByKey = new Map<string, Renovation>();
  for (const r of store.renovations) {
    const p = idx.propertyById.get(r.propertyId);
    if (p) renovationByKey.set(`${p.code.toUpperCase()}:${r.title.toUpperCase()}`, r);
  }
  const meterByNumber = new Map<string, UtilityMeter>(store.meters.map((m) => [m.meterNumber.toUpperCase(), m]));
  const takenPropertyIds = new Set(store.properties.map((p) => p.id));
  const takenTenantIds = new Set(store.tenants.map((t) => t.id));

  const unitOf = (code: string, unitNumber: string | null): Unit | null => (unitNumber ? unitByKey.get(`${code}:${unitNumber}`) ?? null : null);
  const supplierOf = (name: string | null): Supplier | null => (name ? supplierByName.get(name.toUpperCase()) ?? null : null);
  const assetOf = (code: string, name: string | null): Asset | null => (name ? assetByKey.get(`${code}:${name.toUpperCase()}`) ?? null : null);
  const tenantOf = (phone: string | null): Tenant | null => (phone ? tenantByPhone.get(phone) ?? null : null);

  /* Properties */
  for (const row of plan.rows.properties) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const existing = row.existingId ? idx.propertyById.get(row.existingId) : undefined;
    const property: Property = existing
      ? { ...existing, ...d }
      : { id: uniqueId(ids.property(d.name), takenPropertyIds), ...d, imageUrl: null, createdAt: base };
    takenPropertyIds.add(property.id);
    properties = replaceById(properties, property);
    propertyByCode.set(property.code.toUpperCase(), property);
    count("properties", !!existing);
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
      marketRent: d.marketRent,
      condition: d.condition,
      notes: d.notes,
    };
    const overridden = (s: Unit["status"]) => s === "maintenance" || s === "reserved" || s === "renovation" || s === "unavailable";
    const unit: Unit = existing
      ? { ...existing, ...physical, status: d.statusOverride ?? (overridden(existing.status) ? "available" : existing.status) }
      : { id: ids.unit(property.id, d.unitNumber), propertyId: property.id, ...physical, status: d.statusOverride ?? "available", availableSince: null, lastRent: null, previousTenantId: null };
    units = replaceById(units, unit);
    unitByKey.set(`${property.code.toUpperCase()}:${unit.unitNumber}`, unit);
    count("units", !!existing);
  }

  /* Tenants */
  for (const row of plan.rows.tenants) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const existing = row.existingId ? idx.tenantById.get(row.existingId) : undefined;
    const fullName = `${d.firstName} ${d.lastName}`.trim();
    const tenant: Tenant = existing
      ? { ...existing, ...d, fullName }
      : { id: uniqueId(ids.tenant(fullName, d.phone || d.idNumber), takenTenantIds), ...d, fullName, photoUrl: null, createdAt: base };
    takenTenantIds.add(tenant.id);
    tenants = replaceById(tenants, tenant);
    if (tenant.phone) tenantByPhone.set(normalizePhone(tenant.phone), tenant);
    count("tenants", !!existing);
  }

  /* Contracts (+ generated payment schedule) */
  const createdContractIds: string[] = [];
  const createdContracts: Contract[] = [];
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
      paymentFrequency: d.paymentFrequency,
      paymentMethod: d.paymentMethod,
      status: d.status,
      moveOutDate: d.moveOutDate,
      rentIncreaseClause: d.rentIncreaseClause,
      specialTerms: d.specialTerms,
      renewalDecision: d.renewalDecision,
      proposedRent: d.proposedRent,
      renewalNotes: d.renewalNotes,
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
        p.contractId === contract.id && p.amountPaid === 0 ? { ...p, amountDue: contract.monthlyRent * (FREQUENCY_MONTHS[contract.paymentFrequency] ?? 1), dueDate: dueDateFor(p.periodMonth, contract.paymentDay) } : p,
      );
      count("contracts", true);
    } else {
      const contract: Contract = {
        id: ids.contract(d.contractNumber),
        contractNumber: d.contractNumber,
        ...terms,
        renewedFromContractId: null,
        renewedToContractId: null,
        renewalStatus: "not_due",
        createdAt: base,
      };
      contracts.push(contract);
      contractByNumber.set(contract.contractNumber.toUpperCase(), contract);
      const schedule = generateSchedule(contract, d.paymentPattern, base);
      payments.push(...schedule);
      paymentsGenerated += schedule.length;
      createdContractIds.push(contract.id);
      createdContracts.push(contract);
      count("contracts", false);
    }
  }

  // Link renewal chains declared through the seed: a "renewed" contract on the
  // same unit + tenant whose successor starts the day after it ends.
  for (const c of createdContracts) {
    if (c.status !== "renewed" || c.renewedToContractId) continue;
    const next = contracts.find((x) => x.id !== c.id && x.unitId === c.unitId && x.tenantId === c.tenantId && x.startDate > c.endDate && daysBetween(c.endDate, x.startDate) <= 31);
    if (!next) continue;
    contracts = replaceById(contracts, { ...c, renewedToContractId: next.id });
    contracts = replaceById(contracts, { ...next, renewedFromContractId: c.id });
  }

  /* Suppliers */
  for (const row of plan.rows.suppliers) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const existing = row.existingId ? idx.supplierById.get(row.existingId) : undefined;
    const supplier: Supplier = existing ? { ...existing, ...d } : { id: ids.supplier(d.name), ...d, createdAt: base };
    suppliers = replaceById(suppliers, supplier);
    supplierByName.set(supplier.name.toUpperCase(), supplier);
    count("suppliers", !!existing);
  }

  /* Assets */
  for (const row of plan.rows.assets) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.assetById.get(row.existingId) : undefined;
    const fields = {
      propertyId: property.id,
      unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null,
      assetType: d.assetType,
      name: d.name,
      manufacturer: d.manufacturer,
      model: d.model,
      serialNumber: d.serialNumber,
      installationDate: d.installationDate,
      purchaseCost: d.purchaseCost,
      warrantyExpiry: d.warrantyExpiry,
      supplierId: supplierOf(d.supplierName)?.id ?? null,
      status: d.status,
      lastServiceDate: d.lastServiceDate,
      notes: d.notes,
    };
    const asset: Asset = existing
      ? { ...existing, ...fields, qrCode: d.qrCode ?? existing.qrCode }
      : { id: ids.asset(property.id, d.name), ...fields, nextServiceDate: null, qrCode: d.qrCode ?? `AST-${property.code.toUpperCase()}-${slugify(d.name).toUpperCase()}`, createdAt: base };
    assets = replaceById(assets, asset);
    assetByKey.set(`${property.code.toUpperCase()}:${asset.name.toUpperCase()}`, asset);
    count("assets", !!existing);
  }

  /* Work orders */
  for (const row of plan.rows.workorders) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.workOrderById.get(row.existingId) : undefined;
    const fields = {
      propertyId: property.id,
      unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null,
      assetId: assetOf(d.propertyCode, d.assetName)?.id ?? null,
      tenantId: tenantOf(d.tenantPhone)?.id ?? null,
      title: d.title,
      description: d.description,
      category: d.category,
      priority: d.priority,
      status: d.status,
      source: d.source,
      reportedAt: d.reportedAt,
      supplierId: supplierOf(d.supplierName)?.id ?? null,
      estimatedCost: d.estimatedCost,
      actualCost: d.actualCost,
      approvalRequired: d.approvalRequired,
      approvedAt: d.approvedAt,
      startedAt: d.startedAt,
      completedAt: d.completedAt,
      closedAt: d.closedAt,
      notes: d.notes,
      repeatOfWorkOrderId: d.repeatOfNumber ? workOrderByNumber.get(d.repeatOfNumber.toUpperCase())?.id ?? null : null,
    };
    const order: WorkOrder = existing
      ? { ...existing, ...fields, statusHistory: existing.status === d.status ? existing.statusHistory : historyFor(d.status, fields) }
      : { id: ids.workOrder(d.number), number: d.number, ...fields, beforePhotoIds: [], afterPhotoIds: [], invoiceDocumentId: null, inspectionId: null, preventivePlanId: null, statusHistory: historyFor(d.status, fields), createdAt: d.reportedAt };
    workOrders = replaceById(workOrders, order);
    workOrderByNumber.set(order.number.toUpperCase(), order);
    count("workorders", !!existing);
  }

  /* Preventive plans */
  for (const row of plan.rows.plans) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const asset = assetOf(d.propertyCode, d.assetName);
    const existing = row.existingId ? idx.planById.get(row.existingId) : undefined;
    const fields = {
      propertyId: property.id,
      assetId: asset?.id ?? null,
      maintenanceType: d.maintenanceType,
      recurrenceMonths: d.recurrenceMonths,
      lastServiceDate: d.lastServiceDate,
      nextServiceDate: d.nextServiceDate,
      supplierId: supplierOf(d.supplierName)?.id ?? null,
      estimatedCost: d.estimatedCost,
      status: d.status,
      reminderDays: d.reminderDays,
      notes: d.notes,
    };
    const item: PreventivePlan = existing ? { ...existing, ...fields } : { id: ids.plan(property.id, d.maintenanceType, asset?.id ?? null), ...fields, createdAt: base };
    preventivePlans = replaceById(preventivePlans, item);
    count("plans", !!existing);
  }

  /* Renovations (before expenses so CapEx can link to them) */
  for (const row of plan.rows.renovations) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.renovationById.get(row.existingId) : undefined;
    const fields = {
      propertyId: property.id,
      unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null,
      title: d.title,
      description: d.description,
      projectType: d.projectType,
      budget: d.budget,
      contractorSupplierId: supplierOf(d.contractorName)?.id ?? null,
      startDate: d.startDate,
      targetEndDate: d.targetEndDate,
      actualEndDate: d.actualEndDate,
      progressPercent: d.progressPercent,
      status: d.status,
      tasks: d.tasks.map((t, i) => ({ id: `${slugify(d.title)}-t${i + 1}`, title: t.title, done: t.done, dueDate: null })),
      notes: d.notes,
    };
    const item: Renovation = existing ? { ...existing, ...fields } : { id: ids.renovation(property.id, d.title), ...fields, actualCost: 0, photoIds: [], createdAt: base };
    renovations = replaceById(renovations, item);
    renovationByKey.set(`${property.code.toUpperCase()}:${item.title.toUpperCase()}`, item);
    count("renovations", !!existing);
  }

  /* Expenses */
  for (const row of plan.rows.expenses) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.expenseById.get(row.existingId) : undefined;
    const fields = {
      propertyId: property.id,
      unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null,
      supplierId: supplierOf(d.supplierName)?.id ?? null,
      category: d.category,
      amount: d.amount,
      expenseDate: d.expenseDate,
      dueDate: d.dueDate,
      paymentStatus: d.paymentStatus,
      paidDate: d.paidDate,
      recurring: d.recurring,
      recurrence: d.recurrence,
      description: d.description,
      classification: d.classification,
      workOrderId: d.workOrderNumber ? workOrderByNumber.get(d.workOrderNumber.toUpperCase())?.id ?? null : null,
      renovationId: d.renovationTitle ? renovationByKey.get(`${d.propertyCode}:${d.renovationTitle.toUpperCase()}`)?.id ?? null : null,
      assetId: assetOf(d.propertyCode, d.assetName)?.id ?? null,
      invoiceNumber: d.invoiceNumber,
      notes: d.notes,
    };
    const item: Expense = existing ? { ...existing, ...fields } : { id: ids.expense(property.id, d.expenseDate, d.description), ...fields, documentId: null, deleted: false, createdAt: d.expenseDate };
    expenses = replaceById(expenses, item);
    count("expenses", !!existing);
  }

  /* Budgets */
  for (const row of plan.rows.budgets) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.budgetById.get(row.existingId) : undefined;
    const item: Budget = existing
      ? { ...existing, amount: d.amount, notes: d.notes }
      : { id: ids.budget(property.id, d.period, d.category), propertyId: property.id, periodType: d.periodType, period: d.period, category: d.category, amount: d.amount, notes: d.notes };
    budgets = replaceById(budgets, item);
    count("budgets", !!existing);
  }

  /* Deposits — explicit rows first, then one per newly created contract */
  const depositRows = new Set<string>();
  for (const row of plan.rows.deposits) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const contract = contractByNumber.get(d.contractNumber.toUpperCase());
    if (!contract) continue;
    depositRows.add(contract.id);
    const existing = row.existingId ? idx.depositById.get(row.existingId) : undefined;
    const expected = d.amountExpected ?? existing?.amountExpected ?? contract.deposit;
    const item: SecurityDeposit = {
      id: existing?.id ?? ids.deposit(contract.id),
      contractId: contract.id,
      tenantId: contract.tenantId,
      unitId: contract.unitId,
      propertyId: contract.propertyId,
      amountExpected: expected,
      amountReceived: d.amountReceived ?? existing?.amountReceived ?? 0,
      receivedDate: d.receivedDate ?? existing?.receivedDate ?? null,
      deductions: d.deductions.map((x, i) => ({ id: `${contract.id}-ded${i + 1}`, ...x })),
      finalRefund: d.finalRefund ?? existing?.finalRefund ?? null,
      settlementDate: d.settlementDate ?? existing?.settlementDate ?? null,
      settlementNotes: d.notes ?? existing?.settlementNotes ?? null,
      status: "pending",
      amountHeld: 0,
    };
    deposits = replaceById(deposits, item);
    count("deposits", !!existing);
  }
  for (const c of createdContracts) {
    if (depositRows.has(c.id) || deposits.some((x) => x.contractId === c.id)) continue;
    const started = c.startDate <= base;
    const ended = c.status === "terminated" || c.status === "renewed" || (c.status === "expired" && c.moveOutDate !== null);
    const endedOn = c.moveOutDate ?? c.endDate;
    // Tenancies that ended more than three weeks ago were settled cleanly; more
    // recent ones are still being settled (and surface as alerts past 14 days).
    const settled = ended && daysBetween(endedOn, base) > 21;
    deposits.push({
      id: ids.deposit(c.id),
      contractId: c.id,
      tenantId: c.tenantId,
      unitId: c.unitId,
      propertyId: c.propertyId,
      amountExpected: c.deposit,
      amountReceived: started ? c.deposit : 0,
      receivedDate: started ? c.startDate : null,
      deductions: [],
      finalRefund: settled ? (c.status === "renewed" ? 0 : c.deposit) : null,
      settlementDate: settled ? endedOn : null,
      settlementNotes: settled ? (c.status === "renewed" ? "Carried into the renewal" : "Refunded in full") : null,
      status: "pending",
      amountHeld: 0,
    });
  }

  /* Meters & readings */
  for (const row of plan.rows.meters) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.meterById.get(row.existingId) : undefined;
    const fields = { propertyId: property.id, unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null, utilityType: d.utilityType, meterNumber: d.meterNumber, billingMethod: d.billingMethod, unitRate: d.unitRate, unitLabel: d.unitLabel };
    const item: UtilityMeter = existing ? { ...existing, ...fields } : { id: ids.meter(d.meterNumber), ...fields, createdAt: base };
    meters = replaceById(meters, item);
    meterByNumber.set(item.meterNumber.toUpperCase(), item);
    count("meters", !!existing);
  }
  const readingRows = plan.rows.readings.filter((r) => r.action !== "skip" && r.data).sort((a, b) => (a.data!.readingDate < b.data!.readingDate ? -1 : 1));
  for (const row of readingRows) {
    const d = row.data!;
    const meter = meterByNumber.get(d.meterNumber.toUpperCase());
    if (!meter) continue;
    const existing = row.existingId ? idx.readingById.get(row.existingId) : undefined;
    const last = readings.filter((r) => r.meterId === meter.id && r.readingDate < d.readingDate).sort((a, b) => (a.readingDate < b.readingDate ? 1 : -1))[0];
    const item: UtilityReading = {
      id: existing?.id ?? ids.reading(meter.id, d.readingDate),
      meterId: meter.id,
      readingDate: d.readingDate,
      previousReading: d.previousReading ?? last?.currentReading ?? 0,
      currentReading: d.currentReading,
      consumption: 0,
      calculatedAmount: null,
      documentId: existing?.documentId ?? null,
      meterReset: d.meterReset,
      note: d.note,
    };
    readings = replaceById(readings, item);
    count("readings", !!existing);
  }

  /* Common charges */
  for (const row of plan.rows.charges) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.chargeById.get(row.existingId) : undefined;
    const buildingUnits = units.filter((u) => u.propertyId === property.id);
    const paidSet = new Set(d.paidUnits.map((u) => u.toUpperCase()));
    const allocations: ChargeAllocation[] = allocateCharge(d.totalAmount, buildingUnits, d.allocationMethod).map((a) => {
      const unit = buildingUnits.find((u) => u.id === a.unitId)!;
      const paid = paidSet.has(unit.unitNumber.toUpperCase());
      return { unitId: a.unitId, amount: a.amount, paid, paidDate: paid ? base : null };
    });
    const item: CommonCharge = existing
      ? { ...existing, totalAmount: d.totalAmount, allocationMethod: d.allocationMethod, allocations, notes: d.notes }
      : { id: ids.charge(property.id, d.period, d.category), propertyId: property.id, period: d.period, category: d.category, totalAmount: d.totalAmount, allocationMethod: d.allocationMethod, allocations, notes: d.notes, createdAt: base };
    commonCharges = replaceById(commonCharges, item);
    count("charges", !!existing);
  }

  /* Inspections */
  for (const row of plan.rows.inspections) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const unit = unitOf(d.propertyCode, d.unitNumber);
    const existing = row.existingId ? idx.inspectionById.get(row.existingId) : undefined;
    const id = existing?.id ?? ids.inspection(property.id, unit?.id ?? null, d.type, d.scheduledDate);
    const tenant = tenantOf(d.tenantPhone);
    const contract = tenant && unit ? contracts.find((c) => c.unitId === unit.id && c.tenantId === tenant.id) ?? null : null;
    const fields = {
      propertyId: property.id,
      unitId: unit?.id ?? null,
      assetId: assetOf(d.propertyCode, d.assetName)?.id ?? null,
      tenantId: tenant?.id ?? null,
      contractId: contract?.id ?? null,
      type: d.type,
      scheduledDate: d.scheduledDate,
      completedDate: d.completedDate,
      inspector: d.inspector,
      status: d.status,
      overallResult: d.overallResult,
      notes: d.notes,
      items: d.items.map((x, i) => ({ id: `${id}-i${i + 1}`, area: x.area, item: x.item, result: x.result, notes: x.notes, photoIds: [], followUpRequired: x.followUpRequired, workOrderId: existing?.items[i]?.workOrderId ?? null })),
    };
    const item: Inspection = existing ? { ...existing, ...fields } : { id, ...fields, meterReadingIds: [], keyItemIds: [], depositId: contract ? deposits.find((x) => x.contractId === contract.id)?.id ?? null : null, createdAt: base };
    inspections = replaceById(inspections, item);
    count("inspections", !!existing);
  }

  /* Parking */
  for (const row of plan.rows.parking) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.parkingById.get(row.existingId) : undefined;
    const fields = { propertyId: property.id, spaceNumber: d.spaceNumber, unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null, tenantId: tenantOf(d.tenantPhone)?.id ?? null, vehiclePlate: d.vehiclePlate, paid: d.paid, monthlyFee: d.monthlyFee, status: d.status, notes: d.notes };
    const item: ParkingSpace = existing ? { ...existing, ...fields } : { id: ids.parking(property.id, d.spaceNumber), ...fields };
    parking = replaceById(parking, item);
    count("parking", !!existing);
  }

  /* Keys */
  for (const row of plan.rows.keys) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const property = propertyByCode.get(d.propertyCode);
    if (!property) continue;
    const existing = row.existingId ? idx.keyById.get(row.existingId) : undefined;
    const tenant = tenantOf(d.tenantPhone);
    const fields = { propertyId: property.id, unitId: unitOf(d.propertyCode, d.unitNumber)?.id ?? null, type: d.type, identifier: d.identifier, assignedTo: d.assignedTo ?? tenant?.fullName ?? null, tenantId: tenant?.id ?? null, issuedDate: d.issuedDate, returnedDate: d.returnedDate, status: d.status, notes: d.notes };
    const item: KeyItem = existing ? { ...existing, ...fields } : { id: ids.key(property.id, d.identifier), ...fields };
    keys = replaceById(keys, item);
    count("keys", !!existing);
  }

  /* Documents */
  for (const row of plan.rows.documents) {
    if (row.action === "skip" || !row.data) continue;
    const d = row.data;
    const tenant = tenantOf(d.tenantPhone);
    const property = d.propertyCode ? propertyByCode.get(d.propertyCode) ?? null : null;
    const asset = d.propertyCode ? assetOf(d.propertyCode, d.assetName) : null;
    if (!tenant && !property) continue;
    const contract = d.contractNumber ? contractByNumber.get(d.contractNumber.toUpperCase()) ?? null : null;
    const workOrder = d.workOrderNumber ? workOrderByNumber.get(d.workOrderNumber.toUpperCase()) ?? null : null;
    const existing = row.existingId ? idx.documentById.get(row.existingId) : undefined;
    const fields = {
      kind: d.kind,
      category: d.category,
      title: d.title,
      fileName: d.fileName,
      mimeType: mimeFor(d.fileName),
      tenantId: tenant?.id ?? contract?.tenantId ?? null,
      contractId: contract?.id ?? null,
      unitId: contract?.unitId ?? workOrder?.unitId ?? asset?.unitId ?? null,
      propertyId: property?.id ?? contract?.propertyId ?? workOrder?.propertyId ?? null,
      workOrderId: workOrder?.id ?? null,
      assetId: asset?.id ?? null,
      issuedDate: d.issuedDate,
      expiryDate: d.expiryDate,
    };
    const owner = tenant?.id ?? asset?.id ?? property!.id;
    const doc: StoredDocument = existing
      ? { ...existing, ...fields }
      : {
          id: ids.document(owner, d.kind, d.fileName),
          ...fields,
          paymentId: null,
          expenseId: null,
          supplierId: null,
          inspectionId: null,
          renovationId: null,
          sizeKb: 120 + (parseInt(shortHash(d.fileName), 36) % 900),
          uploadedAt: d.issuedDate ?? base,
          generated: false,
          dataUrl: null,
          deleted: false,
        };
    documents = replaceById(documents, doc);
    count("documents", !!existing);
  }

  const next: Store = {
    ...store,
    properties,
    units,
    tenants,
    contracts,
    payments,
    documents,
    suppliers,
    assets,
    workOrders,
    preventivePlans,
    expenses,
    budgets,
    deposits,
    meters,
    readings,
    commonCharges,
    inspections,
    renovations,
    parking,
    keys,
  };

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
  for (const e of IMPORT_ORDER) {
    const c = summary.created[e];
    const u = summary.updated[e];
    if (c > 0) parts.push(`${c} ${c === 1 ? ENTITY_LABELS[e][0] : ENTITY_LABELS[e][1]} created`);
    if (u > 0) parts.push(`${u} ${u === 1 ? ENTITY_LABELS[e][0] : ENTITY_LABELS[e][1]} updated`);
  }
  return parts.length > 0 ? parts.join(", ") + "." : "Nothing to import.";
}

/** Months a contract of this frequency bills at once. */
export function billingMonths(contract: Contract): number {
  return FREQUENCY_MONTHS[contract.paymentFrequency] ?? 1;
}

export { addMonthsISO };
