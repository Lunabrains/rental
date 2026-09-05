import { indexStore } from "@/lib/data/store";
import { today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import type { DocumentCategory, ID, ISODate, StoredDocument, Store } from "@/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type ExtractedKey =
  | "amount"
  | "date"
  | "dueDate"
  | "invoiceNumber"
  | "supplierName"
  | "tenantName"
  | "propertyName"
  | "unitNumber"
  | "rent"
  | "deposit"
  | "startDate"
  | "endDate"
  | "paymentFrequency"
  | "increaseClause"
  | "specialTerms"
  | "issuedDate"
  | "expiryDate"
  | "assetName"
  | "reference";

export interface ExtractedField {
  key: ExtractedKey;
  label: string;
  value: string;
  /** 0–1. Below 0.6 the review screen shows it as a guess. */
  confidence: number;
  evidence?: string;
}

export interface ExtractedLinks {
  tenantId?: ID;
  contractId?: ID;
  propertyId?: ID;
  unitId?: ID;
  supplierId?: ID;
  assetId?: ID;
}

export interface DocumentExtraction {
  docType: DocumentCategory;
  typeConfidence: number;
  fields: ExtractedField[];
  links: ExtractedLinks;
  linkConfidence: Partial<Record<keyof ExtractedLinks, number>>;
  source: "rules" | "model";
  model?: string;
  notes: string[];
}

export const FIELD_LABELS: Record<ExtractedKey, string> = {
  amount: "Amount",
  date: "Date",
  dueDate: "Due date",
  invoiceNumber: "Invoice / reference",
  supplierName: "Supplier",
  tenantName: "Tenant",
  propertyName: "Building",
  unitNumber: "Unit",
  rent: "Monthly rent",
  deposit: "Deposit",
  startDate: "Start date",
  endDate: "End date",
  paymentFrequency: "Payment schedule",
  increaseClause: "Increase clause",
  specialTerms: "Special terms",
  issuedDate: "Issued",
  expiryDate: "Expiry",
  assetName: "Asset",
  reference: "Reference",
};

/* -------------------------------------------------------------------------- */
/* Rule-based extraction (works offline, on the file name, title and any text) */
/* -------------------------------------------------------------------------- */

const TYPE_RULES: { type: DocumentCategory; re: RegExp; confidence: number }[] = [
  { type: "invoice", re: /\b(invoice|inv|bill|facture|فاتورة)\b/i, confidence: 0.85 },
  { type: "receipt", re: /\b(receipt|paid|voucher|إيصال)\b/i, confidence: 0.85 },
  { type: "quotation", re: /\b(quote|quotation|estimate|proposal|عرض)\b/i, confidence: 0.85 },
  { type: "lease", re: /\b(lease|contract|tenancy|agreement|rental|عقد)\b/i, confidence: 0.85 },
  { type: "tenant_id", re: /\b(passport|id|identity|idcard|national|residency|هوية|جواز)\b/i, confidence: 0.8 },
  { type: "insurance", re: /\b(policy|insurance|cover|تأمين)\b/i, confidence: 0.85 },
  { type: "certificate", re: /\b(certificate|cert|permit|licen[cs]e|approval|شهادة)\b/i, confidence: 0.8 },
  { type: "warranty", re: /\b(warranty|guarantee|كفالة)\b/i, confidence: 0.85 },
  { type: "inspection", re: /\b(inspection|checklist|condition report|walkthrough|معاينة)\b/i, confidence: 0.8 },
  { type: "maintenance_report", re: /\b(service report|maintenance report|work report|job sheet)\b/i, confidence: 0.75 },
  { type: "ownership", re: /\b(deed|title|ownership|سند)\b/i, confidence: 0.8 },
  { type: "municipality", re: /\b(municipality|baladiya|tax|بلدية)\b/i, confidence: 0.8 },
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

function isoFrom(y: string, m: string, d: string): ISODate | null {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (yy < 2000 || yy > 2100 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Every date we can read: 2026-08-12, 12-08-2026, 12/08/2026, 12 Aug 2026. */
export function findDates(text: string): ISODate[] {
  const out: ISODate[] = [];
  // Underscores count as word characters, so file names need explicit edges instead of \b.
  for (const m of text.matchAll(/(?<![0-9A-Za-z])(20\d{2})[-_./](\d{1,2})[-_./](\d{1,2})(?![0-9A-Za-z])/g)) {
    const d = isoFrom(m[1], m[2], m[3]);
    if (d) out.push(d);
  }
  for (const m of text.matchAll(/(?<![0-9A-Za-z])(\d{1,2})[-_./](\d{1,2})[-_./](20\d{2})(?![0-9A-Za-z])/g)) {
    const d = isoFrom(m[3], m[2], m[1]);
    if (d) out.push(d);
  }
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/gi)) {
    const d = isoFrom(m[3], String(months[m[2].toLowerCase().slice(0, 4)] ?? months[m[2].toLowerCase().slice(0, 3)]), m[1]);
    if (d) out.push(d);
  }
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/gi)) {
    const d = isoFrom(m[3], String(months[m[1].toLowerCase().slice(0, 4)] ?? months[m[1].toLowerCase().slice(0, 3)]), m[2]);
    if (d) out.push(d);
  }
  return [...new Set(out)];
}

/** Money: "$1,250.00", "1250 USD", "600usd", "Total: 1,450". Returns the largest plausible figure. */
export function findAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:usd|\$|us\$)\s*([\d,]+(?:\.\d{1,2})?)/gi)) out.push(Number(m[1].replace(/,/g, "")));
  for (const m of text.matchAll(/([\d,]+(?:\.\d{1,2})?)\s*(?:usd|\$|dollars?)/gi)) out.push(Number(m[1].replace(/,/g, "")));
  for (const m of text.matchAll(/\b(?:total|amount(?: due)?|balance|rent|deposit|price)\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/gi)) out.push(Number(m[1].replace(/,/g, "")));
  return [...new Set(out.filter((n) => Number.isFinite(n) && n > 0))];
}

export function findReference(text: string): string | null {
  // "INV-2041", "POL-88213-A" — the usual shape, wherever it sits in a file name.
  const bare = text.match(/(?<![A-Za-z0-9])([A-Z]{2,5}-\d{3,}(?:-[A-Z0-9]{1,3})?)(?![A-Za-z0-9])/);
  if (bare) return bare[1];
  const m = text.match(/(?<![a-z])(?:inv(?:oice)?|ref(?:erence)?|no|nr|number|#|receipt|quote|policy)[\s\-_:#.]*([a-z]{0,4}-?\d{3,}(?:[a-z]{1,2})?)(?![a-z0-9])/i);
  return m ? m[1].toUpperCase() : null;
}

function matchName(haystackTokens: string[], name: string): number {
  const parts = tokens(name).filter((t) => t.length > 2);
  if (parts.length === 0) return 0;
  const hits = parts.filter((p) => haystackTokens.includes(p)).length;
  if (hits === parts.length) return 0.9;
  if (hits >= 2 || (parts.length === 1 && hits === 1)) return 0.7;
  if (hits === 1 && parts[0].length >= 5 && haystackTokens.includes(parts[0])) return 0.5;
  return 0;
}

/**
 * Best-effort reading of the file name, title and any plain text. Never
 * touches the network; confidence is honest so the review screen can show
 * what is a guess.
 */
export function extractByRules(store: Store, doc: Pick<StoredDocument, "fileName" | "title" | "category" | "mimeType"> & Partial<Pick<StoredDocument, "tenantId" | "contractId" | "propertyId" | "unitId" | "supplierId" | "assetId">>, text: string | null = null): DocumentExtraction {
  const idx = indexStore(store);
  const haystack = `${doc.fileName} ${doc.title} ${text ?? ""}`;
  const hayTokens = tokens(haystack);
  const notes: string[] = [];
  const fields: ExtractedField[] = [];
  const links: ExtractedLinks = {};
  const linkConfidence: DocumentExtraction["linkConfidence"] = {};

  /* Type */
  let docType: DocumentCategory = doc.category && doc.category !== "other" ? doc.category : "other";
  let typeConfidence = doc.category && doc.category !== "other" ? 0.5 : 0.2;
  for (const r of TYPE_RULES) {
    if (r.re.test(doc.fileName) || r.re.test(doc.title) || (text !== null && r.re.test(text.slice(0, 400)))) {
      docType = r.type;
      typeConfidence = r.confidence;
      break;
    }
  }
  if (docType === "other" && doc.mimeType.startsWith("image/")) {
    docType = "photo";
    typeConfidence = 0.6;
  }

  /* Existing links carry through with high confidence. */
  const seed = (key: keyof ExtractedLinks, id: ID | null | undefined, c = 0.95) => {
    if (id) {
      links[key] = id;
      linkConfidence[key] = c;
    }
  };
  seed("tenantId", doc.tenantId);
  seed("contractId", doc.contractId);
  seed("propertyId", doc.propertyId);
  seed("unitId", doc.unitId);
  seed("supplierId", doc.supplierId);
  seed("assetId", doc.assetId);

  /* Entities named in the file. */
  let best = 0;
  for (const s of store.suppliers) {
    const score = Math.max(matchName(hayTokens, s.name), s.company ? matchName(hayTokens, s.company) : 0);
    if (score > best && score >= 0.5) {
      best = score;
      links.supplierId = s.id;
      linkConfidence.supplierId = score;
      fields.push({ key: "supplierName", label: FIELD_LABELS.supplierName, value: s.name, confidence: score, evidence: "name in file" });
    }
  }
  best = 0;
  for (const t of store.tenants) {
    const score = matchName(hayTokens, t.fullName);
    if (score > best && score >= 0.7) {
      best = score;
      links.tenantId = t.id;
      linkConfidence.tenantId = score;
      fields.push({ key: "tenantName", label: FIELD_LABELS.tenantName, value: t.fullName, confidence: score, evidence: "name in file" });
    }
  }
  best = 0;
  for (const p of store.properties) {
    const score = Math.max(matchName(hayTokens, p.name), p.code && hayTokens.includes(p.code.toLowerCase()) ? 0.8 : 0);
    if (score > best && score >= 0.5) {
      best = score;
      links.propertyId = p.id;
      linkConfidence.propertyId = score;
      fields.push({ key: "propertyName", label: FIELD_LABELS.propertyName, value: p.name, confidence: score, evidence: "name in file" });
    }
  }
  // Every 3–4 digit run that is not part of a date, a year or a reference like INV-302; a unit keyword in front wins.
  const unitCandidates: string[] = [];
  for (const m of haystack.matchAll(/(?<![0-9A-Za-z])(unit|apt|apartment|flat|#)?\s*-?([A-Za-z]?\d{3,4})(?![0-9A-Za-z])/gi)) {
    const token = m[2].toUpperCase();
    const before = haystack.slice(Math.max(0, m.index ?? 0) - 6, m.index ?? 0);
    const after = haystack.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 6);
    const keyword = Boolean(m[1]);
    const datePart = /[-_./]\s*$/.test(before) && /^\s*[-_./]?\d/.test(after) ? true : /^[-_./]\d{1,2}[-_./]/.test(after) || /\d[-_./]$/.test(before);
    const reference = /[A-Z]{2,5}-$/i.test(before);
    const year = /^(19|20)\d{2}$/.test(token);
    if (!keyword && (datePart || reference || year)) continue;
    unitCandidates.push(token);
    if (keyword) unitCandidates.unshift(token);
  }
  const unitToken = unitCandidates.find((tok) => store.units.some((u) => u.unitNumber.toUpperCase() === tok && (!links.propertyId || u.propertyId === links.propertyId)));
  if (unitToken) {
    const candidates = store.units.filter((u) => u.unitNumber.toUpperCase() === unitToken && (!links.propertyId || u.propertyId === links.propertyId));
    if (candidates.length === 1) {
      links.unitId = candidates[0].id;
      linkConfidence.unitId = links.propertyId ? 0.85 : 0.6;
      if (!links.propertyId) {
        links.propertyId = candidates[0].propertyId;
        linkConfidence.propertyId = 0.6;
      }
      fields.push({ key: "unitNumber", label: FIELD_LABELS.unitNumber, value: candidates[0].unitNumber, confidence: linkConfidence.unitId, evidence: `"${unitToken}" in file` });
    } else if (candidates.length > 1) notes.push(`Unit ${unitToken} exists in ${candidates.length} buildings — pick the building.`);
  }
  if (links.tenantId && !links.contractId) {
    const current = (idx.contractsByTenant.get(links.tenantId) ?? []).filter(isOccupying).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? (idx.contractsByTenant.get(links.tenantId) ?? []).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
    if (current) {
      links.contractId = current.id;
      linkConfidence.contractId = 0.6;
      if (!links.unitId) {
        links.unitId = current.unitId;
        linkConfidence.unitId = 0.6;
      }
      if (!links.propertyId) {
        links.propertyId = current.propertyId;
        linkConfidence.propertyId = 0.6;
      }
    }
  }
  if (!links.assetId && (docType === "warranty" || docType === "certificate" || docType === "maintenance_report")) {
    best = 0;
    for (const a of store.assets) {
      const score = matchName(hayTokens, a.name);
      if (score > best && score >= 0.5 && (!links.propertyId || a.propertyId === links.propertyId)) {
        best = score;
        links.assetId = a.id;
        linkConfidence.assetId = score;
        fields.push({ key: "assetName", label: FIELD_LABELS.assetName, value: a.name, confidence: score, evidence: "name in file" });
      }
    }
  }

  /* Dates, amounts, references. */
  const dates = findDates(haystack);
  const amounts = findAmounts(haystack);
  const reference = findReference(haystack);
  const expiring = docType === "insurance" || docType === "certificate" || docType === "warranty" || docType === "tenant_id";
  if (docType === "lease") {
    if (dates.length >= 2) {
      const sorted = [...dates].sort();
      fields.push({ key: "startDate", label: FIELD_LABELS.startDate, value: sorted[0], confidence: 0.6, evidence: "earliest date in file" });
      fields.push({ key: "endDate", label: FIELD_LABELS.endDate, value: sorted[sorted.length - 1], confidence: 0.6, evidence: "latest date in file" });
    } else if (dates.length === 1) fields.push({ key: "startDate", label: FIELD_LABELS.startDate, value: dates[0], confidence: 0.4 });
    const rent = text ? findLabelledAmount(text, /rent/i) : null;
    const dep = text ? findLabelledAmount(text, /deposit/i) : null;
    if (rent) fields.push({ key: "rent", label: FIELD_LABELS.rent, value: String(rent), confidence: 0.7, evidence: "labelled in text" });
    else if (amounts.length > 0) fields.push({ key: "rent", label: FIELD_LABELS.rent, value: String(Math.max(...amounts)), confidence: 0.35, evidence: "largest figure in file" });
    if (dep) fields.push({ key: "deposit", label: FIELD_LABELS.deposit, value: String(dep), confidence: 0.7, evidence: "labelled in text" });
    if (text) {
      const freq = text.match(/\b(monthly|quarterly|semi[- ]annual|annual|yearly)\b/i)?.[1];
      if (freq) fields.push({ key: "paymentFrequency", label: FIELD_LABELS.paymentFrequency, value: freq.toLowerCase().replace(/yearly/, "annual").replace(/\s|-/g, "_"), confidence: 0.7 });
      const inc = text.match(/(?:increase|escalat)[^.\n]{0,120}/i)?.[0];
      if (inc) fields.push({ key: "increaseClause", label: FIELD_LABELS.increaseClause, value: inc.trim(), confidence: 0.6 });
    }
  } else if (expiring) {
    const sorted = [...dates].sort();
    const future = sorted.filter((d) => d >= today());
    const past = sorted.filter((d) => d < today());
    if (future.length > 0) fields.push({ key: "expiryDate", label: FIELD_LABELS.expiryDate, value: future[future.length - 1], confidence: sorted.length === 1 ? 0.6 : 0.75, evidence: "future date in file" });
    if (past.length > 0) fields.push({ key: "issuedDate", label: FIELD_LABELS.issuedDate, value: past[0], confidence: 0.6, evidence: "earliest date in file" });
    if (dates.length === 0) notes.push("No expiry date found — enter it so the app can warn you before it lapses.");
  } else {
    if (dates.length > 0) fields.push({ key: "date", label: FIELD_LABELS.date, value: [...dates].sort()[0], confidence: 0.7, evidence: "date in file" });
    if (dates.length > 1) fields.push({ key: "dueDate", label: FIELD_LABELS.dueDate, value: [...dates].sort()[dates.length - 1], confidence: 0.5, evidence: "later date in file" });
    if (amounts.length > 0) fields.push({ key: "amount", label: FIELD_LABELS.amount, value: String(Math.max(...amounts)), confidence: text ? 0.75 : 0.6, evidence: text ? "largest labelled figure" : "figure in file name" });
    if (reference) fields.push({ key: "invoiceNumber", label: FIELD_LABELS.invoiceNumber, value: reference, confidence: 0.7 });
  }

  if (!text && !doc.mimeType.startsWith("text/")) notes.push("Read from the file name only — the file itself was not opened. Check every field.");
  return { docType, typeConfidence, fields, links, linkConfidence, source: "rules", notes };
}

function findLabelledAmount(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}[^\\d$]{0,40}\\$?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "i");
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* -------------------------------------------------------------------------- */
/* Model extraction (only when a key is configured on the server)             */
/* -------------------------------------------------------------------------- */

export interface ExtractHints {
  tenants: { id: ID; name: string }[];
  properties: { id: ID; name: string; code: string }[];
  units: { id: ID; number: string; propertyId: ID }[];
  suppliers: { id: ID; name: string }[];
  assets: { id: ID; name: string; propertyId: ID }[];
}

export interface ExtractRequest {
  fileName: string;
  mimeType: string;
  text?: string;
  /** Base64 payload for images and PDFs (no data: prefix). */
  data?: string;
  hints: ExtractHints;
  categories: readonly string[];
}

export type ExtractResponse = { ok: true; extraction: DocumentExtraction } | { ok: false; error: "no_credentials" | "api_error" | "bad_request" | "unsupported"; message: string };

let modelAvailable: boolean | null = null;

export function buildHints(store: Store): ExtractHints {
  return {
    tenants: store.tenants.map((t) => ({ id: t.id, name: t.fullName })),
    properties: store.properties.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    units: store.units.map((u) => ({ id: u.id, number: u.unitNumber, propertyId: u.propertyId })),
    suppliers: store.suppliers.map((s) => ({ id: s.id, name: s.name })),
    assets: store.assets.map((a) => ({ id: a.id, name: a.name, propertyId: a.propertyId })),
  };
}

/** Validate ids and fields coming back from the model so nothing unknown reaches the review screen. */
export function sanitizeExtraction(store: Store, raw: unknown, fallback: DocumentExtraction): DocumentExtraction {
  if (!raw || typeof raw !== "object") return fallback;
  const idx = indexStore(store);
  const r = raw as Partial<DocumentExtraction> & { docType?: string };
  const categories = new Set<string>(["lease", "tenant_id", "ownership", "insurance", "invoice", "receipt", "quotation", "inspection", "maintenance_report", "certificate", "warranty", "municipality", "photo", "other"]);
  const docType = (typeof r.docType === "string" && categories.has(r.docType) ? r.docType : fallback.docType) as DocumentCategory;
  const fields: ExtractedField[] = Array.isArray(r.fields)
    ? r.fields
        .filter((f): f is ExtractedField => !!f && typeof f === "object" && typeof (f as ExtractedField).key === "string" && (f as ExtractedField).key in FIELD_LABELS && typeof (f as ExtractedField).value === "string")
        .map((f) => ({ key: f.key, label: FIELD_LABELS[f.key], value: f.value.trim(), confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0.5)), evidence: typeof f.evidence === "string" ? f.evidence : undefined }))
        .filter((f) => f.value.length > 0)
    : [];
  const links: ExtractedLinks = {};
  const linkConfidence: DocumentExtraction["linkConfidence"] = {};
  const l = (r.links ?? {}) as Record<string, unknown>;
  const lc = (r.linkConfidence ?? {}) as Record<string, unknown>;
  const take = (key: keyof ExtractedLinks, ok: (id: string) => boolean) => {
    const id = l[key];
    if (typeof id === "string" && ok(id)) {
      links[key] = id;
      linkConfidence[key] = Math.max(0, Math.min(1, Number(lc[key]) || 0.6));
    } else if (fallback.links[key]) {
      links[key] = fallback.links[key];
      linkConfidence[key] = fallback.linkConfidence[key];
    }
  };
  take("tenantId", (id) => idx.tenantById.has(id));
  take("contractId", (id) => idx.contractById.has(id));
  take("propertyId", (id) => idx.propertyById.has(id));
  take("unitId", (id) => idx.unitById.has(id));
  take("supplierId", (id) => idx.supplierById.has(id));
  take("assetId", (id) => idx.assetById.has(id));
  return { docType, typeConfidence: Math.max(0, Math.min(1, Number(r.typeConfidence) || 0.7)), fields: fields.length > 0 ? fields : fallback.fields, links, linkConfidence, source: "model", model: typeof r.model === "string" ? r.model : undefined, notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string").slice(0, 5) : [] };
}

async function readText(doc: StoredDocument): Promise<string | null> {
  if (!doc.dataUrl || !doc.mimeType.startsWith("text/")) return null;
  try {
    const res = await fetch(doc.dataUrl);
    return (await res.text()).slice(0, 20_000);
  } catch {
    return null;
  }
}

async function readBase64(doc: StoredDocument): Promise<string | null> {
  if (!doc.dataUrl || !(doc.mimeType.startsWith("image/") || doc.mimeType === "application/pdf")) return null;
  try {
    const res = await fetch(doc.dataUrl);
    const blob = await res.blob();
    if (blob.size > 8 * 1024 * 1024) return null;
    const buf = await blob.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}

/**
 * Rules first (instant, offline). When the server has credentials and the
 * file can be read, ask the model and validate what comes back; otherwise the
 * rule-based result stands and says so.
 */
export async function extractDocument(store: Store, doc: StoredDocument, onStatus?: (s: string) => void): Promise<DocumentExtraction> {
  const text = await readText(doc);
  const rules = extractByRules(store, doc, text);
  if (modelAvailable === false) return rules;
  const data = text ? undefined : await readBase64(doc);
  if (!text && !data) {
    if (doc.dataUrl) rules.notes.unshift("This file type cannot be read here; suggestions come from the file name.");
    return rules;
  }
  onStatus?.("Reading the document…");
  try {
    const res = await fetch("/api/ai/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: doc.fileName, mimeType: doc.mimeType, text: text ?? undefined, data: data ?? undefined, hints: buildHints(store), categories: ["lease", "tenant_id", "ownership", "insurance", "invoice", "receipt", "quotation", "inspection", "maintenance_report", "certificate", "warranty", "municipality", "photo", "other"] } satisfies ExtractRequest) });
    const body = (await res.json()) as ExtractResponse;
    if (!body.ok) {
      if (body.error === "no_credentials") modelAvailable = false;
      rules.notes.unshift(body.error === "no_credentials" ? "Claude is not configured on this server — suggestions come from the rules." : `Model unavailable (${body.message}) — suggestions come from the rules.`);
      return rules;
    }
    modelAvailable = true;
    return sanitizeExtraction(store, body.extraction, rules);
  } catch (err) {
    rules.notes.unshift(`Could not reach the model (${err instanceof Error ? err.message : String(err)}) — suggestions come from the rules.`);
    return rules;
  }
}
