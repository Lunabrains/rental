import { indexStore } from "@/lib/data/store";
import { normalizePhone } from "@/lib/data/ids";
import { daysBetween, periodOf, today } from "@/lib/date";
import type {
  AllocationMethod,
  AssetStatus,
  AssetType,
  BillingMethod,
  ContractStatus,
  DocumentCategory,
  DocumentKind,
  ExpenseCategory,
  ExpenseClassification,
  ExpensePaymentStatus,
  IdDocumentType,
  InspectionResult,
  InspectionStatus,
  InspectionType,
  ISODate,
  ItemResult,
  KeyStatus,
  KeyType,
  ParkingStatus,
  PaymentFrequency,
  PaymentMethod,
  PlanStatus,
  PropertyStatus,
  PropertyType,
  Recurrence,
  RenewalDecision,
  RenovationStatus,
  RenovationType,
  Store,
  SupplierCategory,
  UnitCondition,
  UtilityType,
  WorkOrderCategory,
  WorkOrderPriority,
  WorkOrderSource,
  WorkOrderStatus,
} from "@/types";
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  BILLING_METHODS,
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_STATUSES,
  INSPECTION_STATUSES,
  INSPECTION_TYPES,
  KEY_STATUSES,
  KEY_TYPES,
  PARKING_STATUSES,
  PAYMENT_FREQUENCIES,
  PROPERTY_STATUSES,
  PROPERTY_TYPES,
  RECURRENCES,
  RENOVATION_STATUSES,
  RENOVATION_TYPES,
  SUPPLIER_CATEGORIES,
  UNIT_CONDITIONS,
  UTILITY_TYPES,
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  DOCUMENT_CATEGORIES,
} from "@/types";

import { resolveDateValue, resolvePaymentDay } from "./dates";
import { COLUMNS, IMPORT_ORDER, type ColumnSpec, type ImportEntity } from "./template";
import type {
  AssetDraft,
  BudgetDraft,
  ChargeDraft,
  ContractDraft,
  DeductionDraft,
  DepositDraft,
  DocumentDraft,
  ExpenseDraft,
  ImportPlan,
  InspectionDraft,
  InspectionItemDraft,
  KeyDraft,
  MeterDraft,
  ParkingDraft,
  ParsedWorkbook,
  PatternEntry,
  PlanCounts,
  PlanDraft,
  PlannedRow,
  PropertyDraft,
  RawRow,
  ReadingDraft,
  RenovationDraft,
  RowIssue,
  SupplierDraft,
  TenantDraft,
  UnitDraft,
  WorkOrderDraft,
} from "./types";

/* ------------------------------ Cell coercion ----------------------------- */

class RowReader {
  readonly issues: RowIssue[] = [];
  private readonly specs: Map<string, ColumnSpec>;

  constructor(
    private readonly row: RawRow,
    entity: ImportEntity,
    private readonly base: ISODate,
  ) {
    this.specs = new Map(COLUMNS[entity].map((c) => [c.key, c]));
  }

  private raw(key: string): unknown {
    const v = this.row.values[key];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v;
  }

  error(column: string | null, message: string): void {
    this.issues.push({ level: "error", column, message });
  }

  warn(column: string | null, message: string): void {
    this.issues.push({ level: "warning", column, message });
  }

  get hasErrors(): boolean {
    return this.issues.some((i) => i.level === "error");
  }

  text(key: string): string {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return "";
    }
    return String(v).trim();
  }

  optionalText(key: string): string | null {
    const s = this.text(key);
    return s === "" ? null : s;
  }

  int(key: string, fallback: number | null = null): number | null {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return fallback;
    }
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
    if (!Number.isFinite(n)) {
      this.error(key, `${key} must be a whole number`);
      return fallback;
    }
    return Math.round(n);
  }

  number(key: string, fallback: number | null = null): number | null {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return fallback;
    }
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) {
      this.error(key, `${key} must be a number`);
      return fallback;
    }
    return n;
  }

  /** A money amount that must not be negative (plan §14). */
  amount(key: string, fallback: number | null = null): number | null {
    const n = this.number(key, fallback);
    if (n !== null && n < 0) {
      this.error(key, `${key} cannot be negative`);
      return fallback;
    }
    return n;
  }

  bool(key: string, fallback = false): boolean {
    const v = this.raw(key);
    if (v === null) return fallback;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["yes", "y", "true", "1"].includes(s)) return true;
    if (["no", "n", "false", "0"].includes(s)) return false;
    this.warn(key, `${key} should be yes/no — treated as ${fallback ? "yes" : "no"}`);
    return fallback;
  }

  date(key: string): ISODate | null {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return null;
    }
    const r = resolveDateValue(v, this.base);
    if (!r.ok) {
      this.error(key, `${key}: ${r.reason}`);
      return null;
    }
    return r.value;
  }

  /** `YYYY-MM`, `YYYY`, or a relative token → a period plus its type. */
  period(key: string): { period: string; type: "month" | "year" } | null {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return null;
    }
    const s = String(v).trim().toLowerCase();
    if (s === "year" || s === "thisyear") return { period: this.base.slice(0, 4), type: "year" };
    if (/^\d{4}$/.test(s)) return { period: s, type: "year" };
    if (/^\d{4}-\d{2}$/.test(s)) return { period: s, type: "month" };
    if (v instanceof Date || typeof v === "number") {
      const r = resolveDateValue(v, this.base);
      if (r.ok) return { period: periodOf(r.value), type: "month" };
    }
    const r = resolveDateValue(s, this.base);
    if (r.ok) return { period: periodOf(r.value), type: "month" };
    this.error(key, `${key}: expected YYYY-MM, YYYY or a relative token`);
    return null;
  }

  enumValue<T extends string>(key: string, values: readonly T[], fallback: T): T {
    const v = this.raw(key);
    if (v === null) {
      if (this.specs.get(key)?.required) this.error(key, `${key} is required`);
      return fallback;
    }
    const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if ((values as readonly string[]).includes(s)) return s as T;
    this.warn(key, `${key} "${String(v)}" not recognised — using ${fallback}`);
    return fallback;
  }

  paymentDay(key: string, fallback: number): number {
    const v = this.raw(key);
    if (v === null) return fallback;
    const d = resolvePaymentDay(v, this.base);
    if (d === null) {
      this.warn(key, `${key} not recognised — using ${fallback}`);
      return fallback;
    }
    return d;
  }

  /** Comma-separated list. */
  list(key: string): string[] {
    const s = this.text(key);
    return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
  }

  /** `|`-separated entries. */
  entries(key: string): string[] {
    const s = this.text(key);
    return s ? s.split("|").map((x) => x.trim()).filter(Boolean) : [];
  }
}

/* --------------------------- Payment pattern DSL -------------------------- */

const PATTERN = /^(overdue|late|partial|unpaid)@([+-]?\d+)(?::(\d+(?:\.\d+)?))?$/i;

export function parsePaymentPattern(raw: string | null, warn: (msg: string) => void): PatternEntry[] {
  if (!raw) return [];
  const out: PatternEntry[] = [];
  for (const part of raw.split("|").map((p) => p.trim()).filter(Boolean)) {
    const m = PATTERN.exec(part);
    if (!m) {
      warn(`payment_pattern entry "${part}" ignored — expected e.g. overdue@-8, late@-150:5, partial@-12:800`);
      continue;
    }
    out.push({
      kind: m[1].toLowerCase() as PatternEntry["kind"],
      offsetDays: Number(m[2]),
      arg: m[3] !== undefined ? Number(m[3]) : null,
    });
  }
  return out;
}

/* ------------------------------ Lookup context ---------------------------- */

const NEW = "*new*";

interface Ctx {
  store: Store;
  base: ISODate;
  /** property_code (upper) → id in store, or NEW when defined in this file. */
  propertyIds: Map<string, string>;
  propertyFloors: Map<string, number>;
  /** "CODE:unit" → unit id in store, or NEW. */
  unitIds: Map<string, string>;
  /** normalised phone → tenant id in store, or NEW. */
  tenantIdsByPhone: Map<string, string>;
  tenantIdsByIdNumber: Map<string, string>;
  /** contract_number (upper) → contract id in store, or NEW. */
  contractIds: Map<string, string>;
  /** unit key → contract numbers that are occupying it (store + file). */
  occupyingByUnit: Map<string, string[]>;
  supplierIds: Map<string, string>;
  /** "CODE:ASSET NAME" (upper) */
  assetIds: Map<string, string>;
  workOrderIds: Map<string, string>;
  planIds: Map<string, string>;
  expenseIds: Map<string, string>;
  budgetIds: Map<string, string>;
  depositIds: Map<string, string>;
  meterIds: Map<string, string>;
  readingIds: Map<string, string>;
  chargeIds: Map<string, string>;
  inspectionIds: Map<string, string>;
  renovationIds: Map<string, string>;
  parkingIds: Map<string, string>;
  keyIds: Map<string, string>;
  documentIds: Map<string, string>;
}

function buildCtx(store: Store, base: ISODate): Ctx {
  const idx = indexStore(store);
  const propertyIds = new Map<string, string>();
  const propertyFloors = new Map<string, number>();
  const codeById = new Map<string, string>();
  for (const p of store.properties) {
    propertyIds.set(p.code.toUpperCase(), p.id);
    propertyFloors.set(p.code.toUpperCase(), p.floors);
    codeById.set(p.id, p.code.toUpperCase());
  }
  const unitIds = new Map<string, string>();
  const unitKeyById = new Map<string, string>();
  for (const u of store.units) {
    const code = codeById.get(u.propertyId);
    if (code) {
      unitIds.set(`${code}:${u.unitNumber}`, u.id);
      unitKeyById.set(u.id, `${code}:${u.unitNumber}`);
    }
  }
  const tenantIdsByPhone = new Map<string, string>();
  const tenantIdsByIdNumber = new Map<string, string>();
  const phoneById = new Map<string, string>();
  for (const t of store.tenants) {
    if (t.phone) {
      tenantIdsByPhone.set(normalizePhone(t.phone), t.id);
      phoneById.set(t.id, normalizePhone(t.phone));
    }
    if (t.idNumber) tenantIdsByIdNumber.set(t.idNumber.toUpperCase(), t.id);
  }
  const contractIds = new Map<string, string>();
  const contractNumberById = new Map<string, string>();
  const occupyingByUnit = new Map<string, string[]>();
  for (const c of store.contracts) {
    contractIds.set(c.contractNumber.toUpperCase(), c.id);
    contractNumberById.set(c.id, c.contractNumber.toUpperCase());
    if (c.status === "active" || c.status === "notice_given") {
      const key = unitKeyById.get(c.unitId);
      if (key) occupyingByUnit.set(key, [...(occupyingByUnit.get(key) ?? []), c.contractNumber]);
    }
  }
  const supplierIds = new Map(store.suppliers.map((s) => [s.name.toUpperCase(), s.id]));
  const assetIds = new Map<string, string>();
  const assetKeyById = new Map<string, string>();
  for (const a of store.assets) {
    const code = codeById.get(a.propertyId);
    if (code) {
      assetIds.set(`${code}:${a.name.toUpperCase()}`, a.id);
      assetKeyById.set(a.id, `${code}:${a.name.toUpperCase()}`);
    }
  }
  const workOrderIds = new Map(store.workOrders.map((w) => [w.number.toUpperCase(), w.id]));
  const planIds = new Map<string, string>();
  for (const p of store.preventivePlans) {
    const code = codeById.get(p.propertyId);
    const assetKey = p.assetId ? assetKeyById.get(p.assetId) : null;
    if (code) planIds.set(`${assetKey ?? code}:${p.maintenanceType.toUpperCase()}`, p.id);
  }
  const expenseIds = new Map<string, string>();
  for (const e of store.expenses) {
    const code = codeById.get(e.propertyId);
    if (code) expenseIds.set(`${code}:${e.expenseDate}:${e.description.toUpperCase()}`, e.id);
  }
  const budgetIds = new Map<string, string>();
  for (const b of store.budgets) {
    const code = codeById.get(b.propertyId);
    if (code) budgetIds.set(`${code}:${b.period}:${b.category}`, b.id);
  }
  const depositIds = new Map<string, string>();
  for (const d of store.deposits) {
    const number = contractNumberById.get(d.contractId);
    if (number) depositIds.set(number, d.id);
  }
  const meterIds = new Map(store.meters.map((m) => [m.meterNumber.toUpperCase(), m.id]));
  const meterNumberById = new Map(store.meters.map((m) => [m.id, m.meterNumber.toUpperCase()]));
  const readingIds = new Map<string, string>();
  for (const r of store.readings) {
    const number = meterNumberById.get(r.meterId);
    if (number) readingIds.set(`${number}:${r.readingDate}`, r.id);
  }
  const chargeIds = new Map<string, string>();
  for (const c of store.commonCharges) {
    const code = codeById.get(c.propertyId);
    if (code) chargeIds.set(`${code}:${c.period}:${c.category.toUpperCase()}`, c.id);
  }
  const inspectionIds = new Map<string, string>();
  for (const i of store.inspections) {
    const code = codeById.get(i.propertyId);
    const unit = i.unitId ? idx.unitById.get(i.unitId)?.unitNumber ?? "" : "";
    if (code) inspectionIds.set(`${code}:${unit}:${i.type}:${i.scheduledDate}`, i.id);
  }
  const renovationIds = new Map<string, string>();
  for (const r of store.renovations) {
    const code = codeById.get(r.propertyId);
    if (code) renovationIds.set(`${code}:${r.title.toUpperCase()}`, r.id);
  }
  const parkingIds = new Map<string, string>();
  for (const p of store.parking) {
    const code = codeById.get(p.propertyId);
    if (code) parkingIds.set(`${code}:${p.spaceNumber.toUpperCase()}`, p.id);
  }
  const keyIds = new Map<string, string>();
  for (const k of store.keys) {
    const code = codeById.get(k.propertyId);
    if (code) keyIds.set(`${code}:${k.identifier.toUpperCase()}`, k.id);
  }
  const documentIds = new Map<string, string>();
  for (const d of store.documents) {
    const owner = d.tenantId ? phoneById.get(d.tenantId) : d.assetId ? assetKeyById.get(d.assetId) : d.propertyId ? codeById.get(d.propertyId) : null;
    if (owner) documentIds.set(`${owner}:${d.kind}:${d.fileName.toLowerCase()}`, d.id);
  }
  return {
    store,
    base,
    propertyIds,
    propertyFloors,
    unitIds,
    tenantIdsByPhone,
    tenantIdsByIdNumber,
    contractIds,
    occupyingByUnit,
    supplierIds,
    assetIds,
    workOrderIds,
    planIds,
    expenseIds,
    budgetIds,
    depositIds,
    meterIds,
    readingIds,
    chargeIds,
    inspectionIds,
    renovationIds,
    parkingIds,
    keyIds,
    documentIds,
  };
}

/* ------------------------------- Per-entity ------------------------------- */

function finish<E extends ImportEntity>(
  entity: E,
  row: RawRow,
  reader: RowReader,
  key: string,
  label: string,
  existingId: string | null,
  data: PlannedRow<E>["data"],
  seen: Map<string, number>,
): PlannedRow<E> {
  let action: PlannedRow["action"] = existingId ? "update" : "create";
  if (key && seen.has(key)) {
    reader.warn(null, `Duplicate of row ${seen.get(key)} — skipped`);
    action = "skip";
  } else if (key) {
    seen.set(key, row.rowNumber);
  }
  if (reader.hasErrors) action = "skip";
  return {
    entity,
    rowNumber: row.rowNumber,
    key,
    label,
    action,
    existingId: action === "skip" ? null : existingId,
    issues: reader.issues,
    data: action === "skip" ? null : data,
  };
}

const existingOf = (map: Map<string, string>, key: string): string | null => {
  const v = map.get(key);
  return v === undefined || v === NEW ? null : v;
};

/** Shared reference checks. */
function refs(r: RowReader, ctx: Ctx) {
  return {
    property(): string {
      const code = r.text("property_code").toUpperCase();
      if (code && !ctx.propertyIds.has(code)) r.error("property_code", `Unknown property "${code}"`);
      return code;
    },
    optionalProperty(): string | null {
      const code = r.optionalText("property_code")?.toUpperCase() ?? null;
      if (code && !ctx.propertyIds.has(code)) r.error("property_code", `Unknown property "${code}"`);
      return code;
    },
    unit(code: string, required = false): string | null {
      const unitNumber = required ? r.text("unit_number") : r.optionalText("unit_number");
      if (!unitNumber) return null;
      if (code && !ctx.unitIds.has(`${code}:${unitNumber}`)) r.error("unit_number", `Unknown unit ${code} ${unitNumber}`);
      return unitNumber;
    },
    tenant(key = "tenant_phone", required = false): string | null {
      const raw = required ? r.text(key) : r.optionalText(key);
      if (!raw) return null;
      const phone = normalizePhone(raw);
      if (phone && !ctx.tenantIdsByPhone.has(phone)) r.error(key, `No tenant with phone ${raw}`);
      return phone;
    },
    supplier(key = "supplier_name"): string | null {
      const name = r.optionalText(key);
      if (name && !ctx.supplierIds.has(name.toUpperCase())) {
        r.warn(key, `Unknown supplier "${name}" — imported without a supplier link`);
        return null;
      }
      return name;
    },
    asset(code: string, key = "asset_name"): string | null {
      const name = r.optionalText(key);
      if (name && !ctx.assetIds.has(`${code}:${name.toUpperCase()}`)) {
        r.warn(key, `Unknown asset "${name}" in ${code} — imported without an asset link`);
        return null;
      }
      return name;
    },
    workOrder(key: string): string | null {
      const number = r.optionalText(key);
      if (number && !ctx.workOrderIds.has(number.toUpperCase())) {
        r.warn(key, `Unknown work order ${number} — imported without a link`);
        return null;
      }
      return number;
    },
    contract(key = "contract_number", required = false): string | null {
      const number = required ? r.text(key) : r.optionalText(key);
      if (!number) return null;
      if (!ctx.contractIds.has(number.toUpperCase())) {
        if (required) r.error(key, `Unknown contract ${number}`);
        else r.warn(key, `Unknown contract ${number} — imported without a contract link`);
        return required ? number : null;
      }
      return number;
    },
  };
}

function planProperties(rows: RawRow[], ctx: Ctx): PlannedRow<"properties">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "properties", ctx.base);
    const code = r.text("property_code").toUpperCase();
    const name = r.text("name");
    const floors = r.int("floors") ?? 0;
    const unitsPerFloor = r.int("units_per_floor") ?? 0;
    if (floors <= 0 && !r.hasErrors) r.error("floors", "floors must be at least 1");
    if (unitsPerFloor <= 0 && !r.hasErrors) r.error("units_per_floor", "units_per_floor must be at least 1");

    const data: PropertyDraft = {
      code,
      name,
      address: r.text("address"),
      district: r.text("district"),
      city: r.text("city"),
      country: r.text("country") || "Lebanon",
      yearBuilt: r.int("year_built"),
      floors,
      unitsPerFloor,
      type: r.enumValue<PropertyType>("type", PROPERTY_TYPES, "residential"),
      status: r.enumValue<PropertyStatus>("status", PROPERTY_STATUSES, "active"),
      acquisitionDate: r.date("acquisition_date"),
      acquisitionCost: r.amount("acquisition_cost"),
      estimatedValue: r.amount("estimated_value"),
      insuranceProvider: r.optionalText("insurance_provider"),
      insurancePolicyNumber: r.optionalText("insurance_policy_number"),
      insuranceExpiry: r.date("insurance_expiry"),
      notes: r.optionalText("notes"),
    };

    const planned = finish("properties", row, r, code, name || code, existingOf(ctx.propertyIds, code), data, seen);
    if (planned.action !== "skip") {
      if (!ctx.propertyIds.has(code)) ctx.propertyIds.set(code, NEW);
      ctx.propertyFloors.set(code, floors);
    }
    return planned;
  });
}

function planUnits(rows: RawRow[], ctx: Ctx): PlannedRow<"units">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "units", ctx.base);
    const code = refs(r, ctx).property();
    const unitNumber = r.text("unit_number");

    const floor = r.int("floor") ?? 0;
    const maxFloor = ctx.propertyFloors.get(code);
    if (maxFloor !== undefined && floor > maxFloor) r.warn("floor", `Floor ${floor} is above the building's ${maxFloor} floors`);

    const askingRent = r.amount("asking_rent");
    if (askingRent === null) r.warn("asking_rent", "No asking rent — imported as available with no asking price");

    const data: UnitDraft = {
      propertyCode: code,
      unitNumber,
      floor,
      bedrooms: r.int("bedrooms", 1) ?? 1,
      bathrooms: r.int("bathrooms", 1) ?? 1,
      sizeSqm: r.number("size_sqm", 0) ?? 0,
      furnished: r.bool("furnished"),
      askingRent: askingRent ?? 0,
      askingDeposit: r.amount("asking_deposit", askingRent ?? 0) ?? 0,
      marketRent: r.amount("market_rent"),
      condition: r.enumValue<UnitCondition>("condition", UNIT_CONDITIONS, "good"),
      statusOverride: (() => {
        const v = r.enumValue("status", ["", "maintenance", "reserved", "renovation", "unavailable"] as const, "");
        return v === "" ? null : v;
      })(),
      notes: r.optionalText("notes"),
    };

    const key = code && unitNumber ? `${code}:${unitNumber}` : "";
    const planned = finish("units", row, r, key, `${code} ${unitNumber}`.trim(), existingOf(ctx.unitIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.unitIds.has(key)) ctx.unitIds.set(key, NEW);
    return planned;
  });
}

function planTenants(rows: RawRow[], ctx: Ctx): PlannedRow<"tenants">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "tenants", ctx.base);
    const firstName = r.text("first_name");
    const lastName = r.text("last_name");
    const rawPhone = r.optionalText("phone");
    const phone = rawPhone ? normalizePhone(rawPhone) : "";
    const idNumber = r.text("id_number");

    // `phone` is marked required in the spec, so RowReader already errored if
    // it is missing. Downgrade to a warning when id_number can key the row.
    if (!phone && idNumber) {
      const i = r.issues.findIndex((x) => x.column === "phone" && x.level === "error");
      if (i >= 0) r.issues.splice(i, 1);
      r.warn("phone", "No phone — matched on id_number instead");
    }
    if (!idNumber) r.warn("id_number", "No ID number on file");

    const data: TenantDraft = {
      firstName,
      lastName,
      phone,
      email: r.text("email"),
      nationality: r.text("nationality") || "Lebanese",
      idType: r.enumValue<IdDocumentType>("id_type", ["national_id", "passport", "residency_permit"], "national_id"),
      idNumber,
      occupation: r.optionalText("occupation"),
      emergencyContactName: r.optionalText("emergency_contact_name"),
      emergencyContactPhone: r.optionalText("emergency_contact_phone"),
      notes: r.optionalText("notes"),
    };

    const key = phone || (idNumber ? `id:${idNumber.toUpperCase()}` : "");
    const existing =
      (phone ? existingOf(ctx.tenantIdsByPhone, phone) : null) ??
      (idNumber ? existingOf(ctx.tenantIdsByIdNumber, idNumber.toUpperCase()) : null);
    const planned = finish("tenants", row, r, key, `${firstName} ${lastName}`.trim(), existing, data, seen);
    if (planned.action !== "skip") {
      if (phone && !ctx.tenantIdsByPhone.has(phone)) ctx.tenantIdsByPhone.set(phone, NEW);
      if (idNumber && !ctx.tenantIdsByIdNumber.has(idNumber.toUpperCase())) ctx.tenantIdsByIdNumber.set(idNumber.toUpperCase(), NEW);
    }
    return planned;
  });
}

function planContracts(rows: RawRow[], ctx: Ctx): PlannedRow<"contracts">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "contracts", ctx.base);
    const contractNumber = r.text("contract_number");
    const code = refs(r, ctx).property();
    const unitNumber = r.text("unit_number");
    const unitKey = `${code}:${unitNumber}`;
    if (code && ctx.propertyIds.has(code) && unitNumber && !ctx.unitIds.has(unitKey)) r.error("unit_number", `Unknown unit ${code} ${unitNumber}`);

    const rawPhone = r.text("tenant_phone");
    const tenantPhone = rawPhone ? normalizePhone(rawPhone) : "";
    if (tenantPhone && !ctx.tenantIdsByPhone.has(tenantPhone)) r.error("tenant_phone", `No tenant with phone ${rawPhone}`);

    const startDate = r.date("start_date");
    const endDate = r.date("end_date");
    if (startDate && endDate && endDate < startDate) r.error("end_date", "end_date is before start_date");

    const monthlyRent = r.amount("monthly_rent");
    if (monthlyRent !== null && monthlyRent <= 0) r.error("monthly_rent", "monthly_rent must be greater than 0");

    const defaultStatus: ContractStatus = endDate && endDate < ctx.base ? "expired" : "active";
    const status = r.enumValue<ContractStatus>("status", ["active", "expired", "terminated", "renewed", "notice_given"], defaultStatus);
    const moveOutDate = r.date("move_out_date");
    if (status === "terminated" && !moveOutDate) r.warn("move_out_date", "Terminated contract without a move_out_date — using end_date");

    const pattern = parsePaymentPattern(r.optionalText("payment_pattern"), (m) => r.warn("payment_pattern", m));
    const decision = r.enumValue("renewal_decision", ["", "awaiting_decision", "renew", "do_not_renew"] as const, "");

    const startDay = startDate ? Number(startDate.slice(8, 10)) : 1;
    const data: ContractDraft = {
      contractNumber,
      propertyCode: code,
      unitNumber,
      tenantPhone,
      startDate: startDate ?? ctx.base,
      endDate: endDate ?? ctx.base,
      monthlyRent: monthlyRent ?? 0,
      deposit: r.amount("deposit", monthlyRent) ?? monthlyRent ?? 0,
      paymentDay: r.paymentDay("payment_day", Math.min(28, startDay)),
      paymentFrequency: r.enumValue<PaymentFrequency>("payment_frequency", PAYMENT_FREQUENCIES, "monthly"),
      paymentMethod: r.enumValue<PaymentMethod>("payment_method", ["cash", "bank_transfer", "cheque", "card"], "bank_transfer"),
      status,
      moveOutDate: moveOutDate ?? (status === "terminated" ? endDate : null),
      rentIncreaseClause: r.optionalText("rent_increase_clause"),
      specialTerms: r.optionalText("special_terms"),
      renewalDecision: decision === "" ? null : (decision as RenewalDecision),
      proposedRent: r.amount("proposed_rent"),
      renewalNotes: r.optionalText("renewal_notes"),
      notes: r.optionalText("notes"),
      paymentPattern: pattern,
    };

    if (startDate && endDate && !r.hasErrors) {
      const months = Math.round(daysBetween(startDate, endDate) / 30);
      if (months > 60) r.warn("end_date", `Unusually long contract (${months} months)`);
    }

    const occupying = status === "active" || status === "notice_given";
    if (occupying && !r.hasErrors) {
      const others = (ctx.occupyingByUnit.get(unitKey) ?? []).filter((n) => n.toUpperCase() !== contractNumber.toUpperCase());
      if (others.length > 0) r.warn("unit_number", `Unit already has an active contract (${others.join(", ")})`);
    }

    const key = contractNumber.toUpperCase();
    const planned = finish("contracts", row, r, key, `${contractNumber} · ${code} ${unitNumber}`.trim(), existingOf(ctx.contractIds, key), data, seen);
    if (planned.action !== "skip") {
      if (!ctx.contractIds.has(key)) ctx.contractIds.set(key, NEW);
      if (occupying) ctx.occupyingByUnit.set(unitKey, [...(ctx.occupyingByUnit.get(unitKey) ?? []), contractNumber]);
    }
    return planned;
  });
}

function planSuppliers(rows: RawRow[], ctx: Ctx): PlannedRow<"suppliers">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "suppliers", ctx.base);
    const name = r.text("name");
    const rating = r.number("rating");
    if (rating !== null && (rating < 1 || rating > 5)) r.warn("rating", "rating should be between 1 and 5");
    const data: SupplierDraft = {
      name,
      category: r.enumValue<SupplierCategory>("category", SUPPLIER_CATEGORIES, "other"),
      phone: r.text("phone"),
      email: r.text("email"),
      company: r.optionalText("company"),
      services: r.list("services"),
      rating: rating === null ? null : Math.min(5, Math.max(1, Math.round(rating * 2) / 2)),
      active: r.bool("active", true),
      notes: r.optionalText("notes"),
    };
    const key = name.toUpperCase();
    const planned = finish("suppliers", row, r, key, name, existingOf(ctx.supplierIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.supplierIds.has(key)) ctx.supplierIds.set(key, NEW);
    return planned;
  });
}

function planAssets(rows: RawRow[], ctx: Ctx): PlannedRow<"assets">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "assets", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const name = r.text("name");
    const data: AssetDraft = {
      propertyCode: code,
      unitNumber: ref.unit(code),
      assetType: r.enumValue<AssetType>("asset_type", ASSET_TYPES, "other"),
      name,
      manufacturer: r.optionalText("manufacturer"),
      model: r.optionalText("model"),
      serialNumber: r.optionalText("serial_number"),
      installationDate: r.date("installation_date"),
      purchaseCost: r.amount("purchase_cost"),
      warrantyExpiry: r.date("warranty_expiry"),
      supplierName: ref.supplier(),
      status: r.enumValue<AssetStatus>("status", ASSET_STATUSES, "operational"),
      lastServiceDate: r.date("last_service_date"),
      qrCode: r.optionalText("qr_code"),
      notes: r.optionalText("notes"),
    };
    const key = code && name ? `${code}:${name.toUpperCase()}` : "";
    const planned = finish("assets", row, r, key, `${code} · ${name}`, existingOf(ctx.assetIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.assetIds.has(key)) ctx.assetIds.set(key, NEW);
    return planned;
  });
}

function planWorkOrders(rows: RawRow[], ctx: Ctx): PlannedRow<"workorders">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "workorders", ctx.base);
    const ref = refs(r, ctx);
    const number = r.text("number");
    const code = ref.property();
    const status = r.enumValue<WorkOrderStatus>("status", WORK_ORDER_STATUSES, "open");
    const completedAt = r.date("completed_at");
    if ((status === "completed" || status === "closed") && !completedAt) r.warn("completed_at", "Completed work order without completion date — using reported date");
    const reportedAt = r.date("reported_at");
    const actualCost = r.amount("actual_cost");
    const repeatOf = r.optionalText("repeat_of_number");
    if (repeatOf && !ctx.workOrderIds.has(repeatOf.toUpperCase())) r.warn("repeat_of_number", `Unknown work order ${repeatOf} — repeat link dropped`);
    const data: WorkOrderDraft = {
      number,
      propertyCode: code,
      unitNumber: ref.unit(code),
      assetName: ref.asset(code),
      tenantPhone: ref.tenant(),
      title: r.text("title"),
      description: r.text("description"),
      category: r.enumValue<WorkOrderCategory>("category", WORK_ORDER_CATEGORIES, "other"),
      priority: r.enumValue<WorkOrderPriority>("priority", WORK_ORDER_PRIORITIES, "normal"),
      status,
      source: r.enumValue<WorkOrderSource>("source", ["owner", "tenant", "inspection", "preventive", "assistant"], "owner"),
      reportedAt: reportedAt ?? ctx.base,
      supplierName: ref.supplier(),
      estimatedCost: r.amount("estimated_cost"),
      actualCost,
      approvalRequired: r.bool("approval_required"),
      approvedAt: r.date("approved_at"),
      startedAt: r.date("started_at"),
      completedAt: completedAt ?? ((status === "completed" || status === "closed") ? reportedAt : null),
      closedAt: r.date("closed_at") ?? (status === "closed" ? completedAt ?? reportedAt : null),
      repeatOfNumber: repeatOf && ctx.workOrderIds.has(repeatOf.toUpperCase()) ? repeatOf : null,
      notes: r.optionalText("notes"),
    };
    const key = number.toUpperCase();
    const planned = finish("workorders", row, r, key, `${number} · ${data.title}`, existingOf(ctx.workOrderIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.workOrderIds.has(key)) ctx.workOrderIds.set(key, NEW);
    return planned;
  });
}

function planPlans(rows: RawRow[], ctx: Ctx): PlannedRow<"plans">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "plans", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const assetName = ref.asset(code);
    const type = r.text("maintenance_type");
    const recurrence = r.int("recurrence_months") ?? 0;
    if (recurrence <= 0 && !r.hasErrors) r.error("recurrence_months", "recurrence_months must be at least 1");
    const data: PlanDraft = {
      propertyCode: code,
      assetName,
      maintenanceType: type,
      recurrenceMonths: Math.max(1, recurrence),
      lastServiceDate: r.date("last_service_date"),
      nextServiceDate: r.date("next_service_date") ?? ctx.base,
      supplierName: ref.supplier(),
      estimatedCost: r.amount("estimated_cost"),
      status: r.enumValue<PlanStatus>("status", ["active", "paused"], "active"),
      reminderDays: r.int("reminder_days", 14) ?? 14,
      notes: r.optionalText("notes"),
    };
    const key = code && type ? `${assetName ? `${code}:${assetName.toUpperCase()}` : code}:${type.toUpperCase()}` : "";
    const planned = finish("plans", row, r, key, `${assetName ?? code} · ${type}`, existingOf(ctx.planIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.planIds.has(key)) ctx.planIds.set(key, NEW);
    return planned;
  });
}

function planExpenses(rows: RawRow[], ctx: Ctx): PlannedRow<"expenses">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "expenses", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const category = r.enumValue<ExpenseCategory>("category", EXPENSE_CATEGORIES, "other");
    const expenseDate = r.date("expense_date");
    const description = r.text("description");
    const paidDate = r.date("paid_date");
    const renovationTitle = r.optionalText("renovation_title");
    if (renovationTitle && !ctx.renovationIds.has(`${code}:${renovationTitle.toUpperCase()}`)) r.warn("renovation_title", `Unknown renovation "${renovationTitle}" — imported without a project link`);
    const defaultClass: ExpenseClassification = category === "renovation" || renovationTitle ? "capex" : "operating";
    const data: ExpenseDraft = {
      propertyCode: code,
      unitNumber: ref.unit(code),
      supplierName: ref.supplier(),
      category,
      amount: r.amount("amount") ?? 0,
      expenseDate: expenseDate ?? ctx.base,
      dueDate: r.date("due_date"),
      paymentStatus: r.enumValue<ExpensePaymentStatus>("payment_status", EXPENSE_PAYMENT_STATUSES, paidDate ? "paid" : "unpaid"),
      paidDate,
      recurring: r.bool("recurring"),
      recurrence: (() => {
        const v = r.enumValue("recurrence", ["", ...RECURRENCES] as const, "");
        return v === "" ? null : (v as Recurrence);
      })(),
      description,
      classification: r.enumValue<ExpenseClassification>("classification", ["operating", "capex"], defaultClass),
      invoiceNumber: r.optionalText("invoice_number"),
      workOrderNumber: ref.workOrder("work_order_number"),
      renovationTitle: renovationTitle && ctx.renovationIds.has(`${code}:${renovationTitle.toUpperCase()}`) ? renovationTitle : null,
      assetName: ref.asset(code),
      notes: r.optionalText("notes"),
    };
    if (data.paymentStatus === "paid" && !data.paidDate) data.paidDate = data.expenseDate;
    const key = code && expenseDate && description ? `${code}:${expenseDate}:${description.toUpperCase()}` : "";
    const planned = finish("expenses", row, r, key, `${code} · ${description}`, existingOf(ctx.expenseIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.expenseIds.has(key)) ctx.expenseIds.set(key, NEW);
    return planned;
  });
}

function planBudgets(rows: RawRow[], ctx: Ctx): PlannedRow<"budgets">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "budgets", ctx.base);
    const code = refs(r, ctx).property();
    const period = r.period("period");
    const category = r.enumValue<ExpenseCategory>("category", EXPENSE_CATEGORIES, "other");
    const data: BudgetDraft = {
      propertyCode: code,
      periodType: period?.type ?? "month",
      period: period?.period ?? periodOf(ctx.base),
      category,
      amount: r.amount("amount") ?? 0,
      notes: r.optionalText("notes"),
    };
    const key = code && period ? `${code}:${period.period}:${category}` : "";
    const planned = finish("budgets", row, r, key, `${code} · ${category} · ${data.period}`, existingOf(ctx.budgetIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.budgetIds.has(key)) ctx.budgetIds.set(key, NEW);
    return planned;
  });
}

function parseDeductions(entries: string[], base: ISODate, warn: (m: string) => void): DeductionDraft[] {
  const out: DeductionDraft[] = [];
  for (const e of entries) {
    const parts = e.split(":").map((x) => x.trim());
    const amount = Number(parts[1]);
    if (parts.length < 2 || !Number.isFinite(amount) || amount < 0) {
      warn(`deduction "${e}" ignored — expected description:amount[:date]`);
      continue;
    }
    const date = parts[2] ? resolveDateValue(parts[2], base) : null;
    out.push({ description: parts[0], amount, date: date && date.ok ? date.value : base });
  }
  return out;
}

function planDeposits(rows: RawRow[], ctx: Ctx): PlannedRow<"deposits">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "deposits", ctx.base);
    const contractNumber = refs(r, ctx).contract("contract_number", true) ?? "";
    const received = r.amount("amount_received");
    const refund = r.amount("final_refund");
    const deductions = parseDeductions(r.entries("deductions"), ctx.base, (m) => r.warn("deductions", m));
    const deducted = deductions.reduce((n, d) => n + d.amount, 0);
    if (received !== null && refund !== null && refund > received - deducted) r.error("final_refund", "Refund cannot exceed the deposit held after deductions");
    const data: DepositDraft = {
      contractNumber,
      amountExpected: r.amount("amount_expected"),
      amountReceived: received,
      receivedDate: r.date("received_date"),
      deductions,
      finalRefund: refund,
      settlementDate: r.date("settlement_date"),
      notes: r.optionalText("notes"),
    };
    const key = contractNumber.toUpperCase();
    const planned = finish("deposits", row, r, key, `Deposit · ${contractNumber}`, existingOf(ctx.depositIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.depositIds.has(key)) ctx.depositIds.set(key, NEW);
    return planned;
  });
}

function planMeters(rows: RawRow[], ctx: Ctx): PlannedRow<"meters">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "meters", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const meterNumber = r.text("meter_number");
    const utilityType = r.enumValue<UtilityType>("utility_type", UTILITY_TYPES, "other");
    const data: MeterDraft = {
      propertyCode: code,
      unitNumber: ref.unit(code),
      utilityType,
      meterNumber,
      billingMethod: r.enumValue<BillingMethod>("billing_method", BILLING_METHODS, "metered"),
      unitRate: r.amount("unit_rate"),
      unitLabel: r.text("unit_label") || (utilityType === "water" ? "m³" : "kWh"),
    };
    const key = meterNumber.toUpperCase();
    const planned = finish("meters", row, r, key, `${meterNumber} · ${code}`, existingOf(ctx.meterIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.meterIds.has(key)) ctx.meterIds.set(key, NEW);
    return planned;
  });
}

function planReadings(rows: RawRow[], ctx: Ctx): PlannedRow<"readings">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "readings", ctx.base);
    const meterNumber = r.text("meter_number");
    if (meterNumber && !ctx.meterIds.has(meterNumber.toUpperCase())) r.error("meter_number", `Unknown meter ${meterNumber}`);
    const readingDate = r.date("reading_date");
    const previous = r.number("previous_reading");
    const current = r.number("current_reading") ?? 0;
    const reset = r.bool("meter_reset");
    if (previous !== null && current < previous && !reset) r.warn("current_reading", "Reading is lower than the previous one — mark meter_reset if the meter was replaced");
    const data: ReadingDraft = {
      meterNumber,
      readingDate: readingDate ?? ctx.base,
      previousReading: previous,
      currentReading: current,
      meterReset: reset,
      note: r.optionalText("note"),
    };
    const key = meterNumber && readingDate ? `${meterNumber.toUpperCase()}:${readingDate}` : "";
    const planned = finish("readings", row, r, key, `${meterNumber} · ${readingDate ?? ""}`, existingOf(ctx.readingIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.readingIds.has(key)) ctx.readingIds.set(key, NEW);
    return planned;
  });
}

function planCharges(rows: RawRow[], ctx: Ctx): PlannedRow<"charges">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "charges", ctx.base);
    const code = refs(r, ctx).property();
    const period = r.period("period");
    const category = r.text("category");
    const data: ChargeDraft = {
      propertyCode: code,
      period: period?.period ?? periodOf(ctx.base),
      category,
      totalAmount: r.amount("total_amount") ?? 0,
      allocationMethod: r.enumValue<AllocationMethod>("allocation_method", ["equal", "by_area", "by_bedrooms", "custom"], "equal"),
      paidUnits: r.list("paid_units"),
      notes: r.optionalText("notes"),
    };
    const key = code && period && category ? `${code}:${period.period}:${category.toUpperCase()}` : "";
    const planned = finish("charges", row, r, key, `${code} · ${category} · ${data.period}`, existingOf(ctx.chargeIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.chargeIds.has(key)) ctx.chargeIds.set(key, NEW);
    return planned;
  });
}

const ITEM_RESULTS: ItemResult[] = ["pass", "fail", "attention", "na"];

function parseItems(entries: string[], warn: (m: string) => void): InspectionItemDraft[] {
  const out: InspectionItemDraft[] = [];
  for (const e of entries) {
    const m = /^([^/:]+)\/([^:]+):([a-z_]+)(!)?(?::(.*))?$/i.exec(e.trim());
    if (!m) {
      warn(`item "${e}" ignored — expected Area/Item:result[!][:note]`);
      continue;
    }
    const result = m[3].toLowerCase() as ItemResult;
    if (!ITEM_RESULTS.includes(result)) {
      warn(`item "${e}" ignored — result must be pass, fail, attention or na`);
      continue;
    }
    out.push({ area: m[1].trim(), item: m[2].trim(), result, followUpRequired: m[4] === "!" || (result === "fail" && m[4] !== undefined), notes: m[5]?.trim() || null });
  }
  return out;
}

function planInspections(rows: RawRow[], ctx: Ctx): PlannedRow<"inspections">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "inspections", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const unitNumber = ref.unit(code);
    const type = r.enumValue<InspectionType>("type", INSPECTION_TYPES, "annual_unit");
    const scheduledDate = r.date("scheduled_date");
    const completedDate = r.date("completed_date");
    const status = r.enumValue<InspectionStatus>("status", INSPECTION_STATUSES, completedDate ? "completed" : "scheduled");
    const items = parseItems(r.entries("items"), (m) => r.warn("items", m));
    const resultRaw = r.enumValue("overall_result", ["", "pass", "fail", "attention"] as const, "");
    let overallResult: InspectionResult | null = resultRaw === "" ? null : (resultRaw as InspectionResult);
    if (status === "completed" && !overallResult) {
      overallResult = items.some((i) => i.result === "fail") ? "fail" : items.some((i) => i.result === "attention") ? "attention" : "pass";
    }
    if (status === "completed" && !completedDate) r.warn("completed_date", "Completed inspection without completion date — using scheduled date");
    const data: InspectionDraft = {
      propertyCode: code,
      unitNumber,
      assetName: ref.asset(code),
      tenantPhone: ref.tenant(),
      type,
      scheduledDate: scheduledDate ?? ctx.base,
      completedDate: completedDate ?? (status === "completed" ? scheduledDate : null),
      inspector: r.text("inspector") || "Office",
      status,
      overallResult,
      items,
      notes: r.optionalText("notes"),
    };
    const key = code && scheduledDate ? `${code}:${unitNumber ?? ""}:${type}:${scheduledDate}` : "";
    const planned = finish("inspections", row, r, key, `${type} · ${code} ${unitNumber ?? ""}`.trim(), existingOf(ctx.inspectionIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.inspectionIds.has(key)) ctx.inspectionIds.set(key, NEW);
    return planned;
  });
}

function planRenovations(rows: RawRow[], ctx: Ctx): PlannedRow<"renovations">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "renovations", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const title = r.text("title");
    const startDate = r.date("start_date");
    const targetEnd = r.date("target_end_date");
    if (startDate && targetEnd && targetEnd < startDate) r.error("target_end_date", "target_end_date is before start_date");
    const tasks = r.entries("tasks").map((t) => {
      const done = /:done$/i.test(t);
      return { title: t.replace(/:done$/i, "").trim(), done };
    });
    const data: RenovationDraft = {
      propertyCode: code,
      unitNumber: ref.unit(code),
      title,
      description: r.text("description"),
      projectType: r.enumValue<RenovationType>("project_type", RENOVATION_TYPES, "renovation"),
      budget: r.amount("budget") ?? 0,
      contractorName: ref.supplier("contractor_name"),
      startDate: startDate ?? ctx.base,
      targetEndDate: targetEnd ?? startDate ?? ctx.base,
      actualEndDate: r.date("actual_end_date"),
      status: r.enumValue<RenovationStatus>("status", RENOVATION_STATUSES, "planned"),
      progressPercent: Math.min(100, Math.max(0, r.int("progress_percent", 0) ?? 0)),
      tasks,
      notes: r.optionalText("notes"),
    };
    const key = code && title ? `${code}:${title.toUpperCase()}` : "";
    const planned = finish("renovations", row, r, key, `${code} · ${title}`, existingOf(ctx.renovationIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.renovationIds.has(key)) ctx.renovationIds.set(key, NEW);
    return planned;
  });
}

function planParking(rows: RawRow[], ctx: Ctx): PlannedRow<"parking">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "parking", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const space = r.text("space_number");
    const unitNumber = ref.unit(code);
    const data: ParkingDraft = {
      propertyCode: code,
      spaceNumber: space,
      unitNumber,
      tenantPhone: ref.tenant(),
      vehiclePlate: r.optionalText("vehicle_plate"),
      paid: r.bool("paid"),
      monthlyFee: r.amount("monthly_fee", 0) ?? 0,
      status: r.enumValue<ParkingStatus>("status", PARKING_STATUSES, unitNumber ? "assigned" : "free"),
      notes: r.optionalText("notes"),
    };
    const key = code && space ? `${code}:${space.toUpperCase()}` : "";
    const planned = finish("parking", row, r, key, `${code} · ${space}`, existingOf(ctx.parkingIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.parkingIds.has(key)) ctx.parkingIds.set(key, NEW);
    return planned;
  });
}

function planKeys(rows: RawRow[], ctx: Ctx): PlannedRow<"keys">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "keys", ctx.base);
    const ref = refs(r, ctx);
    const code = ref.property();
    const identifier = r.text("identifier");
    const issued = r.date("issued_date");
    const returned = r.date("returned_date");
    const tenantPhone = ref.tenant();
    const data: KeyDraft = {
      propertyCode: code,
      unitNumber: ref.unit(code),
      type: r.enumValue<KeyType>("type", KEY_TYPES, "other"),
      identifier,
      assignedTo: r.optionalText("assigned_to"),
      tenantPhone,
      issuedDate: issued,
      returnedDate: returned,
      status: r.enumValue<KeyStatus>("status", KEY_STATUSES, returned ? "returned" : issued || tenantPhone ? "issued" : "in_office"),
      notes: r.optionalText("notes"),
    };
    const key = code && identifier ? `${code}:${identifier.toUpperCase()}` : "";
    const planned = finish("keys", row, r, key, `${code} · ${identifier}`, existingOf(ctx.keyIds, key), data, seen);
    if (planned.action !== "skip" && key && !ctx.keyIds.has(key)) ctx.keyIds.set(key, NEW);
    return planned;
  });
}

const CATEGORY_FOR_KIND: Record<DocumentKind, DocumentCategory> = { id: "tenant_id", passport: "tenant_id", contract: "lease", receipt: "receipt", other: "other" };

function planDocuments(rows: RawRow[], ctx: Ctx): PlannedRow<"documents">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "documents", ctx.base);
    const ref = refs(r, ctx);
    const tenantPhone = ref.tenant();
    const propertyCode = ref.optionalProperty();
    const assetName = propertyCode ? ref.asset(propertyCode) : null;
    if (!tenantPhone && !propertyCode) r.error("tenant_phone", "A document needs a tenant_phone or a property_code");
    const kind = r.enumValue<DocumentKind>("kind", ["id", "passport", "contract", "receipt", "other"], "other");
    const categoryRaw = r.enumValue("category", ["", ...DOCUMENT_CATEGORIES] as const, "");
    const fileName = r.text("file_name");
    const contractNumber = ref.contract();
    const data: DocumentDraft = {
      tenantPhone,
      propertyCode,
      assetName,
      kind,
      category: categoryRaw === "" ? CATEGORY_FOR_KIND[kind] : (categoryRaw as DocumentCategory),
      title: r.text("title") || fileName,
      fileName,
      contractNumber,
      workOrderNumber: ref.workOrder("work_order_number"),
      issuedDate: r.date("issued_date"),
      expiryDate: r.date("expiry_date"),
    };
    const owner = tenantPhone ?? (assetName ? `${propertyCode}:${assetName.toUpperCase()}` : propertyCode);
    const key = owner && fileName ? `${owner}:${kind}:${fileName.toLowerCase()}` : "";
    return finish("documents", row, r, key, `${kind} · ${fileName}`, existingOf(ctx.documentIds, key), data, seen);
  });
}

/* --------------------------------- Plan ----------------------------------- */

export function planImport(parsed: ParsedWorkbook, store: Store, base: ISODate = today()): ImportPlan {
  const ctx = buildCtx(store, base);
  const s = parsed.sheets;

  // Order matters: each planner registers the keys the next ones may reference.
  const properties = planProperties(s.properties.rows, ctx);
  const units = planUnits(s.units.rows, ctx);
  const tenants = planTenants(s.tenants.rows, ctx);
  const contracts = planContracts(s.contracts.rows, ctx);
  const suppliers = planSuppliers(s.suppliers.rows, ctx);
  const assets = planAssets(s.assets.rows, ctx);
  const workorders = planWorkOrders(s.workorders.rows, ctx);
  const plans = planPlans(s.plans.rows, ctx);
  const renovations = planRenovations(s.renovations.rows, ctx);
  const expenses = planExpenses(s.expenses.rows, ctx);
  const budgets = planBudgets(s.budgets.rows, ctx);
  const deposits = planDeposits(s.deposits.rows, ctx);
  const meters = planMeters(s.meters.rows, ctx);
  const readings = planReadings(s.readings.rows, ctx);
  const charges = planCharges(s.charges.rows, ctx);
  const inspections = planInspections(s.inspections.rows, ctx);
  const parking = planParking(s.parking.rows, ctx);
  const keys = planKeys(s.keys.rows, ctx);
  const documents = planDocuments(s.documents.rows, ctx);

  const rows = { properties, units, tenants, contracts, suppliers, assets, workorders, plans, expenses, budgets, deposits, meters, readings, charges, inspections, renovations, parking, keys, documents };

  const counts = Object.fromEntries(
    IMPORT_ORDER.map((e) => {
      const c: PlanCounts = { create: 0, update: 0, skip: 0 };
      for (const r of rows[e]) c[r.action]++;
      return [e, c];
    }),
  ) as Record<ImportEntity, PlanCounts>;

  let errorCount = 0;
  let warningCount = 0;
  for (const e of IMPORT_ORDER) {
    for (const r of rows[e]) {
      for (const i of r.issues) {
        if (i.level === "error") errorCount++;
        else warningCount++;
      }
    }
  }

  const total = IMPORT_ORDER.reduce((n, e) => n + rows[e].length, 0);

  return {
    fileName: parsed.fileName,
    today: base,
    rows,
    counts,
    errorCount,
    warningCount,
    hasPaymentsSheet: parsed.hasPaymentsSheet,
    unknownSheets: parsed.unknownSheets,
    empty: total === 0,
  };
}
