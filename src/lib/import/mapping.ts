import * as XLSX from "xlsx";

import { addDaysISO, addMonthsISO, isISODate } from "@/lib/date";
import type { Store } from "@/types";

import { resolveDateValue } from "./dates";
import { COLUMNS, IMPORT_ORDER, PAYMENTS_SHEET, README_SHEET, SHEET_NAMES, type ColumnSpec, type ImportEntity } from "./template";
import type { ParsedSheet, ParsedWorkbook, RawRow } from "./types";

/**
 * Bring in a spreadsheet that does NOT follow the template — the owner's old
 * files. Every tab is scanned, its columns are matched to template fields by
 * synonym (English and Arabic), the user can correct the mapping, and the
 * result is rebuilt into the template shape the validator already understands.
 * Missing keys the template requires (building codes, floors, contract
 * numbers, end dates) are derived where the data allows it.
 */

/* --------------------------------- Scan ---------------------------------- */

export interface SheetScan {
  name: string;
  /** Raw header labels, in column order (blank headers become "Column N"). */
  headers: string[];
  /** Data rows below the header row (blank rows dropped). */
  rows: unknown[][];
  /** 1-based row number of the header row in the sheet. */
  headerRow: number;
}

export interface WorkbookScan {
  fileName: string;
  sheets: SheetScan[];
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

function findHeaderRow(aoa: unknown[][]): number {
  // Legacy files often start with a title or a blank line; the header is the
  // first row with at least two text cells and no more than a third empty.
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const cells = aoa[i] ?? [];
    const filled = cells.filter((c) => !isBlank(c));
    const texts = filled.filter((c) => typeof c === "string");
    if (filled.length >= 2 && texts.length >= Math.max(2, filled.length * 0.6)) return i;
  }
  return 0;
}

export function scanWorkbook(buffer: ArrayBuffer, fileName: string): WorkbookScan {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheets: SheetScan[] = [];
  for (const name of wb.SheetNames) {
    if (headerKey(name) === headerKey(README_SHEET)) continue;
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (aoa.length === 0) continue;
    const h = findHeaderRow(aoa);
    const headerCells = aoa[h] ?? [];
    const width = Math.max(headerCells.length, ...aoa.slice(h + 1).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => (isBlank(headerCells[i]) ? `Column ${i + 1}` : String(headerCells[i]).trim()));
    const rows = aoa.slice(h + 1).filter((r) => r.some((c) => !isBlank(c))).map((r) => Array.from({ length: width }, (_, i) => (typeof r[i] === "string" ? (r[i] as string).trim() : r[i] ?? null)));
    if (rows.length === 0 && headers.every((x) => x.startsWith("Column "))) continue;
    sheets.push({ name, headers, rows, headerRow: h + 1 });
  }
  return { fileName, sheets };
}

/* ------------------------------ Normalising ------------------------------ */

/** Header text → comparable key: lower-case, Arabic letters unified, punctuation dropped. */
export function headerKey(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9ء-ي]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const stripAl = (k: string) => k.split("_").map((w) => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w)).join("_");

/* -------------------------------- Synonyms -------------------------------- */

/** Fields the mapper can fill from other columns; they never reach the validator directly. */
export const VIRTUAL_KEYS = {
  property_name: { label: "Building name", description: "Building name instead of a code — the code is looked up or generated.", entities: IMPORT_ORDER.filter((e) => COLUMNS[e].some((c) => c.key === "property_code")) },
  full_name: { label: "Full name", description: "One column with the whole name — split into first / last.", entities: ["tenants"] as ImportEntity[] },
  tenant_name: { label: "Tenant name", description: "Tenant by name instead of phone — matched against the Tenants tab or existing tenants.", entities: IMPORT_ORDER.filter((e) => COLUMNS[e].some((c) => c.key === "tenant_phone")) },
  duration_months: { label: "Duration (months)", description: "Months instead of an end date.", entities: ["contracts"] as ImportEntity[] },
  total_units: { label: "Total units", description: "Number of units in the building — used with floors to derive units per floor.", entities: ["properties"] as ImportEntity[] },
  unit_ref: { label: "Building + unit", description: "One column like \"BH 403\" or \"Marina-12\" — split into building and unit.", entities: IMPORT_ORDER.filter((e) => COLUMNS[e].some((c) => c.key === "unit_number")) },
} as const;
export type VirtualKey = keyof typeof VIRTUAL_KEYS;

type Syn = Record<string, string[]>;

const COMMON: Syn = {
  property_code: ["code", "building code", "property code", "bldg code", "site code", "رمز", "رمز المبنى", "كود", "كود المبنى"],
  property_name: ["building", "building name", "property", "property name", "bldg", "site", "tower", "project", "المبنى", "اسم المبنى", "البناية", "العقار", "اسم العقار", "العماره", "العمارة"],
  unit_number: ["unit", "unit number", "unit no", "unit #", "apt", "apt no", "apartment", "apartment number", "apartment no", "flat", "flat no", "flat number", "door", "office", "shop", "unit id", "الشقة", "رقم الشقة", "الوحدة", "رقم الوحدة", "شقة"],
  unit_ref: ["unit ref", "building unit", "property unit", "location", "المبنى والشقة"],
  tenant_phone: ["tenant phone", "tenant mobile", "phone", "mobile", "tel", "telephone", "cell", "contact number", "phone number", "mobile number", "هاتف المستأجر", "رقم المستأجر"],
  tenant_name: ["tenant", "tenant name", "renter", "lessee", "occupant", "resident", "customer", "client", "المستأجر", "اسم المستأجر", "الساكن", "اسم الساكن", "الزبون"],
  supplier_name: ["supplier", "vendor", "contractor", "technician", "company", "provider", "المورد", "اسم المورد", "المتعهد", "المقاول"],
  asset_name: ["asset", "equipment", "machine", "الأصل", "المعدة", "اسم الأصل"],
  notes: ["note", "notes", "remarks", "remark", "comment", "comments", "memo", "ملاحظات", "ملاحظة", "تعليق"],
  status: ["status", "state", "الحالة", "الوضع"],
  amount: ["amount", "total", "value", "المبلغ", "القيمة", "الكلفة"],
  description: ["description", "details", "desc", "item", "الوصف", "التفاصيل", "البيان"],
  category: ["category", "type", "kind", "الفئة", "النوع", "التصنيف"],
  name: ["name", "title", "الاسم"],
  phone: ["phone", "mobile", "tel", "telephone", "cell", "phone number", "mobile number", "contact", "الهاتف", "رقم الهاتف", "الموبايل", "الجوال", "التلفون", "رقم التلفون", "هاتف"],
  email: ["email", "e mail", "mail", "email address", "البريد", "البريد الإلكتروني", "الايميل", "ايميل"],
  address: ["address", "street", "street address", "العنوان", "الشارع"],
  district: ["district", "area", "neighbourhood", "neighborhood", "region", "zone", "المنطقة", "الحي"],
  city: ["city", "town", "المدينة"],
  country: ["country", "البلد", "الدولة"],
  start_date: ["start", "start date", "from", "from date", "beginning", "begin", "lease start", "contract start", "commencement", "move in", "move in date", "تاريخ البداية", "البداية", "بداية العقد", "من تاريخ", "من"],
  end_date: ["end", "end date", "to", "to date", "until", "expiry", "expiry date", "expiration", "expires", "lease end", "contract end", "finish", "تاريخ النهاية", "النهاية", "نهاية العقد", "الى تاريخ", "إلى", "الانتهاء", "تاريخ الانتهاء"],
};

const BY_ENTITY: Partial<Record<ImportEntity, Syn>> = {
  properties: {
    name: ["name", "building", "building name", "property", "property name", "title", "الاسم", "اسم المبنى", "المبنى", "اسم العقار"],
    year_built: ["year built", "built", "construction year", "year of construction", "built in", "سنة البناء", "تاريخ البناء"],
    floors: ["floors", "no of floors", "number of floors", "storeys", "stories", "levels", "عدد الطوابق", "الطوابق", "طوابق"],
    units_per_floor: ["units per floor", "per floor", "apartments per floor", "flats per floor", "شقق بالطابق", "الشقق في الطابق", "عدد الشقق بالطابق"],
    total_units: ["units", "total units", "number of units", "no of units", "apartments", "flats", "عدد الشقق", "الشقق", "عدد الوحدات"],
    type: ["type", "property type", "usage", "use", "النوع", "نوع العقار"],
    acquisition_date: ["acquired", "acquisition date", "purchase date", "bought", "date of purchase", "تاريخ الشراء"],
    acquisition_cost: ["acquisition cost", "purchase price", "cost", "price", "bought for", "سعر الشراء", "كلفة الشراء"],
    estimated_value: ["value", "estimated value", "market value", "valuation", "worth", "القيمة", "القيمة التقديرية", "القيمة السوقية"],
    insurance_provider: ["insurer", "insurance", "insurance company", "insurance provider", "شركة التأمين", "التأمين"],
    insurance_policy_number: ["policy", "policy number", "policy no", "رقم البوليصة", "رقم بوليصة التأمين"],
    insurance_expiry: ["insurance expiry", "insurance end", "policy expiry", "insurance expires", "انتهاء التأمين", "تاريخ انتهاء التأمين"],
  },
  units: {
    floor: ["floor", "level", "storey", "story", "الطابق", "طابق"],
    bedrooms: ["bedrooms", "beds", "bed", "br", "rooms", "bedroom", "غرف النوم", "غرف", "عدد الغرف"],
    bathrooms: ["bathrooms", "baths", "bath", "wc", "toilets", "حمامات", "الحمامات", "عدد الحمامات"],
    size_sqm: ["size", "area", "sqm", "m2", "square meters", "square metres", "surface", "size sqm", "area sqm", "المساحة", "مساحة", "متر مربع"],
    furnished: ["furnished", "furnishing", "furniture", "مفروش", "مفروشة", "فرش"],
    asking_rent: ["rent", "asking rent", "monthly rent", "price", "rental", "listed rent", "الإيجار", "الايجار", "الإيجار المطلوب", "بدل الإيجار", "الايجار الشهري"],
    asking_deposit: ["deposit", "asking deposit", "security deposit", "التأمين", "الضمان", "مبلغ التأمين"],
    market_rent: ["market rent", "market", "market price", "reference rent", "إيجار السوق", "سعر السوق"],
    condition: ["condition", "state of repair", "الحالة الفنية", "حالة الشقة"],
    status: ["status", "override", "الحالة"],
  },
  tenants: {
    first_name: ["first name", "first", "given name", "forename", "الاسم الأول", "الاسم الاول"],
    last_name: ["last name", "last", "surname", "family name", "family", "الشهرة", "اسم العائلة", "الكنية", "العائلة"],
    full_name: ["name", "full name", "tenant", "tenant name", "renter", "lessee", "resident", "customer", "الاسم", "اسم المستأجر", "المستأجر", "الاسم الكامل", "الاسم الثلاثي"],
    nationality: ["nationality", "citizenship", "الجنسية"],
    id_type: ["id type", "document type", "identity type", "نوع الهوية", "نوع الوثيقة"],
    id_number: ["id", "id number", "id no", "identity", "identity number", "national id", "passport", "passport number", "passport no", "document number", "رقم الهوية", "الهوية", "رقم الجواز", "جواز السفر", "رقم السجل"],
    occupation: ["occupation", "job", "profession", "work", "employer", "المهنة", "الوظيفة", "العمل"],
    emergency_contact_name: ["emergency contact", "emergency contact name", "emergency name", "next of kin", "جهة الاتصال للطوارئ", "اسم للطوارئ"],
    emergency_contact_phone: ["emergency phone", "emergency contact phone", "emergency number", "kin phone", "هاتف الطوارئ", "رقم الطوارئ"],
  },
  contracts: {
    contract_number: ["contract", "contract number", "contract no", "contract #", "lease", "lease number", "lease no", "agreement", "agreement number", "ref", "reference", "رقم العقد", "العقد", "المرجع"],
    monthly_rent: ["rent", "monthly rent", "rent per month", "rent amount", "rental", "price", "amount", "الإيجار", "الايجار", "الإيجار الشهري", "الايجار الشهري", "بدل الإيجار", "المبلغ الشهري", "الأجرة"],
    deposit: ["deposit", "security deposit", "guarantee", "التأمين", "الضمان", "مبلغ التأمين", "الكفالة"],
    payment_day: ["payment day", "due day", "day", "day of month", "due date day", "يوم الدفع", "يوم الاستحقاق"],
    payment_frequency: ["frequency", "payment frequency", "billing", "billing frequency", "period", "cycle", "الدورية", "دورية الدفع", "طريقة الفوترة"],
    payment_method: ["payment method", "payment", "method", "paid by", "pay by", "paid via", "payment type", "mode of payment", "payment mode", "الدفع", "طريقة الدفع", "وسيلة الدفع"],
    duration_months: ["months", "duration", "term", "duration months", "period months", "length", "lease term", "المدة", "مدة العقد", "عدد الأشهر", "أشهر"],
    status: ["status", "contract status", "lease status", "الحالة", "حالة العقد"],
    move_out_date: ["move out", "move out date", "vacated", "left on", "تاريخ الخروج", "تاريخ الإخلاء", "الخروج"],
    rent_increase_clause: ["increase", "rent increase", "escalation", "increase clause", "الزيادة", "بند الزيادة"],
    special_terms: ["terms", "special terms", "conditions", "clauses", "الشروط", "شروط خاصة"],
    renewal_decision: ["renewal", "renewal decision", "renew", "decision", "التجديد", "قرار التجديد"],
    proposed_rent: ["proposed rent", "new rent", "renewal rent", "الإيجار المقترح", "الإيجار الجديد"],
    renewal_notes: ["renewal notes", "ملاحظات التجديد"],
  },
  suppliers: {
    company: ["company", "company name", "firm", "الشركة", "اسم الشركة"],
    category: ["category", "trade", "specialty", "speciality", "type", "field", "profession", "الفئة", "الاختصاص", "التخصص", "النوع", "المهنة"],
    services: ["services", "service", "offers", "scope", "الخدمات", "الاعمال"],
    rating: ["rating", "score", "stars", "التقييم"],
    active: ["active", "enabled", "current", "نشط", "فعال"],
  },
  assets: {
    asset_type: ["type", "asset type", "equipment type", "النوع", "نوع الأصل"],
    name: ["name", "asset", "asset name", "equipment", "item", "الاسم", "اسم الأصل", "المعدة"],
    manufacturer: ["manufacturer", "brand", "make", "الصانع", "الماركة", "الشركة المصنعة"],
    model: ["model", "الموديل", "الطراز"],
    serial_number: ["serial", "serial number", "serial no", "sn", "الرقم التسلسلي", "رقم التسلسل"],
    installation_date: ["installed", "installation date", "install date", "commissioned", "تاريخ التركيب", "التركيب"],
    purchase_cost: ["cost", "purchase cost", "price", "purchase price", "الكلفة", "سعر الشراء"],
    warranty_expiry: ["warranty", "warranty expiry", "warranty end", "warranty until", "الكفالة", "انتهاء الكفالة", "الضمان"],
    last_service_date: ["last service", "last serviced", "last maintenance", "serviced on", "آخر صيانة", "اخر صيانة"],
  },
  expenses: {
    amount: ["amount", "cost", "total", "value", "paid", "price", "المبلغ", "الكلفة", "القيمة", "المدفوع"],
    expense_date: ["date", "expense date", "invoice date", "paid on", "التاريخ", "تاريخ المصروف", "تاريخ الفاتورة"],
    due_date: ["due", "due date", "payable by", "تاريخ الاستحقاق", "الاستحقاق"],
    payment_status: ["status", "paid", "payment status", "paid status", "الحالة", "حالة الدفع"],
    paid_date: ["paid date", "payment date", "date paid", "تاريخ الدفع"],
    invoice_number: ["invoice", "invoice number", "invoice no", "receipt", "receipt number", "bill number", "رقم الفاتورة", "الفاتورة", "رقم الإيصال"],
    category: ["category", "type", "expense type", "account", "الفئة", "النوع", "نوع المصروف", "البند"],
    description: ["description", "details", "item", "for", "purpose", "الوصف", "التفاصيل", "البيان", "الغرض"],
    classification: ["classification", "opex capex", "capex", "kind", "التصنيف"],
    recurring: ["recurring", "repeats", "monthly", "متكرر", "دوري"],
  },
  workorders: {
    number: ["number", "wo", "wo number", "ticket", "ticket number", "ref", "reference", "id", "رقم", "رقم أمر العمل", "رقم الطلب"],
    title: ["title", "subject", "issue", "problem", "summary", "العنوان", "الموضوع", "المشكلة"],
    description: ["description", "details", "الوصف", "التفاصيل"],
    priority: ["priority", "urgency", "الأولوية", "الأهمية"],
    reported_at: ["reported", "reported at", "date", "opened", "created", "raised", "تاريخ الإبلاغ", "التاريخ", "تاريخ الطلب"],
    completed_at: ["completed", "completed at", "done", "closed on", "finished", "تاريخ الإنجاز", "تاريخ الإغلاق"],
    estimated_cost: ["estimate", "estimated cost", "quote", "الكلفة التقديرية", "التقدير"],
    actual_cost: ["cost", "actual cost", "final cost", "paid", "الكلفة", "الكلفة الفعلية"],
  },
  deposits: {
    amount_expected: ["expected", "amount expected", "deposit", "amount", "المبلغ", "المبلغ المتوقع", "التأمين"],
    amount_received: ["received", "amount received", "paid", "collected", "المستلم", "المبلغ المستلم", "المقبوض"],
    received_date: ["received date", "date received", "paid on", "تاريخ الاستلام"],
    final_refund: ["refund", "refunded", "final refund", "returned", "المسترد", "المبلغ المسترد"],
    settlement_date: ["settled", "settlement date", "returned on", "تاريخ التسوية"],
  },
};

const ENTITY_NAMES: Record<ImportEntity, string[]> = {
  properties: ["properties", "property", "buildings", "building", "bldgs", "sites", "projects", "towers", "المباني", "مباني", "العقارات", "عقارات", "البنايات", "العمارات"],
  units: ["units", "unit", "apartments", "apartment", "apts", "flats", "flat", "offices", "shops", "الشقق", "شقق", "الوحدات", "وحدات"],
  tenants: ["tenants", "tenant", "renters", "lessees", "residents", "occupants", "customers", "clients", "المستأجرين", "مستأجرين", "المستأجرون", "السكان", "الزبائن"],
  contracts: ["contracts", "contract", "leases", "lease", "agreements", "rentals", "rent roll", "العقود", "عقود", "الإيجارات", "ايجارات"],
  suppliers: ["suppliers", "supplier", "vendors", "contractors", "technicians", "providers", "الموردين", "موردين", "المتعهدين", "المقاولين"],
  assets: ["assets", "asset", "equipment", "machines", "machinery", "الأصول", "اصول", "المعدات", "معدات"],
  workorders: ["work orders", "workorders", "work order", "tickets", "maintenance", "repairs", "requests", "أوامر العمل", "اوامر العمل", "الصيانة", "طلبات الصيانة"],
  plans: ["plans", "preventive", "preventive plans", "maintenance plans", "schedules", "خطط الصيانة", "الصيانة الدورية"],
  expenses: ["expenses", "expense", "costs", "bills", "invoices", "spending", "payments out", "المصاريف", "مصاريف", "النفقات", "الفواتير"],
  budgets: ["budgets", "budget", "الميزانية", "الميزانيات"],
  deposits: ["deposits", "deposit", "security deposits", "guarantees", "التأمينات", "الضمانات", "تأمينات"],
  meters: ["meters", "meter", "utilities", "العدادات", "عدادات"],
  readings: ["readings", "reading", "meter readings", "consumption", "القراءات", "قراءات العدادات"],
  charges: ["charges", "common charges", "service charges", "building charges", "الرسوم المشتركة", "رسوم"],
  inspections: ["inspections", "inspection", "checklists", "التفتيش", "المعاينات", "الكشوفات"],
  renovations: ["renovations", "renovation", "projects", "capex", "works", "التجديدات", "المشاريع", "الترميم"],
  parking: ["parking", "parking spaces", "spaces", "garage", "المواقف", "مواقف", "الباركينغ"],
  keys: ["keys", "key", "key register", "المفاتيح", "مفاتيح"],
  documents: ["documents", "document", "files", "attachments", "paperwork", "المستندات", "الوثائق", "الملفات"],
};

/* -------------------------------- Mapping -------------------------------- */

export interface ColumnMap {
  /** Raw header label as it appears in the file. */
  header: string;
  index: number;
  /** Template key, virtual key, or null to ignore. */
  target: string | null;
}

export interface SheetMapping {
  sheet: string;
  entity: ImportEntity | null;
  columns: ColumnMap[];
  /** How the entity was chosen. */
  detected: "name" | "headers" | "preset" | "manual" | "none";
}

const keyOf = (s: unknown) => stripAl(headerKey(s));

function synonymsFor(entity: ImportEntity, key: string): Set<string> {
  const out = new Set<string>([keyOf(key), keyOf(key.replace(/_/g, " "))]);
  for (const s of BY_ENTITY[entity]?.[key] ?? COMMON[key] ?? []) out.add(keyOf(s));
  if (!BY_ENTITY[entity]?.[key]) for (const s of COMMON[key] ?? []) out.add(keyOf(s));
  return out;
}

/** Every field a sheet of this entity can map to, template keys first. */
export function targetsFor(entity: ImportEntity): { key: string; label: string; required: boolean; virtual: boolean; description: string }[] {
  const real = COLUMNS[entity].map((c) => ({ key: c.key, label: c.key, required: !!c.required, virtual: false, description: c.description }));
  const virtual = (Object.keys(VIRTUAL_KEYS) as VirtualKey[]).filter((k) => (VIRTUAL_KEYS[k].entities as readonly ImportEntity[]).includes(entity)).map((k) => ({ key: k, label: VIRTUAL_KEYS[k].label, required: false, virtual: true, description: VIRTUAL_KEYS[k].description }));
  return [...real, ...virtual];
}

function matchHeader(entity: ImportEntity, header: string): string | null {
  const h = keyOf(header);
  if (!h) return null;
  const targets = targetsFor(entity);
  // Exact key or exact synonym first.
  for (const t of targets) if (synonymsFor(entity, t.key).has(h)) return t.key;
  // Then "contains" on multi-word synonyms (e.g. "tenant mobile number" ⊇ "mobile number"),
  // scored by how much of the longer string the shorter one covers.
  let best: { key: string; score: number } | null = null;
  for (const t of targets) {
    for (const s of synonymsFor(entity, t.key)) {
      if (s.length < 4 || h.length < 3) continue;
      const score = h.includes(s) ? s.length / h.length : s.includes(h) ? h.length / s.length : 0;
      if (score >= 0.4 && (!best || score > best.score)) best = { key: t.key, score };
    }
  }
  return best?.key ?? null;
}

export function autoMapColumns(entity: ImportEntity, headers: string[]): ColumnMap[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    let target = matchHeader(entity, header);
    if (target && used.has(target)) target = null;
    if (target) used.add(target);
    return { header, index, target };
  });
}

function scoreEntity(entity: ImportEntity, sheet: SheetScan): { name: boolean; score: number } {
  const n = keyOf(sheet.name);
  const name = n === keyOf(SHEET_NAMES[entity]) || ENTITY_NAMES[entity].some((x) => keyOf(x) === n);
  const cols = autoMapColumns(entity, sheet.headers);
  const required = new Set(COLUMNS[entity].filter((c) => c.required).map((c) => c.key));
  let hits = 0;
  for (const c of cols) if (c.target) hits += required.has(c.target) ? 2 : 1;
  const score = sheet.headers.length > 0 ? hits / (sheet.headers.length + required.size) : 0;
  return { name, score };
}

export function detectEntity(sheet: SheetScan): { entity: ImportEntity | null; how: SheetMapping["detected"] } {
  const n = keyOf(sheet.name);
  if (n === keyOf(PAYMENTS_SHEET)) return { entity: null, how: "none" };
  let best: { entity: ImportEntity; score: number } | null = null;
  for (const entity of IMPORT_ORDER) {
    const { name, score } = scoreEntity(entity, sheet);
    if (name && score > 0) return { entity, how: "name" };
    if (!best || score > best.score) best = { entity, score };
  }
  return best && best.score >= 0.34 ? { entity: best.entity, how: "headers" } : { entity: null, how: "none" };
}

export function suggestMappings(scan: WorkbookScan): SheetMapping[] {
  const presets = loadPresets();
  return scan.sheets.map((sheet) => {
    const preset = presets[presetSignature(sheet.headers)];
    if (preset) {
      return { sheet: sheet.name, entity: preset.entity, columns: sheet.headers.map((header, index) => ({ header, index, target: preset.targets[keyOf(header)] ?? null })), detected: "preset" };
    }
    const { entity, how } = detectEntity(sheet);
    return { sheet: sheet.name, entity, columns: entity ? autoMapColumns(entity, sheet.headers) : sheet.headers.map((header, index) => ({ header, index, target: null })), detected: how };
  });
}

export function remapSheet(sheet: SheetScan, mapping: SheetMapping, entity: ImportEntity | null): SheetMapping {
  return { ...mapping, entity, columns: entity ? autoMapColumns(entity, sheet.headers) : mapping.columns.map((c) => ({ ...c, target: null })), detected: "manual" };
}

/* -------------------------------- Presets -------------------------------- */

const PRESET_KEY = "rental.import.presets.v1";

interface Preset {
  entity: ImportEntity | null;
  targets: Record<string, string | null>;
}

export function presetSignature(headers: string[]): string {
  return headers.map(keyOf).filter(Boolean).sort().join("|");
}

function loadPresets(): Record<string, Preset> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(PRESET_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Preset>) : {};
  } catch {
    return {};
  }
}

/** Remember how this file's tabs were mapped so the next file with the same headers maps itself. */
export function rememberMappings(scan: WorkbookScan, mappings: SheetMapping[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const presets = loadPresets();
    for (const m of mappings) {
      const sheet = scan.sheets.find((s) => s.name === m.sheet);
      if (!sheet || !m.entity) continue;
      presets[presetSignature(sheet.headers)] = { entity: m.entity, targets: Object.fromEntries(m.columns.map((c) => [keyOf(c.header), c.target])) };
    }
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  } catch {
    /* storage unavailable — mapping still works, it just is not remembered */
  }
}

export function forgetPresets(): void {
  try {
    localStorage.removeItem(PRESET_KEY);
  } catch {
    /* ignore */
  }
}

/* ----------------------------- Mapping health ----------------------------- */

export interface MappingIssue {
  sheet: string;
  level: "error" | "warning";
  message: string;
}

/** Required template keys that are neither mapped nor derivable from what is mapped. */
export function mappingIssues(mappings: SheetMapping[]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const entitiesInFile = new Set(mappings.map((m) => m.entity).filter(Boolean));
  for (const m of mappings) {
    if (!m.entity) {
      if (keyOf(m.sheet) !== keyOf(PAYMENTS_SHEET)) issues.push({ sheet: m.sheet, level: "warning", message: "Not matched to anything — choose what this tab contains, or leave it to skip it." });
      continue;
    }
    const mapped = new Set(m.columns.map((c) => c.target).filter(Boolean) as string[]);
    if (mapped.size === 0) {
      issues.push({ sheet: m.sheet, level: "error", message: "No column is mapped." });
      continue;
    }
    for (const c of COLUMNS[m.entity]) {
      if (!c.required || mapped.has(c.key)) continue;
      const derivable =
        (c.key === "property_code" && (mapped.has("property_name") || mapped.has("unit_ref") || (m.entity === "properties" && mapped.has("name")))) ||
        (c.key === "unit_number" && mapped.has("unit_ref")) ||
        (c.key === "name" && m.entity === "properties" && mapped.has("property_code")) ||
        (c.key === "name" && m.entity === "suppliers" && mapped.has("company")) ||
        (c.key === "floors" && m.entity === "properties" && (entitiesInFile.has("units") || mapped.has("total_units"))) ||
        (c.key === "units_per_floor" && m.entity === "properties" && (entitiesInFile.has("units") || mapped.has("total_units"))) ||
        (c.key === "floor" && m.entity === "units" && (mapped.has("unit_number") || mapped.has("unit_ref"))) ||
        ((c.key === "first_name" || c.key === "last_name") && mapped.has("full_name")) ||
        (c.key === "phone" && m.entity === "tenants" && mapped.has("id_number")) ||
        (c.key === "tenant_phone" && mapped.has("tenant_name")) ||
        (c.key === "contract_number" && m.entity === "contracts") ||
        (c.key === "end_date" && mapped.has("duration_months")) ||
        (c.key === "number" && m.entity === "workorders") ||
        (c.key === "reported_at" && m.entity === "workorders") ||
        (c.key === "title" && m.entity === "workorders" && mapped.has("description"));
      if (!derivable) issues.push({ sheet: m.sheet, level: "error", message: `Required field ${c.key} is not mapped.` });
    }
  }
  return issues;
}

/* ------------------------------ Value clean-up ----------------------------- */

const YES = new Set(["yes", "y", "true", "1", "x", "✓", "✔", "ok", "furnished", "نعم", "اي", "ايه", "مفروش", "مفروشه", "صح"]);
const NO = new Set(["no", "n", "false", "0", "-", "—", "none", "unfurnished", "لا", "كلا", "غير مفروش", "غير مفروشه"]);

const ENUM_SYNONYMS: Record<string, string[]> = {
  cash: ["cash", "نقدي", "نقدا", "كاش", "نقد"],
  bank_transfer: ["bank transfer", "transfer", "bank", "wire", "omt", "whish", "تحويل", "تحويل بنكي", "حواله", "بنك"],
  cheque: ["cheque", "check", "chq", "شيك"],
  card: ["card", "credit card", "visa", "mastercard", "بطاقه", "بطاقة", "فيزا"],
  monthly: ["monthly", "month", "per month", "m", "شهري", "شهريا", "كل شهر"],
  quarterly: ["quarterly", "quarter", "3 months", "every 3 months", "q", "ربع سنوي", "كل 3 اشهر", "فصلي"],
  semi_annual: ["semi annual", "semiannual", "half yearly", "6 months", "every 6 months", "biannual", "نصف سنوي", "كل 6 اشهر"],
  annual: ["annual", "yearly", "annually", "year", "12 months", "سنوي", "سنويا", "كل سنه"],
  residential: ["residential", "housing", "apartments", "سكني", "سكنيه"],
  commercial: ["commercial", "offices", "retail", "تجاري", "تجاريه"],
  mixed_use: ["mixed", "mixed use", "mixed-use", "residential commercial", "مختلط"],
  active: ["active", "current", "running", "live", "open", "ongoing", "ساري", "فعال", "نشط", "جاري", "قائم"],
  expired: ["expired", "ended", "finished", "closed", "complete", "منتهي", "انتهى", "منتهيه"],
  terminated: ["terminated", "cancelled", "canceled", "broken", "ملغي", "ملغى", "فسخ", "مفسوخ"],
  renewed: ["renewed", "مجدد", "تم التجديد"],
  notice_given: ["notice", "notice given", "leaving", "moving out", "vacating", "اشعار", "مغادر", "طالع"],
  under_renovation: ["renovation", "under renovation", "renovating", "قيد التجديد", "تحت التجديد", "ترميم"],
  sold: ["sold", "مباع", "بيع"],
  national_id: ["national id", "id", "id card", "identity", "identity card", "هويه", "بطاقه هويه", "الهويه"],
  passport: ["passport", "جواز", "جواز سفر"],
  residency_permit: ["residency", "residence permit", "residency permit", "iqama", "اقامه"],
  good: ["good", "fine", "ok", "normal", "جيد", "جيده", "ممتاز"],
  fair: ["fair", "average", "acceptable", "مقبول", "متوسط"],
  needs_work: ["needs work", "needs repair", "work needed", "repair", "بحاجه صيانه", "يحتاج صيانه"],
  poor: ["poor", "bad", "damaged", "سيء", "سيئه", "متضرر"],
  maintenance: ["maintenance", "under maintenance", "صيانه", "تحت الصيانه"],
  reserved: ["reserved", "booked", "held", "محجوز", "محجوزه"],
  unavailable: ["unavailable", "blocked", "not available", "غير متاح", "غير متاحه", "مغلق"],
  paid: ["paid", "settled", "done", "مدفوع", "مدفوعه", "تم الدفع"],
  unpaid: ["unpaid", "open", "pending", "due", "outstanding", "غير مدفوع", "مستحق", "لم يدفع"],
  operating: ["operating", "opex", "operational", "running", "تشغيلي", "تشغيليه"],
  capex: ["capex", "capital", "investment", "improvement", "رأسمالي", "استثمار"],
  yes: [],
};

function cleanEnum(spec: ColumnSpec, raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const values = spec.values ?? [];
  const s = keyOf(raw);
  if (!s) return raw;
  for (const v of values) if (keyOf(v) === s || keyOf(v.replace(/_/g, " ")) === s) return v;
  for (const v of values) for (const syn of ENUM_SYNONYMS[v] ?? []) if (keyOf(syn) === s) return v;
  for (const v of values) {
    const k = keyOf(v.replace(/_/g, " "));
    if (k.length >= 4 && (s.includes(k) || k.includes(s))) return v;
    for (const syn of ENUM_SYNONYMS[v] ?? []) {
      const sk = keyOf(syn);
      if (sk.length >= 4 && (s.includes(sk) || sk.includes(s))) return v;
    }
  }
  return raw;
}

export function cleanNumber(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (!/\d/.test(s)) return raw;
  // First numeric run only — "150 m2" is 150, "USD 950" is 950, "1 200" keeps its grouped thousands.
  const run = /-?−?\d[\d.,]*(?:\s\d{3}(?![\d.,]))*/.exec(s);
  if (!run) return raw;
  let t = run[0].replace(/\s/g, "").replace("−", "-");
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Both present: the later one is the decimal separator.
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Only commas: "1,200" thousands vs "1200,50" decimal.
    t = /,\d{1,2}$/.test(t) && (t.match(/,/g) ?? []).length === 1 ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (lastDot > -1 && /\.\d{3}$/.test(t) && (t.match(/\./g) ?? []).length >= 1 && !/\.\d{3}\.\d/.test(t) && /^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : raw;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function cleanDate(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw instanceof Date || typeof raw === "number") return raw;
  const s = String(raw).trim();
  if (!s || isISODate(s)) return raw;
  if (resolveDateValue(s).ok) return raw;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  let m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?[\s,-]+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[2].slice(0, 4).toLowerCase()] !== undefined) return `${m[3]}-${pad(MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`;
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return `${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`;
  m = /^([a-z]+)\.?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return `${m[2]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-01`;
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return raw;
}

function cleanValue(spec: ColumnSpec | undefined, raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (!spec) return raw;
  switch (spec.type) {
    case "int":
    case "number":
      return cleanNumber(raw);
    case "bool": {
      if (typeof raw === "boolean") return raw ? "yes" : "no";
      const s = keyOf(raw);
      if (YES.has(s) || YES.has(String(raw).trim().toLowerCase())) return "yes";
      if (NO.has(s) || NO.has(String(raw).trim().toLowerCase())) return "no";
      return raw;
    }
    case "date":
      return cleanDate(raw);
    case "enum":
      return cleanEnum(spec, raw);
    default:
      return typeof raw === "number" && spec.key.endsWith("number") ? String(raw) : raw;
  }
}

/* ------------------------------- Derivation ------------------------------- */

export interface BuildResult {
  parsed: ParsedWorkbook;
  /** Human notes about what was derived or could not be resolved. */
  notes: string[];
}

const initials = (name: string) => {
  const words = name.replace(/[^A-Za-z0-9ء-ي ]/g, " ").split(/\s+/).filter(Boolean);
  const code = (words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 3) : (words[0] ?? "BLD").slice(0, 3)).toUpperCase();
  return code || "BLD";
};

function splitUnitRef(v: unknown): { building: string; unit: string } | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(.+?)\s*[-/–|:,]\s*([a-z]?\d{1,4}[a-z]?)$/i.exec(s);
  if (m) return { building: m[1].trim(), unit: m[2] };
  m = /^(.+?)\s+([a-z]?\d{1,4}[a-z]?)$/i.exec(s);
  if (m) return { building: m[1].trim(), unit: m[2] };
  return null;
}

function floorFromUnit(unitNumber: string): number | null {
  const digits = unitNumber.replace(/\D/g, "");
  if (digits.length >= 3) return Number(digits.slice(0, -2));
  if (/^(g|gf|rdc|ground)/i.test(unitNumber)) return 0;
  return null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const nameKey = (s: string) => keyOf(s).replace(/_/g, " ");

/** Rebuild the user's tabs into the template shape, deriving what the template needs. */
export function buildParsedWorkbook(scan: WorkbookScan, mappings: SheetMapping[], store: Store): BuildResult {
  const notes: string[] = [];
  const sheets = Object.fromEntries(IMPORT_ORDER.map((e) => [e, { present: false, headers: [], rows: [] } as ParsedSheet])) as Record<ImportEntity, ParsedSheet>;
  const unknownSheets: string[] = [];
  let hasPaymentsSheet = false;

  // Building name → code, from the store first, then the file, then generated.
  const codeByName = new Map<string, string>();
  const takenCodes = new Set(store.properties.map((p) => p.code.toUpperCase()));
  for (const p of store.properties) codeByName.set(nameKey(p.name), p.code.toUpperCase());
  const nameByCode = new Map<string, string>();
  for (const p of store.properties) nameByCode.set(p.code.toUpperCase(), p.name);
  const codeFor = (name: string): string => {
    const k = nameKey(name);
    const hit = codeByName.get(k);
    if (hit) return hit;
    // Maybe the "name" is already a code.
    if (takenCodes.has(name.trim().toUpperCase())) return name.trim().toUpperCase();
    let code = initials(name);
    let n = 2;
    while (takenCodes.has(code)) code = `${initials(name)}${n++}`;
    takenCodes.add(code);
    codeByName.set(k, code);
    nameByCode.set(code, name.trim());
    return code;
  };

  // Tenant name → phone, from the store first, then the file.
  const phoneByName = new Map<string, string>();
  for (const t of store.tenants) if (t.phone) phoneByName.set(nameKey(t.fullName), t.phone);
  const lastNameOnly = new Map<string, string[]>();
  for (const t of store.tenants) if (t.phone) lastNameOnly.set(nameKey(t.lastName), [...(lastNameOnly.get(nameKey(t.lastName)) ?? []), t.phone]);

  type Pending = { entity: ImportEntity; sheet: string; rowNumber: number; values: Record<string, unknown>; virtual: Record<string, unknown> };
  const pending: Pending[] = [];

  for (const m of mappings) {
    const sheet = scan.sheets.find((s) => s.name === m.sheet);
    if (!sheet) continue;
    if (!m.entity) {
      if (keyOf(sheet.name) === keyOf(PAYMENTS_SHEET)) hasPaymentsSheet = true;
      else unknownSheets.push(sheet.name);
      continue;
    }
    const specs = new Map(COLUMNS[m.entity].map((c) => [c.key, c]));
    sheets[m.entity].present = true;
    for (const c of m.columns) if (c.target && !sheets[m.entity].headers.includes(c.target) && specs.has(c.target)) sheets[m.entity].headers.push(c.target);
    sheet.rows.forEach((line, i) => {
      const values: Record<string, unknown> = {};
      const virtual: Record<string, unknown> = {};
      for (const c of m.columns) {
        if (!c.target) continue;
        const raw = line[c.index];
        if (c.target in VIRTUAL_KEYS) virtual[c.target] = raw;
        else values[c.target] = cleanValue(specs.get(c.target), raw);
      }
      if (Object.values(values).every((v) => v === null || v === undefined) && Object.values(virtual).every((v) => v === null || v === undefined || String(v).trim() === "")) return;
      pending.push({ entity: m.entity!, sheet: sheet.name, rowNumber: sheet.headerRow + i + 1, values, virtual });
    });
  }

  // Pass 1 — buildings: codes, names, and what the units tab tells us about floors.
  const propertyRows = pending.filter((p) => p.entity === "properties");
  for (const p of propertyRows) {
    const name = p.values.name != null ? String(p.values.name) : p.virtual.property_name != null ? String(p.virtual.property_name) : "";
    if (!p.values.name && name) p.values.name = name;
    if (!p.values.property_code && name) p.values.property_code = codeFor(name);
    if (p.values.property_code) {
      const code = String(p.values.property_code).toUpperCase();
      p.values.property_code = code;
      takenCodes.add(code);
      if (name) codeByName.set(nameKey(name), code);
      if (!p.values.name) p.values.name = nameByCode.get(code) ?? code;
    }
  }

  // Units and everything with a building reference.
  const unitsByCode = new Map<string, { unit: string; floor: number | null }[]>();
  for (const p of pending) {
    if (p.entity === "properties") continue;
    if (p.virtual.unit_ref != null && String(p.virtual.unit_ref).trim()) {
      const split = splitUnitRef(p.virtual.unit_ref);
      if (split) {
        if (!p.values.property_code && !p.virtual.property_name) p.virtual.property_name = split.building;
        if (!p.values.unit_number) p.values.unit_number = split.unit;
      } else if (!p.values.unit_number) p.values.unit_number = String(p.virtual.unit_ref).trim();
    }
    if (!p.values.property_code && p.virtual.property_name != null && String(p.virtual.property_name).trim()) {
      p.values.property_code = codeFor(String(p.virtual.property_name));
    } else if (p.values.property_code) {
      const raw = String(p.values.property_code).trim();
      // A "code" column holding full names is common in old files.
      p.values.property_code = codeByName.get(nameKey(raw)) ?? (takenCodes.has(raw.toUpperCase()) ? raw.toUpperCase() : raw.length > 6 ? codeFor(raw) : raw.toUpperCase());
    }
    if (p.entity === "units") {
      const unit = p.values.unit_number != null ? String(p.values.unit_number).trim() : "";
      if (unit) p.values.unit_number = unit;
      if (unit && (p.values.floor === null || p.values.floor === undefined)) {
        const f = floorFromUnit(unit);
        if (f !== null) p.values.floor = f;
      }
      const code = p.values.property_code ? String(p.values.property_code) : "";
      if (code && unit) unitsByCode.set(code, [...(unitsByCode.get(code) ?? []), { unit, floor: typeof p.values.floor === "number" ? p.values.floor : null }]);
    }
  }

  // Buildings that only appear through their units (or contracts) get a row of their own.
  const knownCodes = new Set([...store.properties.map((p) => p.code.toUpperCase()), ...propertyRows.map((p) => String(p.values.property_code ?? ""))]);
  const synthesised: string[] = [];
  for (const p of pending) {
    const code = p.values.property_code ? String(p.values.property_code) : "";
    if (!code || knownCodes.has(code)) continue;
    knownCodes.add(code);
    synthesised.push(code);
    const name = nameByCode.get(code) ?? code;
    propertyRows.push({ entity: "properties", sheet: p.sheet, rowNumber: 0, values: { property_code: code, name }, virtual: {} });
    pending.push(propertyRows[propertyRows.length - 1]);
    sheets.properties.present = true;
    for (const k of ["property_code", "name", "floors", "units_per_floor"]) if (!sheets.properties.headers.includes(k)) sheets.properties.headers.push(k);
  }
  if (synthesised.length > 0) notes.push(`Created building${synthesised.length === 1 ? "" : "s"} ${synthesised.map((c) => nameByCode.get(c) ?? c).join(", ")} from the units and contracts that mention ${synthesised.length === 1 ? "it" : "them"} — layout details can be edited afterwards.`);

  // Floors / units per floor from the units tab or a total-units column.
  for (const p of propertyRows) {
    const code = String(p.values.property_code ?? "");
    const units = unitsByCode.get(code) ?? [];
    const floors = typeof p.values.floors === "number" ? p.values.floors : null;
    const perFloor = typeof p.values.units_per_floor === "number" ? p.values.units_per_floor : null;
    const total = typeof cleanNumber(p.virtual.total_units) === "number" ? (cleanNumber(p.virtual.total_units) as number) : null;
    if (floors === null) {
      const maxFloor = units.reduce((n, u) => Math.max(n, u.floor ?? 0), 0);
      p.values.floors = units.length > 0 ? Math.max(1, maxFloor) : 1;
      if (units.length > 0 || total !== null) notes.push(`${p.values.name}: floors set to ${p.values.floors} from the units listed.`);
    }
    if (perFloor === null) {
      const f = Number(p.values.floors) || 1;
      if (units.length > 0) {
        const perFloorCounts = new Map<number, number>();
        for (const u of units) perFloorCounts.set(u.floor ?? 0, (perFloorCounts.get(u.floor ?? 0) ?? 0) + 1);
        p.values.units_per_floor = Math.max(1, ...perFloorCounts.values());
      } else if (total !== null) p.values.units_per_floor = Math.max(1, Math.ceil(total / f));
      else p.values.units_per_floor = 1;
    }
    for (const k of ["floors", "units_per_floor"]) if (!sheets.properties.headers.includes(k)) sheets.properties.headers.push(k);
  }

  // Pass 2 — tenants: split names, register phones by name.
  for (const p of pending.filter((x) => x.entity === "tenants")) {
    if (p.virtual.full_name != null && String(p.virtual.full_name).trim()) {
      const { first, last } = splitName(String(p.virtual.full_name));
      if (!p.values.first_name) p.values.first_name = first;
      if (!p.values.last_name) p.values.last_name = last;
    }
    const full = `${p.values.first_name ?? ""} ${p.values.last_name ?? ""}`.trim();
    const phone = p.values.phone != null ? String(p.values.phone).trim() : "";
    if (phone && typeof p.values.phone === "number") p.values.phone = phone;
    if (full && phone) phoneByName.set(nameKey(full), phone);
    if (full && phone) lastNameOnly.set(nameKey(String(p.values.last_name ?? "")), [...(lastNameOnly.get(nameKey(String(p.values.last_name ?? ""))) ?? []), phone]);
    for (const k of ["first_name", "last_name"]) if (!sheets.tenants.headers.includes(k)) sheets.tenants.headers.push(k);
  }

  // Pass 3 — everything that names a tenant, and the contract-specific derivations.
  const unresolvedTenants = new Set<string>();
  const contractSeq = new Map<string, number>();
  let tenantsByName = 0;
  let endDates = 0;
  let contractNumbers = 0;
  for (const p of pending) {
    if (p.virtual.tenant_name != null && String(p.virtual.tenant_name).trim() && !p.values.tenant_phone) {
      const name = String(p.virtual.tenant_name).trim();
      const k = nameKey(name);
      let phone = phoneByName.get(k) ?? null;
      if (!phone) {
        const { last } = splitName(name);
        const byLast = lastNameOnly.get(nameKey(last)) ?? [];
        if (byLast.length === 1) phone = byLast[0];
        else if (!phone) {
          // Loose match: every word of the shorter name appears in the longer one.
          for (const [full, ph] of phoneByName) {
            const a = k.split(" ").filter(Boolean);
            const b = full.split(" ").filter(Boolean);
            const [short, long] = a.length <= b.length ? [a, b] : [b, a];
            if (short.length > 0 && short.every((w) => long.includes(w))) {
              phone = ph;
              break;
            }
          }
        }
      }
      if (phone) {
        p.values.tenant_phone = phone;
        tenantsByName++;
      } else unresolvedTenants.add(name);
      if (!sheets[p.entity].headers.includes("tenant_phone")) sheets[p.entity].headers.push("tenant_phone");
    }
    if (typeof p.values.tenant_phone === "number") p.values.tenant_phone = String(p.values.tenant_phone);
    if (p.entity === "contracts") {
      const startRes = resolveDateValue(p.values.start_date);
      const start = startRes.ok ? startRes.value : null;
      const months = cleanNumber(p.virtual.duration_months);
      if (!p.values.end_date && start && typeof months === "number" && months > 0) {
        p.values.end_date = addDaysISO(addMonthsISO(start, Math.round(months)), -1);
        endDates++;
        if (!sheets.contracts.headers.includes("end_date")) sheets.contracts.headers.push("end_date");
      }
      if (!p.values.contract_number) {
        const code = String(p.values.property_code ?? "X");
        const unit = String(p.values.unit_number ?? "").replace(/\s+/g, "");
        const stamp = start ? start.slice(0, 7).replace("-", "") : "";
        const base = `${code}-${unit}${stamp ? `-${stamp}` : ""}`;
        const n = (contractSeq.get(base) ?? 0) + 1;
        contractSeq.set(base, n);
        p.values.contract_number = n === 1 ? base : `${base}-${n}`;
        contractNumbers++;
        if (!sheets.contracts.headers.includes("contract_number")) sheets.contracts.headers.push("contract_number");
      }
      if (p.values.unit_number != null) p.values.unit_number = String(p.values.unit_number).trim();
    }
    if (p.entity === "suppliers") {
      // A vendor list often has only the company; use it as the name (and keep it as the company too).
      if (!p.values.name && p.values.company) p.values.name = p.values.company;
      if (!p.values.category && p.values.services) {
        const guess = cleanEnum(COLUMNS.suppliers.find((c) => c.key === "category")!, p.values.services);
        if (typeof guess === "string" && (COLUMNS.suppliers.find((c) => c.key === "category")!.values ?? []).includes(guess)) p.values.category = guess;
      }
      for (const k of ["name", "category"]) if (!sheets.suppliers.headers.includes(k)) sheets.suppliers.headers.push(k);
    }
    if (p.entity === "workorders") {
      if (!p.values.number) {
        const n = (contractSeq.get("WO") ?? 0) + 1;
        contractSeq.set("WO", n);
        p.values.number = `WO-IMP-${String(n).padStart(3, "0")}`;
        if (!sheets.workorders.headers.includes("number")) sheets.workorders.headers.push("number");
      }
      if (!p.values.title && p.values.description) p.values.title = String(p.values.description).slice(0, 80);
      if (!p.values.reported_at) p.values.reported_at = "today";
      for (const k of ["title", "reported_at"]) if (!sheets.workorders.headers.includes(k)) sheets.workorders.headers.push(k);
    }
    if (p.values.unit_number != null && typeof p.values.unit_number === "number") p.values.unit_number = String(p.values.unit_number);
    if (p.values.phone != null && typeof p.values.phone === "number") p.values.phone = String(p.values.phone);
  }
  const generatedCodes = [...codeByName.entries()].filter(([, code]) => !store.properties.some((pr) => pr.code.toUpperCase() === code)).map(([, code]) => `${nameByCode.get(code) ?? code} → ${code}`);
  if (generatedCodes.length > 0) notes.push(`Building code${generatedCodes.length === 1 ? "" : "s"} generated from the name${generatedCodes.length === 1 ? "" : "s"}: ${generatedCodes.join(", ")}.`);
  if (tenantsByName > 0) notes.push(`${tenantsByName} row${tenantsByName === 1 ? "" : "s"} matched the tenant by name.`);
  if (contractNumbers > 0) notes.push(`${contractNumbers} contract number${contractNumbers === 1 ? "" : "s"} generated (building-unit-start month).`);
  if (endDates > 0) notes.push(`${endDates} end date${endDates === 1 ? "" : "s"} worked out from start date + duration.`);
  if (unresolvedTenants.size > 0) {
    const list = [...unresolvedTenants];
    notes.push(`${list.length} tenant name${list.length === 1 ? "" : "s"} could not be matched to a phone number (${list.slice(0, 5).join(", ")}${list.length > 5 ? "…" : ""}) — add them to a Tenants tab with a phone, or map a phone column.`);
  }
  if (hasPaymentsSheet) notes.push("A payments tab was found — payment history is generated from contracts, so it is not imported.");

  for (const p of pending) {
    const row: RawRow = { entity: p.entity, rowNumber: p.rowNumber, values: p.values };
    sheets[p.entity].rows.push(row);
  }

  const parsed: ParsedWorkbook = { fileName: scan.fileName, sheets, hasPaymentsSheet, unknownSheets };
  return { parsed, notes };
}

/** True when the workbook is a plain template file — every tab matched by name and every column by key. */
export function isTemplateShaped(scan: WorkbookScan, mappings: SheetMapping[]): boolean {
  return mappings.every((m) => {
    if (!m.entity) return keyOf(m.sheet) === keyOf(PAYMENTS_SHEET);
    if (m.detected !== "name") return false;
    return m.columns.every((c) => c.target === null || keyOf(c.header) === keyOf(c.target));
  });
}
