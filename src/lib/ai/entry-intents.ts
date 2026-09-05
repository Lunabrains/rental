import { indexStore } from "@/lib/data/store";
import { addDaysISO, addMonthsISO, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatMoney } from "@/lib/format";
import { ASSET_TYPES, EXPENSE_CATEGORIES, SUPPLIER_CATEGORIES, type AssetType, type ExpenseCategory, type Property, type Store, type SupplierCategory, type Tenant, type Unit } from "@/types";

import { strings, type Lang } from "./i18n";
import type { AnswerAction, AssistantAnswer } from "./types";

/**
 * Data entry by talking: "add a new building called Marina Residence with 5
 * floors and 4 units per floor", "add tenant Omar Haddad phone 03 123 456 to
 * unit 403 in Beirut Heights, rent 900 from 1 October for 12 months". The
 * assistant never writes anything itself — it opens the matching form,
 * prefilled with what it understood, and the owner saves it.
 */

export type EntryKind = "building" | "unit" | "tenant" | "contract" | "asset" | "expense" | "supplier";

export interface EntryContext {
  property: Property | null;
  tenant: Tenant | null;
}

const VERB = /^(?:please\s+|can you\s+|could you\s+|i want to\s+|i'd like to\s+|i need to\s+|let'?s\s+)?(?:add|create|register|enter|insert|set ?up|make|new|log|record|open|sign|put)\b/;
const NOUN: [EntryKind, RegExp][] = [
  ["contract", /\b(contract|lease|agreement|tenancy)\b/],
  ["tenant", /\b(tenant|renter|lessee|occupant)\b/],
  ["unit", /\b(unit|apartment|flat|studio|apt)\b/],
  ["building", /\b(building|property|tower|block)\b/],
  ["asset", /\b(asset|equipment|elevator|lift|generator|pump|tank|boiler|hvac|cctv|solar|panel|gate|machine)\b/],
  ["expense", /\b(expense|invoice|bill|receipt|cost|spend)\b/],
  ["supplier", /\b(supplier|contractor|technician|vendor|plumber|electrician|company)\b/],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000 };
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "two bedrooms" → "2 bedrooms"; "twenty five" → 25 ; "1,200" → 1200. */
function digitsOf(text: string): string {
  let s = text.toLowerCase().replace(/(\d),(\d{3})\b/g, "$1$2");
  s = s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g, (_, t, u) => String(NUMBER_WORDS[t] + NUMBER_WORDS[u]));
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b(?=\s+(?:floors?|units?|apartments?|flats?|bed|bath|months?|years?|thousand|hundred|k\b|dollars?|\$))/g, (m) => String(NUMBER_WORDS[m]));
  s = s.replace(/\b(\d+)\s*thousand\b/g, (_, n) => String(Number(n) * 1000)).replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, n) => String(Math.round(Number(n) * 1000)));
  s = s.replace(/\b(a|an)\s+(?=(?:month|year)\b)/g, "1 ");
  return s;
}

const NAME_STOP = /(?:\s+(?:\d|(?:with|in|at|on|for|from|to|into|phone|mobile|tel|rent|renting|floors?|units?|bedrooms?|deposit|starting|start|email|nationality|category|amount|cost|type|serial|model|brand|of|and)\b)|\s*[,;.]).*$/i;

function capturedName(raw: string, after: RegExp): string | null {
  const m = after.exec(raw);
  if (!m) return null;
  const rest = raw.slice(m.index + m[0].length);
  const quoted = /^["“'‘]([^"”'’]+)["”'’]/.exec(rest);
  const name = (quoted ? quoted[1] : rest.replace(NAME_STOP, "")).trim().replace(/[.,;:]+$/, "");
  return name.length > 0 && name.length <= 60 ? name : null;
}

function num(re: RegExp, s: string): number | null {
  const m = re.exec(s);
  if (!m) return null;
  const v = Number((m[1] ?? m[2] ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : null;
}

function phoneIn(raw: string): string | null {
  const labelled = /(?:phone|mobile|number|tel|cell|whatsapp)\s*(?:number|no\.?|is|:)?\s*(\+?\d[\d\s().-]{5,}\d)/i.exec(raw);
  const bare = /(\+\d[\d\s().-]{6,}\d|\b0\d[\d\s-]{6,}\d)/.exec(raw);
  const hit = labelled?.[1] ?? bare?.[1] ?? null;
  if (!hit) return null;
  const digits = hit.replace(/\D/g, "");
  return digits.length >= 7 ? hit.replace(/\s+/g, " ").trim() : null;
}

function emailIn(raw: string): string | null {
  return /([\w.+-]+@[\w-]+\.[\w.-]+)/.exec(raw)?.[1] ?? null;
}

function dateIn(s: string, base: string): string | null {
  const pad = (n: number | string) => String(n).padStart(2, "0");
  const year = Number(base.slice(0, 4));
  const m = /\b(?:from|starting|start(?:ing)? on|beginning|as of|on)\s+(?:the\s+)?(.+?)(?=\s+(?:for|until|till|to|rent|at|with|,)|$)/.exec(s);
  const chunk = (m?.[1] ?? "").trim();
  const tryParse = (t: string): string | null => {
    if (!t) return null;
    if (/^today$/.test(t)) return base;
    if (/^tomorrow$/.test(t)) return addDaysISO(base, 1);
    if (/^(next month|first of next month|start of next month)$/.test(t)) return `${addMonthsISO(base.slice(0, 7) + "-01", 1)}`;
    let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (x) return `${x[1]}-${pad(x[2])}-${pad(x[3])}`;
    x = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t);
    if (x) return `${x[3]}-${pad(x[2])}-${pad(x[1])}`;
    x = /^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)\.?(?:\s+(\d{4}))?$/.exec(t);
    if (x && MONTHS[x[2].slice(0, 3)]) return `${x[3] ?? year}-${pad(MONTHS[x[2].slice(0, 3)])}-${pad(x[1])}`;
    x = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(t);
    if (x && MONTHS[x[1].slice(0, 3)]) return `${x[3] ?? year}-${pad(MONTHS[x[1].slice(0, 3)])}-${pad(x[2])}`;
    x = /^(?:1st|first)\s+(?:of\s+)?([a-z]+)$/.exec(t);
    if (x && MONTHS[x[1].slice(0, 3)]) return `${year}-${pad(MONTHS[x[1].slice(0, 3)])}-01`;
    x = /^([a-z]+)$/.exec(t);
    if (x && MONTHS[x[1].slice(0, 3)]) return `${year}-${pad(MONTHS[x[1].slice(0, 3)])}-01`;
    return null;
  };
  return tryParse(chunk) ?? tryParse(/\b(\d{4}-\d{2}-\d{2})\b/.exec(s)?.[1] ?? "") ?? null;
}

function monthsIn(s: string): number | null {
  const y = num(/\b(\d+)\s*(?:years?|yrs?)\b/, s);
  if (y) return y * 12;
  const m = num(/\b(\d+)\s*(?:months?|mos?)\b/, s);
  if (m) return m;
  if (/\b(a|one|1) year\b|\byearly\b|\bannual\b/.test(s)) return 12;
  return null;
}

function moneyIn(s: string, labels: RegExp): number | null {
  const labelled = new RegExp(`(?:${labels.source})\\s*(?:of|is|at|:|=)?\\s*\\$?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\\$|usd|dollars?)?`, "i").exec(s);
  if (labelled) return Number(labelled[1]);
  const currency = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:\$|usd|dollars?)/i.exec(s);
  if (currency) return Number(currency[1] ?? currency[2]);
  return null;
}

function resolveProperty(store: Store, raw: string, fallback: Property | null): { property: Property | null; mentioned: string | null } {
  const lower = raw.toLowerCase();
  let best: Property | null = null;
  let bestLen = 0;
  for (const p of store.properties) {
    const name = p.name.toLowerCase();
    const first = name.split(/\s+/)[0];
    const code = p.code.toLowerCase();
    if (lower.includes(name) && name.length > bestLen) {
      best = p;
      bestLen = name.length;
    } else if (first.length >= 5 && new RegExp(`\\b${first}\\b`).test(lower) && first.length > bestLen) {
      best = p;
      bestLen = first.length;
    } else if (code.length >= 2 && !/^\d+$/.test(code) && new RegExp(`\\b${code}\\b`).test(lower) && code.length > bestLen) {
      best = p;
      bestLen = code.length;
    }
  }
  if (best) return { property: best, mentioned: null };
  const m = /\b(?:in|at|to|into|of)\s+(?:the\s+)?(?:building\s+)?([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,3})/.exec(raw);
  const mentioned = m ? m[1].replace(/\s+(?:unit|apartment|flat|phone|rent|from|for|with).*$/i, "").trim() : null;
  return { property: fallback, mentioned: mentioned && mentioned.length > 1 ? mentioned : null };
}

function resolveTenant(store: Store, raw: string, fallback: Tenant | null): { tenant: Tenant | null; mentioned: string | null } {
  if (fallback) return { tenant: fallback, mentioned: null };
  const lower = raw.toLowerCase();
  const full = store.tenants.filter((t) => lower.includes(t.fullName.toLowerCase()));
  if (full.length === 1) return { tenant: full[0], mentioned: null };
  const tokens = new Set(lower.split(/[^a-z؀-ۿ]+/).filter((w) => w.length >= 3));
  const partial = store.tenants.filter((t) => t.fullName.toLowerCase().split(/\s+/).some((part) => part.length >= 3 && tokens.has(part)));
  if (partial.length === 1) return { tenant: partial[0], mentioned: null };
  const m = /\b(?:for|with|tenant|to)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})/.exec(raw);
  return { tenant: null, mentioned: m ? m[1] : null };
}

/** Phone numbers, money and dates out of the way, so "950" is never taken for a unit. */
function withoutNumbersThatAreNotUnits(s: string): string {
  return s
    .replace(/\+?\d[\d\s().-]{5,}\d/g, " ")
    .replace(/\b(?:rent(?:al)?|deposit|price|amount|cost|paying|pays|at|of|for|worth|paid|total)\s*(?:of|is|at|:|=)?\s*\$?\s*\d+(?:\.\d+)?\s*(?:\$|usd|dollars?)?/g, " ")
    .replace(/\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:\$|usd|dollars?)/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/g, " ")
    .replace(/\b\d+\s*(?:floors?|months?|years?|sqm|m2|bed(?:room)?s?|bath(?:room)?s?|br)\b/g, " ");
}

function unitIn(s: string, property: Property | null, store: Store): { unit: Unit | null; number: string | null } {
  const m = /\b(?:unit|apartment|flat|apt)\s*#?\s*([a-z]?\d{1,4}[a-z]?)\b/.exec(s) ?? /\b([a-z]?\d{3,4})\b/.exec(withoutNumbersThatAreNotUnits(s));
  const number = m?.[1] ?? null;
  if (!number) return { unit: null, number: null };
  const units = store.units.filter((u) => u.unitNumber.toLowerCase() === number.toLowerCase() && (!property || u.propertyId === property.id));
  return { unit: units.length === 1 ? units[0] : null, number };
}

function assetTypeIn(s: string): AssetType | null {
  const table: [RegExp, AssetType][] = [
    [/\b(elevator|lift)s?\b/, "elevator"],
    [/\bgenerators?\b/, "generator"],
    [/\b(water )?pumps?\b/, "water_pump"],
    [/\b(water )?tanks?\b/, "water_tank"],
    [/\b(hvac|air ?con\w*|ac unit|chiller|split unit)s?\b/, "hvac"],
    [/\b(fire|sprinkler|extinguisher|alarm)s?\b/, "fire_system"],
    [/\b(cctv|cameras?|surveillance)\b/, "cctv"],
    [/\b(access control|intercom|door entry|badge reader)\b/, "access_control"],
    [/\bboilers?\b/, "boiler"],
    [/\bsolar\b/, "solar_system"],
    [/\b(electrical panel|switchboard|breaker panel|main panel)\b/, "electrical_panel"],
    [/\b(parking gate|barrier|gate)\b/, "parking_gate"],
  ];
  for (const [re, t] of table) if (re.test(s) && (ASSET_TYPES as readonly string[]).includes(t)) return t;
  return null;
}

function expenseCategoryIn(s: string): ExpenseCategory | null {
  const table: [RegExp, ExpenseCategory][] = [
    [/\b(elevator|lift)\b/, "elevator"],
    [/\bgenerator\b/, "generator"],
    [/\b(plumb\w*|leak|pipes?|drain)\b/, "plumbing"],
    [/\b(electric\w*|wiring)\b/, "electrical"],
    [/\b(hvac|air ?con\w*|cooling|heating)\b/, "hvac"],
    [/\bclean\w*\b/, "cleaning"],
    [/\b(security|guards?|cctv)\b/, "security"],
    [/\bwater\b/, "water"],
    [/\b(electricity|edl|power bill)\b/, "electricity"],
    [/\b(municipal\w*)\b/, "municipality"],
    [/\binsurance\b/, "insurance"],
    [/\btax(es)?\b/, "taxes"],
    [/\b(renovat\w*|capex|refit)\b/, "renovation"],
    [/\b(staff|salar\w*|concierge|janitor)\b/, "staff"],
    [/\bcontractor\b/, "contractor"],
    [/\b(common area|lobby|corridor|stairs?)\b/, "common_area"],
    [/\b(maintenance|repair\w*)\b/, "maintenance"],
  ];
  for (const [re, c] of table) if (re.test(s) && (EXPENSE_CATEGORIES as readonly string[]).includes(c)) return c;
  return null;
}

function supplierCategoryIn(s: string): SupplierCategory | null {
  const table: [RegExp, SupplierCategory][] = [
    [/\bplumb\w*\b/, "plumbing"],
    [/\belectric\w*\b/, "electrical"],
    [/\b(hvac|air ?con\w*)\b/, "hvac"],
    [/\b(elevator|lift)s?\b/, "elevator"],
    [/\bgenerators?\b/, "generator"],
    [/\bclean\w*\b/, "cleaning"],
    [/\b(security|guards?)\b/, "security"],
    [/\b(paint\w*)\b/, "painting"],
    [/\b(pest|termite|exterminat\w*)\b/, "pest_control"],
    [/\b(appliance|fridge|washing machine|oven)s?\b/, "appliance"],
    [/\b(general contractor|contractor|builder|construction)\b/, "general_contractor"],
  ];
  for (const [re, c] of table) if (re.test(s) && (SUPPLIER_CATEGORIES as readonly string[]).includes(c)) return c;
  return null;
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? { firstName: parts[0], lastName: "" } : { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Which record the sentence is about, or null when it is not a data-entry instruction. */
export function entryKindOf(q: string): EntryKind | null {
  if (!VERB.test(q)) return null;
  if (/\b(work order|ticket|repair job|maintenance (request|job)|reminder|remind me|inspection|note to self)\b/.test(q)) return null;
  if (/\b(who|which|what|when|where|how (much|many|long))\b/.test(q) && !/\b(called|named)\b/.test(q)) return null;
  let best: { kind: EntryKind; at: number } | null = null;
  for (const [kind, re] of NOUN) {
    const m = re.exec(q);
    if (m && (!best || m.index < best.at)) best = { kind, at: m.index };
  }
  // "add tenant X to unit 403" is a tenant; "add unit 403 to building X" is a unit — earliest noun wins.
  return best?.kind ?? null;
}

export function entryIntent(raw: string, q: string, store: Store, ctx: EntryContext, lang: Lang): AssistantAnswer | null {
  const kind = entryKindOf(q);
  if (!kind) return null;
  const s = strings(lang);
  const v = s.v2;
  const f = v.entryFields;
  const d = digitsOf(raw);
  const base = today();
  const idx = indexStore(store);
  const rows: [string, string][] = [];
  const notes: string[] = [];
  const local = (payload: Record<string, unknown>, actionKind: AnswerAction["kind"], suggestions: string[] = []): AssistantAnswer => ({
    source: "local",
    lang,
    text: v.entryPrepared(v.entryWhat[kind]) + notes.join(""),
    table: rows.length > 0 ? { columns: [f.field, f.value], rows } : undefined,
    actions: [{ kind: actionKind, label: v.labels.openForm, targetId: "new", payload }],
    autoOpen: true,
    suggestions,
  });
  const put = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    rows.push([label, String(value)]);
  };

  if (kind === "building") {
    const name = capturedName(raw, /\b(?:named|called|name it|name is|titled|by the name of)\b\s*:?\s*/i) ?? capturedName(raw, /\b(?:building|property|tower|block)\b\s*:?\s*/i);
    const floors = num(/(\d+)\s*(?:floors?|stories|storeys|levels)\b/, d);
    let perFloor = num(/(\d+)\s*(?:units?|apartments?|flats?)\s*(?:per|on each|on every|each|a|by)\s*floor/, d);
    const total = num(/(\d+)\s*(?:units?|apartments?|flats?)\b(?!\s*(?:per|on each|each|a|by)\s*floor)/, d);
    if (!perFloor && total && floors) perFloor = Math.ceil(total / floors);
    const city = /\b(?:in|at)\s+([A-Z][a-z]+)(?:\s|,|$)/.exec(raw.replace(new RegExp(name ?? " ", "i"), ""))?.[1] ?? null;
    const rent = moneyIn(d, /rent(?:al)?|asking|price/);
    const bedrooms = num(/(\d+)\s*(?:bed(?:room)?s?|br)\b/, d);
    const yearBuilt = num(/\b(?:built|constructed)\s*(?:in)?\s*((?:19|20)\d{2})\b/, d);
    put(f.name, name);
    put(f.floors, floors);
    put(f.perFloor, perFloor);
    put(f.city, city);
    put(f.rent, rent ? formatMoney(rent) : null);
    put(f.bedrooms, bedrooms);
    return local({ name: name ?? undefined, floors: floors ?? undefined, unitsPerFloor: perFloor ?? undefined, city: city ?? undefined, yearBuilt: yearBuilt ?? undefined, askingRent: rent ?? undefined, bedrooms: bedrooms ?? undefined, generateUnits: !!(floors && perFloor) }, "create_property");
  }

  if (kind === "unit") {
    const { property, mentioned } = resolveProperty(store, raw, ctx.property);
    const { number } = unitIn(d, property, store);
    const floorExplicit = num(/\b(?:on|at)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?\s+floor\b|\bfloor\s+(\d+)\b/, d);
    const ground = /\b(ground floor|street level)\b/.test(d);
    const floor = ground ? 0 : (floorExplicit ?? (number && /^\d{3,4}$/.test(number) ? Number(number.slice(0, -2)) : null));
    const bedrooms = num(/(\d+)\s*(?:bed(?:room)?s?|br)\b/, d);
    const bathrooms = num(/(\d+)\s*(?:bath(?:room)?s?)\b/, d);
    const size = num(/(\d+)\s*(?:sqm|m2|m²|square met\w*)\b/, d);
    const rent = moneyIn(d, /rent(?:al)?|asking|price/);
    const deposit = moneyIn(d, /deposit/);
    const furnished = /\bfurnished\b/.test(d) && !/\bunfurnished\b/.test(d);
    if (!property && mentioned) notes.push(v.entryUnknownBuilding(mentioned));
    else if (!property) notes.push(v.entryNoBuilding);
    put(f.building, property?.name ?? mentioned);
    put(f.unit, number);
    put(f.floor, floor);
    put(f.bedrooms, bedrooms);
    put(f.bathrooms, bathrooms);
    put(f.size, size ? `${size} m²` : null);
    put(f.rent, rent ? formatMoney(rent) : null);
    return local({ propertyId: property?.id ?? null, unitNumber: number ?? undefined, floor: floor ?? undefined, bedrooms: bedrooms ?? undefined, bathrooms: bathrooms ?? undefined, sizeSqm: size ?? undefined, askingRent: rent ?? undefined, askingDeposit: deposit ?? undefined, furnished }, "create_unit");
  }

  if (kind === "tenant") {
    const name = capturedName(raw, /\b(?:named|called|name is|by the name of)\b\s*:?\s*/i) ?? capturedName(raw, /\b(?:tenant|renter|lessee|occupant)\b\s*:?\s*/i);
    const phone = phoneIn(raw);
    const email = emailIn(raw);
    const { property, mentioned } = resolveProperty(store, raw.replace(name ?? " ", ""), ctx.property);
    const { unit, number } = unitIn(d, property, store);
    const rent = moneyIn(d, /rent(?:al)?|paying|pays|price/);
    const startDate = dateIn(d, base);
    const months = monthsIn(d);
    const nationality = /\b(lebanese|syrian|egyptian|french|american|british|canadian|jordanian|iraqi|palestinian|saudi|emirati|kuwaiti|german|italian|spanish|indian|filipino|ethiopian)\b/i.exec(raw)?.[1] ?? null;
    if (number && !unit && property) notes.push(v.entryUnknownUnit(number, property.name));
    else if (number && !property && mentioned) notes.push(v.entryUnknownBuilding(mentioned));
    if (unit && (idx.contractsByUnit.get(unit.id) ?? []).some(isOccupying)) notes.push(v.entryUnitOccupied(unit.unitNumber));
    const { firstName, lastName } = name ? splitPersonName(name) : { firstName: "", lastName: "" };
    put(f.name, name);
    put(f.phone, phone);
    put(f.email, email);
    put(f.building, property?.name ?? mentioned);
    put(f.unit, unit?.unitNumber ?? number);
    put(f.rent, rent ? formatMoney(rent) : null);
    put(f.start, startDate ? s.date(startDate) : null);
    put(f.months, months);
    return local({ firstName: firstName || undefined, lastName: lastName || undefined, phone: phone ?? undefined, email: email ?? undefined, nationality: nationality ? nationality[0].toUpperCase() + nationality.slice(1).toLowerCase() : undefined, unitId: unit?.id ?? null, rent: rent ?? undefined, startDate: startDate ?? undefined, months: months ?? undefined }, "create_tenant");
  }

  if (kind === "contract") {
    const { tenant, mentioned: tenantName } = resolveTenant(store, raw, ctx.tenant);
    const { property, mentioned } = resolveProperty(store, raw, ctx.property);
    const { unit, number } = unitIn(d, property, store);
    const rent = moneyIn(d, /rent(?:al)?|paying|pays|price|at/);
    const deposit = moneyIn(d, /deposit/);
    const startDate = dateIn(d, base);
    const months = monthsIn(d);
    const day = num(/\b(?:due|payable|paid)\s+(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/, d);
    if (!tenant && tenantName) notes.push(v.entryUnknownTenant(tenantName));
    if (number && !unit && property) notes.push(v.entryUnknownUnit(number, property.name));
    else if (number && !property && mentioned) notes.push(v.entryUnknownBuilding(mentioned));
    if (unit && (idx.contractsByUnit.get(unit.id) ?? []).some(isOccupying)) notes.push(v.entryUnitOccupied(unit.unitNumber));
    put(f.tenant, tenant?.fullName ?? tenantName);
    put(f.building, property?.name ?? mentioned);
    put(f.unit, unit?.unitNumber ?? number);
    put(f.rent, rent ? formatMoney(rent) : null);
    put(f.deposit, deposit ? formatMoney(deposit) : null);
    put(f.start, startDate ? s.date(startDate) : null);
    put(f.months, months);
    return local({ tenantId: tenant?.id ?? null, unitId: unit?.id ?? null, propertyId: property?.id ?? null, rent: rent ?? undefined, deposit: deposit ?? undefined, startDate: startDate ?? undefined, months: months ?? undefined, paymentDay: day ?? undefined }, "create_contract");
  }

  if (kind === "asset") {
    const { property, mentioned } = resolveProperty(store, raw, ctx.property);
    const assetType = assetTypeIn(d);
    const explicit = capturedName(raw, /\b(?:named|called|name it|name is|titled)\b\s*:?\s*/i);
    const brandWord = /\b(?:brand|make|manufacturer|by)\s+([A-Z][\w-]*)/.exec(raw)?.[1] ?? /\b([A-Z][\w-]{2,})\s+(?:elevator|lift|generator|pump|tank|boiler|hvac|cctv|solar|panel|gate|chiller|intercom)s?\b/.exec(raw)?.[1] ?? null;
    const brand = brandWord && !(property && property.name.toLowerCase().includes(brandWord.toLowerCase())) ? brandWord : null;
    const model = /\bmodel\s+([\w-]+)/i.exec(raw)?.[1] ?? null;
    const serial = /\b(?:serial(?: number)?|s\/n|sn)\s*:?\s*([\w-]+)/i.exec(raw)?.[1] ?? null;
    const cost = moneyIn(d, /cost|price|bought for|paid|worth/);
    const installed = dateIn(d.replace(/\binstalled\b/, "on"), base);
    const { unit } = unitIn(d, property, store);
    const name = explicit ?? (assetType && brand ? `${brand} ${assetType.replace(/_/g, " ")}` : assetType ? assetType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
    if (!property && mentioned) notes.push(v.entryUnknownBuilding(mentioned));
    else if (!property) notes.push(v.entryNoBuilding);
    put(f.building, property?.name ?? mentioned);
    put(f.type, assetType ? assetType.replace(/_/g, " ") : null);
    put(f.name, name);
    put(f.brand, brand);
    put(f.model, model);
    put(f.serial, serial);
    put(f.cost, cost ? formatMoney(cost) : null);
    return local({ propertyId: property?.id ?? null, unitId: unit?.id ?? null, assetType: assetType ?? undefined, name: name ?? undefined, manufacturer: brand ?? undefined, model: model ?? undefined, serialNumber: serial ?? undefined, purchaseCost: cost ?? undefined, installationDate: installed ?? undefined }, "create_asset");
  }

  if (kind === "expense") {
    const { property, mentioned } = resolveProperty(store, raw, ctx.property);
    const { unit } = unitIn(d, property, store);
    const amount = moneyIn(d, /amount|cost(?:ing)?|of|for|worth|paid|total/);
    const category = expenseCategoryIn(d);
    const desc = capturedName(raw, /\b(?:for|description|about|re)\b\s*:?\s*/i);
    const dateStr = dateIn(d, base);
    const supplier = store.suppliers.find((sp) => raw.toLowerCase().includes(sp.name.toLowerCase())) ?? null;
    const capex = /\b(capex|capital|investment|improvement)\b/.test(d);
    if (!property && mentioned) notes.push(v.entryUnknownBuilding(mentioned));
    else if (!property) notes.push(v.entryNoBuilding);
    put(f.building, property?.name ?? mentioned);
    put(f.amount, amount ? formatMoney(amount) : null);
    put(f.category, category ? category.replace(/_/g, " ") : null);
    put(f.description, desc);
    put(f.supplier, supplier?.name);
    put(f.date, dateStr ? s.date(dateStr) : null);
    return local({ propertyId: property?.id ?? null, unitId: unit?.id ?? null, amount: amount ?? undefined, category: category ?? undefined, description: desc ?? undefined, supplierId: supplier?.id ?? undefined, expenseDate: dateStr ?? undefined, classification: capex ? "capex" : undefined }, "create_expense");
  }

  // supplier
  const category = supplierCategoryIn(d);
  const name = capturedName(raw, /\b(?:named|called|name is|by the name of)\b\s*:?\s*/i) ?? capturedName(raw, /\b(?:supplier|contractor|technician|vendor|plumber|electrician|company)\b\s*:?\s*/i);
  const phone = phoneIn(raw);
  const email = emailIn(raw);
  const company = /\b(?:company|firm)\s+([A-Z][\w&'’-]*(?:\s+[A-Z][\w&'’-]*){0,3})/.exec(raw)?.[1] ?? null;
  put(f.name, name);
  put(f.category, category ? category.replace(/_/g, " ") : null);
  put(f.phone, phone);
  put(f.email, email);
  put(f.company, company);
  return local({ name: name ?? undefined, category: category ?? undefined, phone: phone ?? undefined, email: email ?? undefined, company: company ?? undefined }, "create_supplier");
}
