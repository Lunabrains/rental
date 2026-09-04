import { indexStore } from "@/lib/data/store";
import { normalizePhone } from "@/lib/data/ids";
import { daysBetween, today } from "@/lib/date";
import type { ContractStatus, DocumentKind, IdDocumentType, ISODate, PaymentMethod, Store } from "@/types";

import { resolveDateValue, resolvePaymentDay } from "./dates";
import { COLUMNS, IMPORT_ORDER, type ColumnSpec, type ImportEntity } from "./template";
import type {
  ContractDraft,
  DocumentDraft,
  ImportPlan,
  ParsedWorkbook,
  PatternEntry,
  PlanCounts,
  PlannedRow,
  PropertyDraft,
  RawRow,
  RowIssue,
  TenantDraft,
  UnitDraft,
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

interface Ctx {
  store: Store;
  base: ISODate;
  /** property_code (upper) → id in store, or "*new*" when defined in this file. */
  propertyIds: Map<string, string>;
  propertyFloors: Map<string, number>;
  /** "CODE:unit" → unit id in store, or "*new*". */
  unitIds: Map<string, string>;
  /** normalised phone → tenant id in store, or "*new*". */
  tenantIdsByPhone: Map<string, string>;
  tenantIdsByIdNumber: Map<string, string>;
  /** contract_number → contract id in store, or "*new*". */
  contractIds: Map<string, string>;
  /** unit key → contract numbers that are occupying it (store + file). */
  occupyingByUnit: Map<string, string[]>;
}

const NEW = "*new*";

function buildCtx(store: Store, base: ISODate): Ctx {
  const idx = indexStore(store);
  const propertyIds = new Map<string, string>();
  const propertyFloors = new Map<string, number>();
  for (const p of store.properties) {
    propertyIds.set(p.code.toUpperCase(), p.id);
    propertyFloors.set(p.code.toUpperCase(), p.floors);
  }
  const unitIds = new Map<string, string>();
  for (const u of store.units) {
    const p = idx.propertyById.get(u.propertyId);
    if (p) unitIds.set(`${p.code.toUpperCase()}:${u.unitNumber}`, u.id);
  }
  const tenantIdsByPhone = new Map<string, string>();
  const tenantIdsByIdNumber = new Map<string, string>();
  for (const t of store.tenants) {
    if (t.phone) tenantIdsByPhone.set(normalizePhone(t.phone), t.id);
    if (t.idNumber) tenantIdsByIdNumber.set(t.idNumber.toUpperCase(), t.id);
  }
  const contractIds = new Map<string, string>();
  const occupyingByUnit = new Map<string, string[]>();
  for (const c of store.contracts) {
    contractIds.set(c.contractNumber.toUpperCase(), c.id);
    if (c.status === "active" || c.status === "notice_given") {
      const u = idx.unitById.get(c.unitId);
      const p = u ? idx.propertyById.get(u.propertyId) : undefined;
      if (u && p) {
        const key = `${p.code.toUpperCase()}:${u.unitNumber}`;
        occupyingByUnit.set(key, [...(occupyingByUnit.get(key) ?? []), c.contractNumber]);
      }
    }
  }
  return { store, base, propertyIds, propertyFloors, unitIds, tenantIdsByPhone, tenantIdsByIdNumber, contractIds, occupyingByUnit };
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
      notes: r.optionalText("notes"),
    };

    const existingId = ctx.propertyIds.get(code) ?? null;
    const planned = finish("properties", row, r, code, name || code, existingId === NEW ? null : existingId, data, seen);
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
    const code = r.text("property_code").toUpperCase();
    const unitNumber = r.text("unit_number");
    if (code && !ctx.propertyIds.has(code)) r.error("property_code", `Unknown property "${code}"`);

    const floor = r.int("floor") ?? 0;
    const maxFloor = ctx.propertyFloors.get(code);
    if (maxFloor !== undefined && floor > maxFloor) r.warn("floor", `Floor ${floor} is above the building's ${maxFloor} floors`);

    const askingRent = r.number("asking_rent");
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
      askingDeposit: r.number("asking_deposit", askingRent ?? 0) ?? 0,
      statusOverride: (() => {
        const v = r.enumValue("status", ["", "maintenance", "reserved"] as const, "");
        return v === "" ? null : v;
      })(),
      notes: r.optionalText("notes"),
    };

    const key = code && unitNumber ? `${code}:${unitNumber}` : "";
    const existing = ctx.unitIds.get(key) ?? null;
    const planned = finish("units", row, r, key, `${code} ${unitNumber}`.trim(), existing === NEW ? null : existing, data, seen);
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
      (phone ? ctx.tenantIdsByPhone.get(phone) : undefined) ??
      (idNumber ? ctx.tenantIdsByIdNumber.get(idNumber.toUpperCase()) : undefined) ??
      null;
    const planned = finish(
      "tenants",
      row,
      r,
      key,
      `${firstName} ${lastName}`.trim(),
      existing === NEW ? null : existing,
      data,
      seen,
    );
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
    const code = r.text("property_code").toUpperCase();
    const unitNumber = r.text("unit_number");
    const unitKey = `${code}:${unitNumber}`;
    if (code && !ctx.propertyIds.has(code)) r.error("property_code", `Unknown property "${code}"`);
    else if (unitNumber && !ctx.unitIds.has(unitKey)) r.error("unit_number", `Unknown unit ${code} ${unitNumber}`);

    const rawPhone = r.text("tenant_phone");
    const tenantPhone = rawPhone ? normalizePhone(rawPhone) : "";
    if (tenantPhone && !ctx.tenantIdsByPhone.has(tenantPhone)) r.error("tenant_phone", `No tenant with phone ${rawPhone}`);

    const startDate = r.date("start_date");
    const endDate = r.date("end_date");
    if (startDate && endDate && endDate < startDate) r.error("end_date", "end_date is before start_date");

    const monthlyRent = r.number("monthly_rent");
    if (monthlyRent !== null && monthlyRent <= 0) r.error("monthly_rent", "monthly_rent must be greater than 0");

    const defaultStatus: ContractStatus = endDate && endDate < ctx.base ? "expired" : "active";
    const status = r.enumValue<ContractStatus>(
      "status",
      ["active", "expired", "terminated", "renewed", "notice_given"],
      defaultStatus,
    );
    const moveOutDate = r.date("move_out_date");
    if (status === "terminated" && !moveOutDate) r.warn("move_out_date", "Terminated contract without a move_out_date — using end_date");

    const pattern = parsePaymentPattern(r.optionalText("payment_pattern"), (m) => r.warn("payment_pattern", m));

    const startDay = startDate ? Number(startDate.slice(8, 10)) : 1;
    const data: ContractDraft = {
      contractNumber,
      propertyCode: code,
      unitNumber,
      tenantPhone,
      startDate: startDate ?? ctx.base,
      endDate: endDate ?? ctx.base,
      monthlyRent: monthlyRent ?? 0,
      deposit: r.number("deposit", monthlyRent) ?? monthlyRent ?? 0,
      paymentDay: r.paymentDay("payment_day", Math.min(28, startDay)),
      paymentMethod: r.enumValue<PaymentMethod>("payment_method", ["cash", "bank_transfer", "cheque", "card"], "bank_transfer"),
      status,
      moveOutDate: moveOutDate ?? (status === "terminated" ? endDate : null),
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
    const existing = ctx.contractIds.get(key) ?? null;
    const planned = finish(
      "contracts",
      row,
      r,
      key,
      `${contractNumber} · ${code} ${unitNumber}`.trim(),
      existing === NEW ? null : existing,
      data,
      seen,
    );
    if (planned.action !== "skip") {
      if (!ctx.contractIds.has(key)) ctx.contractIds.set(key, NEW);
      if (occupying) ctx.occupyingByUnit.set(unitKey, [...(ctx.occupyingByUnit.get(unitKey) ?? []), contractNumber]);
    }
    return planned;
  });
}

function planDocuments(rows: RawRow[], ctx: Ctx): PlannedRow<"documents">[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const r = new RowReader(row, "documents", ctx.base);
    const rawPhone = r.text("tenant_phone");
    const tenantPhone = rawPhone ? normalizePhone(rawPhone) : "";
    if (tenantPhone && !ctx.tenantIdsByPhone.has(tenantPhone)) r.error("tenant_phone", `No tenant with phone ${rawPhone}`);
    const kind = r.enumValue<DocumentKind>("kind", ["id", "passport", "contract", "receipt", "other"], "other");
    const fileName = r.text("file_name");
    const contractNumber = r.optionalText("contract_number");
    if (contractNumber && !ctx.contractIds.has(contractNumber.toUpperCase())) {
      r.warn("contract_number", `Unknown contract ${contractNumber} — document imported without a contract link`);
    }
    const data: DocumentDraft = {
      tenantPhone,
      kind,
      title: r.text("title") || fileName,
      fileName,
      contractNumber: contractNumber && ctx.contractIds.has(contractNumber.toUpperCase()) ? contractNumber : null,
      issuedDate: r.date("issued_date"),
      expiryDate: r.date("expiry_date"),
    };
    const key = tenantPhone && fileName ? `${tenantPhone}:${kind}:${fileName.toLowerCase()}` : "";
    const existing =
      ctx.store.documents.find((d) => {
        const t = ctx.store.tenants.find((x) => x.id === d.tenantId);
        return t && normalizePhone(t.phone) === tenantPhone && d.kind === kind && d.fileName.toLowerCase() === fileName.toLowerCase();
      })?.id ?? null;
    return finish("documents", row, r, key, `${kind} · ${fileName}`, existing, data, seen);
  });
}

/* --------------------------------- Plan ----------------------------------- */

export function planImport(parsed: ParsedWorkbook, store: Store, base: ISODate = today()): ImportPlan {
  const ctx = buildCtx(store, base);

  const rows = {
    properties: planProperties(parsed.sheets.properties.rows, ctx),
    units: planUnits(parsed.sheets.units.rows, ctx),
    tenants: planTenants(parsed.sheets.tenants.rows, ctx),
    contracts: planContracts(parsed.sheets.contracts.rows, ctx),
    documents: planDocuments(parsed.sheets.documents.rows, ctx),
  };

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
