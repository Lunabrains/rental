/**
 * Builds the demo seed workbooks:
 *   public/seed/portfolio.xlsx        — 7 buildings, the demo cast, all history,
 *                                       plus suppliers, assets, maintenance,
 *                                       expenses, budgets, utilities, inspections,
 *                                       renovations, parking and keys
 *   public/seed/cedar-residence.xlsx  — the 8th building, dropped live in the demo
 *
 * Every date is a relative token (today-8d, today+28d) resolved by the
 * importer, so the files never go stale. Deterministic: same output every run.
 *
 *   npx tsx scripts/generate-seed.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COLUMNS, IMPORT_ORDER, buildWorkbook, workbookToArrayBuffer, type ImportEntity } from "../src/lib/import/template";

/* ------------------------------- Randomness ------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260904);
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/* --------------------------------- Names ---------------------------------- */

const MALE = [
  "Karim", "Michel", "Rami", "Elie", "Georges", "Tony", "Joseph", "Fadi", "Samir", "Walid", "Nabil", "Ziad", "Bassam",
  "Marwan", "Hassan", "Ali", "Hussein", "Mohammad", "Omar", "Khaled", "Tarek", "Jad", "Charbel", "Antoine", "Pierre",
  "Roy", "Rony", "Naji", "Wissam", "Ghassan", "Imad", "Kamal", "Maroun", "Nicolas", "Paul", "Rafic", "Sami", "Salim",
  "Selim", "Youssef", "Adel", "Amin", "Bilal", "Chadi", "Danny", "Elias", "Fouad", "Habib", "Ibrahim", "Jihad",
];
const FEMALE = [
  "Nadine", "Layla", "Rita", "Maya", "Lara", "Nour", "Rana", "Dima", "Hala", "Ghada", "Lina", "Mona", "Nada", "Rima",
  "Sara", "Yara", "Zeina", "Carla", "Christine", "Cynthia", "Diana", "Elsa", "Jessica", "Joelle", "Josiane", "Maria",
  "Marie", "Micheline", "Mirna", "Nancy", "Nathalie", "Pascale", "Rola", "Roula", "Sandra", "Tala", "Tamara", "Farah",
  "Hiba", "Jana", "Lamia", "Maha", "Mariam", "Racha", "Reem", "Salma", "Samar", "Sirine", "Souad", "Yasmine",
];
const SURNAMES = [
  "Daher", "Saab", "Khoury", "Haddad", "Farah", "Nassar", "Abou Jaoude", "Aoun", "Assaf", "Ayoub", "Azar", "Bitar",
  "Boulos", "Chahine", "Chamoun", "Dagher", "Fakhoury", "Frem", "Gemayel", "Ghanem", "Habib", "Hajj", "Hakim", "Hanna",
  "Harb", "Hobeika", "Issa", "Jabbour", "Kanaan", "Karam", "Kassab", "Kfoury", "Khalil", "Khalife", "Maalouf", "Makhlouf",
  "Mansour", "Matar", "Moawad", "Mouawad", "Nader", "Nakhle", "Nehme", "Rahme", "Rizk", "Saad", "Saade", "Sfeir",
  "Sleiman", "Tabet", "Tannous", "Yazbeck", "Zgheib", "Abdallah", "Fares", "Hamdan", "Itani", "Jaber", "Kabbani",
  "Mikati", "Salam", "Sinno", "Zeidan", "Baydoun", "Fayad", "Hammoud", "Hijazi", "Nasrallah", "Osseiran", "Chehab",
];

const usedNames = new Set<string>();
function makeName(): { first: string; last: string } {
  for (;;) {
    const first = chance(0.55) ? pick(MALE) : pick(FEMALE);
    const last = pick(SURNAMES);
    const key = `${first} ${last}`;
    if (!usedNames.has(key)) {
      usedNames.add(key);
      return { first, last };
    }
  }
}

const usedPhones = new Set<string>();
function makePhone(): string {
  for (;;) {
    const prefix = pick(["3", "70", "71", "76", "78", "79", "81"]);
    const n = `${between(100, 999)} ${between(100, 999)}`;
    const phone = `+961 ${prefix} ${n}`;
    if (!usedPhones.has(phone)) {
      usedPhones.add(phone);
      return phone;
    }
  }
}

function makeIdNumber(type: "national_id" | "passport"): string {
  return type === "passport" ? `RL${between(1000000, 9999999)}` : `LB-${between(1000000, 9999999)}`;
}

const OCCUPATIONS = [
  "Engineer", "Architect", "Teacher", "Pharmacist", "Physician", "Lawyer", "Accountant", "Nurse", "Designer",
  "Software developer", "Bank officer", "Consultant", "Restaurant owner", "Journalist", "Sales manager", "Dentist",
];

/* -------------------------------- Buildings ------------------------------- */

interface BuildingSpec {
  code: string;
  name: string;
  address: string;
  district: string;
  city: string;
  yearBuilt: number;
  floors: number;
  upf: number;
  prefix: string;
  rent: [number, number];
  vacant: number;
  type?: string;
  acquired: string;
  cost: number;
  value: number;
  insurer: string;
  insuranceExpiry: string;
  parking: number;
  notes?: string;
}

const BUILDINGS: BuildingSpec[] = [
  { code: "BH", name: "Beirut Heights", address: "18 Rue Sursock", district: "Achrafieh", city: "Beirut", yearBuilt: 2016, floors: 8, upf: 4, prefix: "", rent: [1000, 1700], vacant: 5, acquired: "2017-03-15", cost: 4_200_000, value: 5_600_000, insurer: "AXA Middle East", insuranceExpiry: "today+7m", parking: 20 },
  { code: "MR", name: "Marina Residence", address: "Marina Boulevard 4", district: "Dbayeh", city: "Metn", yearBuilt: 2012, floors: 10, upf: 4, prefix: "B", rent: [850, 1350], vacant: 11, acquired: "2014-09-01", cost: 3_900_000, value: 4_800_000, insurer: "Bankers Assurance", insuranceExpiry: "today+4m", parking: 30 },
  { code: "DT", name: "Downtown Tower", address: "Foch Street 22", district: "Downtown", city: "Beirut", yearBuilt: 2019, floors: 6, upf: 3, prefix: "", rent: [2200, 3300], vacant: 3, type: "mixed_use", acquired: "2020-01-10", cost: 6_100_000, value: 7_400_000, insurer: "AXA Middle East", insuranceExpiry: "today+10m", parking: 18 },
  { code: "RG", name: "Raouche Gardens", address: "Avenue du Général de Gaulle 71", district: "Raouche", city: "Beirut", yearBuilt: 2008, floors: 5, upf: 4, prefix: "", rent: [700, 1000], vacant: 3, acquired: "2011-06-20", cost: 1_800_000, value: 2_300_000, insurer: "Allianz SNA", insuranceExpiry: "today+3m", parking: 8 },
  { code: "WR", name: "Waterfront Residence", address: "Corniche El Nahr 9", district: "Jounieh", city: "Keserwan", yearBuilt: 2014, floors: 6, upf: 4, prefix: "", rent: [800, 1150], vacant: 5, acquired: "2015-11-05", cost: 2_400_000, value: 2_900_000, insurer: "Allianz SNA", insuranceExpiry: "today+25d", parking: 0 },
  { code: "VP", name: "Verdun Plaza", address: "Rachid Karameh Street 45", district: "Verdun", city: "Beirut", yearBuilt: 2011, floors: 5, upf: 4, prefix: "", rent: [750, 1050], vacant: 3, acquired: "2013-04-12", cost: 2_100_000, value: 2_600_000, insurer: "Bankers Assurance", insuranceExpiry: "today+6m", parking: 0 },
  { code: "MV", name: "Mountain View", address: "Old Broumana Road 3", district: "Broumana", city: "Metn", yearBuilt: 2005, floors: 4, upf: 4, prefix: "", rent: [650, 900], vacant: 3, acquired: "2009-08-30", cost: 1_200_000, value: 1_500_000, insurer: "AXA Middle East", insuranceExpiry: "today+9m", parking: 0 },
];

const CEDAR: BuildingSpec = {
  code: "CR", name: "Cedar Residence", address: "12 Cedar Street", district: "Badaro", city: "Beirut", yearBuilt: 2017, floors: 6, upf: 3, prefix: "", rent: [750, 1100], vacant: 4, acquired: "today-1m", cost: 2_700_000, value: 2_800_000, insurer: "AXA Middle East", insuranceExpiry: "today+11m", parking: 6,
};

/* ---------------------------------- Rows ---------------------------------- */

type Row = Record<string, unknown>;
const emptyRows = (): Record<ImportEntity, Row[]> => Object.fromEntries(IMPORT_ORDER.map((e) => [e, [] as Row[]])) as unknown as Record<ImportEntity, Row[]>;
let rows: Record<ImportEntity, Row[]> = emptyRows();

function push(entity: ImportEntity, row: Row) {
  rows[entity].push(row);
}

function toAoa(data: Record<ImportEntity, Row[]>): Partial<Record<ImportEntity, unknown[][]>> {
  return Object.fromEntries(
    (Object.keys(data) as ImportEntity[]).map((e) => [e, data[e].map((r) => COLUMNS[e].map((c) => r[c.key] ?? ""))]),
  );
}

interface TenantSeed {
  first: string;
  last: string;
  phone: string;
  idType: "national_id" | "passport";
  idNumber: string;
}

function addTenant(opts: Partial<TenantSeed> & { noId?: boolean } = {}): TenantSeed {
  const name = opts.first && opts.last ? { first: opts.first, last: opts.last } : makeName();
  const phone = opts.phone ?? makePhone();
  const idType = opts.idType ?? (chance(0.25) ? "passport" : "national_id");
  const idNumber = opts.noId ? "" : opts.idNumber ?? makeIdNumber(idType);
  const nationality = idType === "passport" && chance(0.4) ? pick(["Syrian", "Egyptian", "French", "Jordanian", "Canadian"]) : "Lebanese";
  push("tenants", {
    first_name: name.first,
    last_name: name.last,
    phone,
    email: `${name.first}.${name.last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@example.com",
    nationality,
    id_type: idType,
    id_number: idNumber,
    occupation: pick(OCCUPATIONS),
    emergency_contact_name: chance(0.7) ? `${pick([...MALE, ...FEMALE])} ${name.last}` : "",
    emergency_contact_phone: chance(0.7) ? makePhone() : "",
    notes: "",
  });
  return { ...name, phone, idType, idNumber };
}

const contractSeq = new Map<string, number>();
function contractNumber(code: string, unit: string): string {
  const key = `${code}-${unit}`;
  const n = (contractSeq.get(key) ?? 0) + 1;
  contractSeq.set(key, n);
  return `${key}-${String(n).padStart(2, "0")}`;
}

interface ContractOpts {
  code: string;
  unit: string;
  phone: string;
  start: string;
  end: string;
  rent: number;
  deposit?: number;
  paymentDay?: string | number;
  method?: string;
  status?: string;
  moveOut?: string;
  pattern?: string;
  notes?: string;
  increase?: string;
  terms?: string;
  decision?: string;
  proposed?: number;
  renewalNotes?: string;
}

function addContract(o: ContractOpts): string {
  const number = contractNumber(o.code, o.unit);
  push("contracts", {
    contract_number: number,
    property_code: o.code,
    unit_number: o.unit,
    tenant_phone: o.phone,
    start_date: o.start,
    end_date: o.end,
    monthly_rent: o.rent,
    deposit: o.deposit ?? o.rent,
    payment_day: o.paymentDay ?? "",
    payment_frequency: "monthly",
    payment_method: o.method ?? pick(["bank_transfer", "bank_transfer", "cash", "cheque"]),
    status: o.status ?? "",
    move_out_date: o.moveOut ?? "",
    rent_increase_clause: o.increase ?? (chance(0.3) ? pick(["5% on renewal", "3% on renewal", "CPI-linked on renewal"]) : ""),
    special_terms: o.terms ?? "",
    renewal_decision: o.decision ?? "",
    proposed_rent: o.proposed ?? "",
    renewal_notes: o.renewalNotes ?? "",
    notes: o.notes ?? "",
    payment_pattern: o.pattern ?? "",
  });
  return number;
}

function addDocument(phone: string, kind: string, title: string, fileName: string, extra: Partial<{ contract: string; issued: string; expiry: string; category: string }> = {}) {
  push("documents", {
    tenant_phone: phone,
    property_code: "",
    asset_name: "",
    kind,
    category: extra.category ?? "",
    title,
    file_name: fileName,
    contract_number: extra.contract ?? "",
    work_order_number: "",
    issued_date: extra.issued ?? "",
    expiry_date: extra.expiry ?? "",
  });
}

function addBuildingDocument(code: string, title: string, fileName: string, category: string, extra: Partial<{ asset: string; issued: string; expiry: string; workOrder: string }> = {}) {
  push("documents", {
    tenant_phone: "",
    property_code: code,
    asset_name: extra.asset ?? "",
    kind: "other",
    category,
    title,
    file_name: fileName,
    contract_number: "",
    work_order_number: extra.workOrder ?? "",
    issued_date: extra.issued ?? "",
    expiry_date: extra.expiry ?? "",
  });
}

function slugFile(first: string, last: string, suffix: string): string {
  return `${first}-${last}`.toLowerCase().replace(/[^a-z]+/g, "-") + `-${suffix}.pdf`;
}

/* ------------------------------ Generation ------------------------------- */

interface UnitPlan {
  code: string;
  number: string;
  floor: number;
  rent: number;
  bedrooms: number;
  size: number;
}

/** What the operations generator needs to know about each building. */
interface BuildingCtx {
  spec: BuildingSpec;
  units: UnitPlan[];
  /** Current tenant per rented unit number. */
  tenants: Map<string, TenantSeed>;
  contractOf: Map<string, string>;
  vacant: Set<string>;
}
const ctxByCode = new Map<string, BuildingCtx>();

/** Expiry offsets (days from today) for the 14 contracts ending within 60d. */
const EXPIRY_OFFSETS: Record<string, number[]> = {
  BH: [12, 23],
  MR: [9, 19, 34, 53],
  DT: [26],
  RG: [38],
  WR: [16, 49],
  VP: [30],
  MV: [58],
};

/** Overdue payments (days overdue) beyond the cast, weighted to Marina. */
const OVERDUE: Record<string, number[]> = { MR: [5, 15, 21, 27, 40, 48], DT: [3, 9], WR: [34] };
const PARTIAL: Record<string, [number, number][]> = { MR: [[6, 400]], DT: [[11, 1500]] };

function generateBuilding(b: BuildingSpec, opts: { cast: boolean; history: boolean }): BuildingCtx {
  push("properties", {
    property_code: b.code,
    name: b.name,
    address: b.address,
    district: b.district,
    city: b.city,
    country: "Lebanon",
    year_built: b.yearBuilt,
    floors: b.floors,
    units_per_floor: b.upf,
    type: b.type ?? "residential",
    status: "active",
    acquisition_date: b.acquired,
    acquisition_cost: b.cost,
    estimated_value: b.value,
    insurance_provider: b.insurer,
    insurance_policy_number: `${b.insurer.split(" ")[0].toUpperCase()}-${between(100000, 999999)}`,
    insurance_expiry: b.insuranceExpiry,
    notes: b.notes ?? "",
  });

  const units: UnitPlan[] = [];
  for (let floor = 1; floor <= b.floors; floor++) {
    for (let pos = 1; pos <= b.upf; pos++) {
      const number = `${b.prefix}${floor}${String(pos).padStart(2, "0")}`;
      const bedrooms = pos === 1 ? 3 : pos === b.upf ? 1 : 2;
      const size = bedrooms === 3 ? between(140, 185) : bedrooms === 2 ? between(95, 130) : between(60, 80);
      const base = b.rent[0] + (b.rent[1] - b.rent[0]) * ((bedrooms - 1) / 2) + (floor / b.floors) * 120;
      const rent = roundTo(base + between(-60, 60), 25);
      const condition = chance(0.8) ? "good" : chance(0.75) ? "fair" : "needs_work";
      push("units", {
        property_code: b.code,
        unit_number: number,
        floor,
        bedrooms,
        bathrooms: bedrooms === 3 ? 2 : 1,
        size_sqm: size,
        furnished: chance(0.35) ? "yes" : "no",
        asking_rent: rent,
        asking_deposit: rent,
        market_rent: roundTo(rent * (1 + between(2, 8) / 100), 25),
        condition,
        status: "",
        notes: "",
      });
      units.push({ code: b.code, number, floor, rent, bedrooms, size });
    }
  }

  // Cast units are never vacant.
  const reserved = new Set<string>();
  if (opts.cast && b.code === "BH") ["403", "502"].forEach((u) => reserved.add(u));
  if (opts.cast && b.code === "MR") ["B704"].forEach((u) => reserved.add(u));

  const vacantSet = new Set<string>();
  if (opts.cast && b.code === "MR") vacantSet.add("B304");
  const pool = units.filter((u) => !reserved.has(u.number) && !vacantSet.has(u.number)).map((u) => u.number);
  while (vacantSet.size < b.vacant) {
    const n = pick(pool);
    vacantSet.add(n);
  }

  const expiry = [...(EXPIRY_OFFSETS[b.code] ?? [])];
  const overdue = opts.history ? [...(OVERDUE[b.code] ?? [])] : [];
  const partial = opts.history ? [...(PARTIAL[b.code] ?? [])] : [];
  const rentedUnits = units.filter((u) => !vacantSet.has(u.number) && !reserved.has(u.number));
  // Shuffle so special roles spread across floors.
  rentedUnits.sort(() => rand() - 0.5);

  // Roles are handed out from opposite ends of the list so "expiring soon"
  // and "overdue" rarely land on the same tenant (Karim is the deliberate one).
  const expiringUnits = new Set(rentedUnits.slice(0, expiry.length).map((u) => u.number));
  const troubleUnits = rentedUnits.slice().reverse();

  let dipLeft = opts.history ? (b.code === "MR" ? 5 : b.code === "DT" ? 3 : b.code === "BH" ? 4 : 3) : 0; // revenue dip 2 months ago
  const tenants = new Map<string, TenantSeed>();
  const contractOf = new Map<string, string>();
  let decisionsLeft = b.code === "MR" ? 1 : 0;

  for (const u of rentedUnits) {
    const tenant = addTenant({ noId: chance(0.035) });
    const endOffset = expiringUnits.has(u.number) ? expiry.shift()! : between(61, 330);
    const months = chance(0.2) ? 24 : 12;
    const start = `today+${endOffset}d-${months}m`;
    const end = `today+${endOffset}d`;

    let paymentDay: string | number = between(1, 28);
    const patterns: string[] = [];

    const trouble = !expiringUnits.has(u.number) && troubleUnits.indexOf(u) < overdue.length + partial.length + 1;
    if (trouble && overdue.length > 0) {
      const d = overdue.shift()!;
      paymentDay = `today-${d}d`;
      patterns.push(`overdue@-${d}`);
    } else if (trouble && partial.length > 0) {
      const [d, paid] = partial.shift()!;
      paymentDay = `today-${d}d`;
      patterns.push(`partial@-${d}:${paid}`);
    } else if (dipLeft > 0 && chance(0.7)) {
      dipLeft--;
      patterns.push(`late@-${between(55, 70)}:${between(26, 34)}`);
    } else if (opts.history && expiringUnits.has(u.number)) {
      // Everyone else expiring soon has slipped once, so Nadine is the one
      // spotless renewal on the list.
      patterns.push(`late@-${between(120, 330)}:${between(2, 5)}`);
    } else if (opts.history && chance(0.18)) {
      patterns.push(`late@-${between(95, 300)}:${between(2, 6)}`);
    }

    // History: half the units renewed the same tenant; the other half had a
    // previous occupant and a short vacancy gap, so last year's occupancy
    // curve has realistic texture.
    if (opts.history && months === 12 && chance(0.9)) {
      if (chance(0.5)) {
        addContract({ code: b.code, unit: u.number, phone: tenant.phone, start: `today+${endOffset}d-24m`, end: `today+${endOffset}d-12m-1d`, rent: roundTo(u.rent * 0.95, 25), status: "renewed", paymentDay: typeof paymentDay === "number" ? paymentDay : "" });
      } else {
        const prev = addTenant();
        const gap = between(0, 45);
        addContract({ code: b.code, unit: u.number, phone: prev.phone, start: `today+${endOffset}d-24m-${gap}d`, end: `today+${endOffset}d-12m-${gap + 1}d`, rent: roundTo(u.rent * 0.93, 25), status: "expired", moveOut: `today+${endOffset}d-12m-${gap + 1}d` });
      }
    }

    // One expiring Marina tenant is not being renewed; a few have a decision pending.
    let decision = "";
    let renewalNotes = "";
    if (expiringUnits.has(u.number) && decisionsLeft > 0 && !trouble) {
      decisionsLeft--;
      decision = "do_not_renew";
      renewalNotes = "Unit to be renovated after move-out";
    } else if (expiringUnits.has(u.number) && chance(0.4)) {
      decision = "awaiting_decision";
    }

    const number = addContract({ code: b.code, unit: u.number, phone: tenant.phone, start, end, rent: u.rent, paymentDay, pattern: patterns.join(" | "), decision, renewalNotes, proposed: decision === "awaiting_decision" ? roundTo(u.rent * 1.05, 25) : undefined });
    tenants.set(u.number, tenant);
    contractOf.set(u.number, number);

    if (chance(0.06)) {
      addDocument(tenant.phone, tenant.idType === "passport" ? "passport" : "id", tenant.idType === "passport" ? "Passport" : "National ID", slugFile(tenant.first, tenant.last, tenant.idType === "passport" ? "passport" : "id"), { issued: `today-${between(2, 8)}y`, expiry: chance(0.3) ? `today+${between(20, 55)}d` : `today+${between(1, 7)}y` });
      if (chance(0.7)) addDocument(tenant.phone, "contract", "Signed contract", `${number}.pdf`, { contract: number, issued: start });
    }
  }

  for (const number of vacantSet) {
    const u = units.find((x) => x.number === number)!;
    if (opts.cast && b.code === "MR" && number === "B304") continue; // handled by cast
    if (!opts.history || chance(0.3)) continue; // never rented
    const prev = addTenant();
    const daysVacant = between(4, 58);
    addContract({ code: b.code, unit: number, phone: prev.phone, start: `today-${daysVacant}d-12m`, end: `today-${daysVacant}d`, rent: roundTo(u.rent * 0.96, 25), status: "expired", moveOut: `today-${daysVacant}d` });
  }

  const ctx: BuildingCtx = { spec: b, units, tenants, contractOf, vacant: vacantSet };
  ctxByCode.set(b.code, ctx);
  return ctx;
}

function generateCast() {
  // Karim Daher — protagonist. BH 403, 2BR, $1,500. Ends today+28d. Overdue 8d.
  const karim = addTenant({ first: "Karim", last: "Daher", phone: "+961 3 612 345", idType: "national_id", idNumber: "LB-2201983" });
  const karimContract = addContract({
    code: "BH", unit: "403", phone: karim.phone, start: "today+28d-12m", end: "today+28d", rent: 1500, paymentDay: "today-8d", method: "bank_transfer",
    pattern: "overdue@-8 | late@-150:5", increase: "5% on renewal", decision: "awaiting_decision", proposed: 1575, renewalNotes: "Wants to stay; asked about a 2-year term",
  });
  addDocument(karim.phone, "id", "National ID", "karim-daher-id.pdf", { issued: "today-4y", expiry: "today+6y" });
  addDocument(karim.phone, "passport", "Passport", "karim-daher-passport.pdf", { issued: "today-3y", expiry: "today+7y" });
  addDocument(karim.phone, "contract", "Signed contract", `${karimContract}.pdf`, { contract: karimContract, issued: "today+28d-12m" });

  // Nadine Khoury — model tenant. BH 502, $2,100. Ends today+45d. Renewed once before.
  const nadine = addTenant({ first: "Nadine", last: "Khoury", phone: "+961 71 345 678", idType: "national_id", idNumber: "LB-1178204" });
  addContract({ code: "BH", unit: "502", phone: nadine.phone, start: "today+45d-24m", end: "today+45d-12m-1d", rent: 2000, paymentDay: 1, method: "bank_transfer", status: "renewed" });
  const nadineContract = addContract({ code: "BH", unit: "502", phone: nadine.phone, start: "today+45d-12m", end: "today+45d", rent: 2100, paymentDay: 1, method: "bank_transfer", increase: "3% on renewal", decision: "renew", proposed: 2160, renewalNotes: "Offer sent — 12 months at $2,160" });
  addDocument(nadine.phone, "id", "National ID", "nadine-khoury-id.pdf", { issued: "today-6y", expiry: "today+4y" });
  addDocument(nadine.phone, "contract", "Signed contract", `${nadineContract}.pdf`, { contract: nadineContract, issued: "today+45d-12m" });

  // Michel Saab — repeat late payer. MR B704, $1,500. Overdue 12d, late 4 of last 6.
  const michel = addTenant({ first: "Michel", last: "Saab", phone: "+961 70 234 567", idType: "national_id", idNumber: "LB-3390417" });
  const michelContract = addContract({
    code: "MR", unit: "B704", phone: michel.phone, start: "today-7m", end: "today+5m", rent: 1500, paymentDay: "today-12d", method: "cash",
    pattern: "overdue@-12 | late@-42:9 | late@-73:6 | late@-103:11",
  });
  addDocument(michel.phone, "id", "National ID", "michel-saab-id.pdf", { issued: "today-2y", expiry: "today+8y" });
  addDocument(michel.phone, "contract", "Signed contract", `${michelContract}.pdf`, { contract: michelContract, issued: "today-7m" });

  // B304 — the empty chair. Vacant 87 days, previous tenant on record.
  const rami = addTenant({ first: "Rami", last: "Abou Jaoude", phone: "+961 76 555 010" });
  const ramiContract = addContract({ code: "MR", unit: "B304", phone: rami.phone, start: "today-87d-12m", end: "today-87d", rent: 1300, paymentDay: 5, status: "expired", moveOut: "today-87d", notes: "Relocated to Dubai" });
  push("deposits", { contract_number: ramiContract, amount_expected: 1300, amount_received: 1300, received_date: "today-87d-12m", deductions: "Repaint living room:250:today-80d", final_refund: 1050, settlement_date: "today-78d", notes: "Refund transferred to tenant's Bank Audi account" });
  push("inspections", { property_code: "MR", unit_number: "B304", tenant_phone: rami.phone, type: "move_out", scheduled_date: "today-87d", completed_date: "today-87d", inspector: "George", status: "completed", overall_result: "attention", items: "Living/Walls:attention:Scuffed walls — repainted, charged to deposit | Kitchen/Appliances:pass | Bathroom/Fixtures:pass | Keys/All keys returned:pass", notes: "Deposit settled after repaint" });

  return { karim, nadine, michel, rami, karimContract, nadineContract, michelContract };
}

/* ------------------------------ Operations -------------------------------- */

interface SupplierSpec {
  name: string;
  category: string;
  phone: string;
  company?: string;
  services: string;
  rating: number | "";
  /** How quickly they respond / complete, in days — used when scripting work orders. */
  response: [number, number];
  completion: [number, number];
  active?: boolean;
}

const SUPPLIERS: SupplierSpec[] = [
  { name: "Schindler Lebanon", category: "elevator", phone: "+961 1 500 200", company: "Schindler", services: "Elevator maintenance, inspections, modernisation", rating: 4.5, response: [1, 2], completion: [1, 3] },
  { name: "Elevatech", category: "elevator", phone: "+961 1 388 110", services: "Elevator repairs", rating: 3, response: [2, 5], completion: [3, 8] },
  { name: "Nakhle Electric", category: "electrical", phone: "+961 3 410 220", services: "Electrical repairs, panels, lighting", rating: 4, response: [1, 2], completion: [1, 2] },
  { name: "Abou Rjeily Plumbing", category: "plumbing", phone: "+961 3 900 100", services: "Plumbing, leaks, water heaters", rating: 3, response: [2, 4], completion: [2, 6] },
  { name: "Khalil & Sons Plumbing", category: "plumbing", phone: "+961 70 880 330", company: "Khalil & Sons", services: "Plumbing, drainage, bathrooms", rating: 4.5, response: [0, 1], completion: [1, 2] },
  { name: "CoolAir HVAC", category: "hvac", phone: "+961 71 640 555", services: "Air conditioning, ventilation, chillers", rating: 4, response: [1, 3], completion: [1, 4] },
  { name: "PowerGen Services", category: "generator", phone: "+961 3 222 909", services: "Generator maintenance, fuel, repairs", rating: 3.5, response: [1, 2], completion: [1, 5] },
  { name: "Bright Clean Co.", category: "cleaning", phone: "+961 76 300 400", services: "Common-area cleaning, glass, deep cleaning", rating: 4, response: [0, 1], completion: [0, 1] },
  { name: "SecureWatch", category: "security", phone: "+961 1 770 700", company: "SecureWatch SAL", services: "Guards, CCTV, access control", rating: 3.5, response: [1, 3], completion: [1, 4] },
  { name: "Beirut Painters", category: "painting", phone: "+961 78 121 121", services: "Painting, plastering, waterproofing", rating: 4, response: [2, 5], completion: [3, 10] },
  { name: "PestAway", category: "pest_control", phone: "+961 70 555 777", services: "Pest control, fumigation", rating: 4, response: [1, 2], completion: [0, 1] },
  { name: "Metn Contractors", category: "general_contractor", phone: "+961 3 656 656", company: "Metn Contractors SARL", services: "Renovations, structural works, kitchens", rating: 3.5, response: [3, 7], completion: [10, 40] },
  { name: "AquaTank Services", category: "other", phone: "+961 71 909 111", services: "Water tank cleaning, pumps", rating: 4, response: [1, 3], completion: [1, 1] },
  { name: "FireSafe Lebanon", category: "other", phone: "+961 1 234 567", services: "Fire systems, extinguishers, certification", rating: 4.5, response: [1, 4], completion: [1, 2] },
];

function generateSuppliers() {
  for (const s of SUPPLIERS) {
    push("suppliers", { name: s.name, category: s.category, phone: s.phone, email: `${s.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`, company: s.company ?? "", services: s.services, rating: s.rating, active: s.active === false ? "no" : "yes", notes: "" });
  }
}

/* Work orders */
let woSeq = 0;
const nextWo = () => `WO-${String(++woSeq).padStart(4, "0")}`;

interface WoOpts {
  code: string;
  unit?: string;
  asset?: string;
  title: string;
  description?: string;
  category: string;
  priority?: string;
  status?: string;
  source?: string;
  reportedDaysAgo: number;
  supplier?: string;
  estimated?: number;
  actual?: number;
  approval?: boolean;
  approvedDaysAgo?: number;
  durationDays?: number;
  repeatOf?: string;
  notes?: string;
  /** Emit a matching expense row for completed work. */
  expense?: boolean;
  invoiceUnpaid?: boolean;
}

const WO_CATEGORY_TO_EXPENSE: Record<string, string> = { plumbing: "plumbing", electrical: "electrical", hvac: "hvac", elevator: "elevator", generator: "generator", appliance: "maintenance", structural: "contractor", painting: "maintenance", cleaning: "cleaning", pest_control: "maintenance", security: "security", water: "water", other: "maintenance" };

function addWorkOrder(o: WoOpts): string {
  const number = nextWo();
  const ctx = ctxByCode.get(o.code)!;
  const tenant = o.unit ? ctx.tenants.get(o.unit) : undefined;
  const status = o.status ?? "closed";
  const done = status === "completed" || status === "closed";
  const supplierSpec = o.supplier ? SUPPLIERS.find((s) => s.name === o.supplier) : undefined;
  const respond = supplierSpec ? between(supplierSpec.response[0], supplierSpec.response[1]) : between(1, 3);
  const duration = o.durationDays ?? (supplierSpec ? between(supplierSpec.completion[0], supplierSpec.completion[1]) : between(1, 4));
  const startedAgo = Math.max(0, o.reportedDaysAgo - respond);
  const completedAgo = Math.max(0, startedAgo - duration);
  const reportedAt = `today-${o.reportedDaysAgo}d`;
  push("workorders", {
    number,
    property_code: o.code,
    unit_number: o.unit ?? "",
    asset_name: o.asset ?? "",
    tenant_phone: tenant?.phone ?? "",
    title: o.title,
    description: o.description ?? "",
    category: o.category,
    priority: o.priority ?? "normal",
    status,
    source: o.source ?? (o.unit ? "tenant" : "owner"),
    reported_at: reportedAt,
    supplier_name: o.supplier ?? "",
    estimated_cost: o.estimated ?? "",
    actual_cost: done ? o.actual ?? o.estimated ?? "" : "",
    approval_required: o.approval ? "yes" : "no",
    approved_at: o.approval && (done || status === "in_progress") ? `today-${o.approvedDaysAgo ?? Math.max(0, o.reportedDaysAgo - 1)}d` : "",
    started_at: done || status === "in_progress" ? `today-${startedAgo}d` : "",
    completed_at: done ? `today-${completedAgo}d` : "",
    closed_at: status === "closed" ? `today-${Math.max(0, completedAgo - 1)}d` : "",
    repeat_of_number: o.repeatOf ?? "",
    notes: o.notes ?? "",
  });
  if (done && (o.expense ?? true) && (o.actual ?? o.estimated)) {
    const amount = o.actual ?? o.estimated!;
    push("expenses", {
      property_code: o.code,
      unit_number: o.unit ?? "",
      supplier_name: o.supplier ?? "",
      category: WO_CATEGORY_TO_EXPENSE[o.category] ?? "maintenance",
      amount,
      expense_date: `today-${completedAgo}d`,
      due_date: `today-${completedAgo}d+30d`,
      payment_status: o.invoiceUnpaid ? "unpaid" : "paid",
      paid_date: o.invoiceUnpaid ? "" : `today-${Math.max(0, completedAgo - between(2, 12))}d`,
      recurring: "no",
      recurrence: "",
      description: `${o.title} (${number})`,
      classification: "operating",
      invoice_number: `INV-${between(10000, 99999)}`,
      work_order_number: number,
      renovation_title: "",
      asset_name: o.asset ?? "",
      notes: "",
    });
  }
  return number;
}

const ISSUES: Record<string, { titles: string[]; cost: [number, number]; suppliers: string[] }> = {
  plumbing: { titles: ["Kitchen sink leaking", "Bathroom drain blocked", "Water heater not heating", "Toilet flush running", "Shower mixer dripping", "Low water pressure"], cost: [80, 350], suppliers: ["Abou Rjeily Plumbing", "Khalil & Sons Plumbing"] },
  electrical: { titles: ["Power outage in living room", "Kitchen sockets dead", "Corridor lights flickering", "Circuit breaker tripping", "Doorbell not working"], cost: [60, 400], suppliers: ["Nakhle Electric"] },
  hvac: { titles: ["AC not cooling", "AC unit leaking water", "Ventilation fan noisy", "Thermostat faulty"], cost: [150, 900], suppliers: ["CoolAir HVAC"] },
  appliance: { titles: ["Oven not igniting", "Washing machine leaking", "Fridge not cooling", "Extractor hood broken"], cost: [50, 300], suppliers: ["Nakhle Electric"] },
  painting: { titles: ["Damp patch on bedroom wall", "Ceiling paint peeling", "Balcony wall cracks"], cost: [200, 1200], suppliers: ["Beirut Painters"] },
  structural: { titles: ["Balcony railing loose", "Front door frame damaged", "Roof leak into stairwell"], cost: [500, 3000], suppliers: ["Metn Contractors"] },
  security: { titles: ["Entrance intercom faulty", "Parking gate stuck open", "CCTV camera offline"], cost: [100, 500], suppliers: ["SecureWatch"] },
  pest_control: { titles: ["Cockroaches in kitchen", "Ants on balcony"], cost: [80, 150], suppliers: ["PestAway"] },
  cleaning: { titles: ["Garage flooding after rain", "Post-tenant deep clean"], cost: [50, 200], suppliers: ["Bright Clean Co."] },
  water: { titles: ["Water tank overflow", "Main pipe leak in basement"], cost: [100, 600], suppliers: ["AquaTank Services", "Khalil & Sons Plumbing"] },
};

function randomWorkOrders(ctx: BuildingCtx, count: number) {
  const rented = [...ctx.tenants.keys()];
  const categories = Object.keys(ISSUES);
  for (let i = 0; i < count; i++) {
    const category = pick(categories);
    const spec = ISSUES[category];
    const unit = chance(0.75) ? pick(rented) : undefined;
    const reportedDaysAgo = between(3, 180);
    const priority = chance(0.12) ? "high" : chance(0.15) ? "low" : "normal";
    const cost = roundTo(between(spec.cost[0], spec.cost[1]), 5);
    addWorkOrder({
      code: ctx.spec.code,
      unit,
      title: pick(spec.titles),
      category,
      priority,
      status: chance(0.85) ? "closed" : "completed",
      reportedDaysAgo,
      supplier: pick(spec.suppliers),
      estimated: chance(0.6) ? cost : undefined,
      actual: roundTo(cost * (0.9 + rand() * 0.25), 5),
      approval: cost > 400,
    });
  }
}

/* Assets & preventive plans */
interface AssetSpec {
  type: string;
  name: string;
  manufacturer: string;
  model: string;
  cost: number;
  plans: { type: string; months: number; cost: number; supplier: string; next?: number; last?: number }[];
  supplier: string;
  warranty?: string;
  status?: string;
  lastService?: string;
}

function buildingAssets(b: BuildingSpec): AssetSpec[] {
  const list: AssetSpec[] = [];
  const elevators = b.floors >= 8 ? 2 : 1;
  for (let i = 1; i <= elevators; i++) {
    list.push({ type: "elevator", name: `Elevator ${i}`, manufacturer: "Schindler", model: "3300", cost: 48000, supplier: "Schindler Lebanon", plans: [{ type: "Elevator service", months: 3, cost: 350, supplier: "Schindler Lebanon" }, { type: "Elevator safety certification", months: 12, cost: 600, supplier: "Schindler Lebanon" }] });
  }
  list.push({ type: "generator", name: "Generator", manufacturer: "Perkins", model: `P${between(100, 400)}`, cost: 32000, supplier: "PowerGen Services", plans: [{ type: "Generator service", months: 6, cost: 400, supplier: "PowerGen Services" }] });
  list.push({ type: "water_pump", name: "Water pump", manufacturer: "Grundfos", model: "CR 10", cost: 4200, supplier: "AquaTank Services", plans: [{ type: "Pump inspection", months: 6, cost: 120, supplier: "AquaTank Services" }] });
  list.push({ type: "water_tank", name: "Roof water tank", manufacturer: "Sidem", model: "10m³", cost: 3800, supplier: "AquaTank Services", plans: [{ type: "Tank cleaning", months: 6, cost: 180, supplier: "AquaTank Services" }] });
  list.push({ type: "fire_system", name: "Fire alarm & extinguishers", manufacturer: "Honeywell", model: "Notifier", cost: 9500, supplier: "FireSafe Lebanon", plans: [{ type: "Fire system inspection", months: 12, cost: 450, supplier: "FireSafe Lebanon" }] });
  list.push({ type: "cctv", name: "CCTV system", manufacturer: "Hikvision", model: "DS-7616", cost: 3200, supplier: "SecureWatch", plans: [{ type: "CCTV check", months: 12, cost: 150, supplier: "SecureWatch" }] });
  list.push({ type: "electrical_panel", name: "Main electrical panel", manufacturer: "Schneider", model: "Prisma", cost: 6800, supplier: "Nakhle Electric", plans: [{ type: "Panel thermal inspection", months: 12, cost: 200, supplier: "Nakhle Electric" }] });
  if (b.parking > 0) list.push({ type: "parking_gate", name: "Parking gate", manufacturer: "CAME", model: "BX-74", cost: 2400, supplier: "SecureWatch", plans: [{ type: "Gate motor service", months: 12, cost: 120, supplier: "SecureWatch" }] });
  if (b.code === "DT") list.push({ type: "hvac", name: "Central chiller", manufacturer: "Carrier", model: "30RB", cost: 41000, supplier: "CoolAir HVAC", plans: [{ type: "Chiller service", months: 3, cost: 550, supplier: "CoolAir HVAC" }] });
  return list;
}

function generateAssets(ctx: BuildingCtx) {
  const b = ctx.spec;
  for (const a of buildingAssets(b)) {
    const installYear = a.type === "cctv" || a.type === "fire_system" ? b.yearBuilt + between(2, 8) : b.yearBuilt;
    let warranty = a.warranty ?? (chance(0.4) ? `today+${between(3, 30)}m` : `today-${between(6, 40)}m`);
    let status = a.status ?? "operational";
    let lastService = a.lastService ?? `today-${between(20, 150)}d`;
    // Scripted trouble spots.
    if (b.code === "MR" && a.name === "Generator") warranty = "today+20d";
    if (b.code === "DT" && a.type === "hvac") warranty = "today-10d";
    if (b.code === "MR" && a.name === "Elevator 2") status = "degraded";
    if (b.code === "WR" && a.type === "generator") {
      status = "out_of_service";
      lastService = "today-95d";
    }
    push("assets", {
      property_code: b.code,
      unit_number: "",
      asset_type: a.type,
      name: a.name,
      manufacturer: a.manufacturer,
      model: a.model,
      serial_number: `${a.manufacturer.slice(0, 3).toUpperCase()}-${between(100000, 999999)}`,
      installation_date: `${Math.min(installYear, 2025)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`,
      purchase_cost: a.cost,
      warranty_expiry: warranty,
      supplier_name: a.supplier,
      status,
      last_service_date: lastService,
      qr_code: "",
      notes: "",
    });
    for (const p of a.plans) {
      let next = p.next ?? between(15, 200);
      let last = p.last ?? Math.max(1, p.months * 30 - next);
      if (b.code === "MR" && a.name === "Elevator 1" && p.type === "Elevator service") {
        next = -18;
        last = 108;
      }
      if (b.code === "RG" && a.name === "Elevator 1" && p.type === "Elevator safety certification") {
        next = -40;
        last = 405;
      }
      if (b.code === "DT" && a.type === "fire_system") next = 10;
      if (b.code === "BH" && a.name === "Roof water tank") next = 6;
      if (b.code === "WR" && a.type === "generator") {
        next = 85;
        last = 95;
      }
      push("plans", {
        property_code: b.code,
        asset_name: a.name,
        maintenance_type: p.type,
        recurrence_months: p.months,
        last_service_date: `today-${last}d`,
        next_service_date: next < 0 ? `today-${-next}d` : `today+${next}d`,
        supplier_name: p.supplier,
        estimated_cost: p.cost,
        status: "active",
        reminder_days: 14,
        notes: "",
      });
      // Past services show up as expenses.
      if (last < 200) {
        push("expenses", {
          property_code: b.code,
          unit_number: "",
          supplier_name: p.supplier,
          category: a.type === "elevator" ? "elevator" : a.type === "generator" ? "generator" : a.type === "hvac" ? "hvac" : "maintenance",
          amount: p.cost,
          expense_date: `today-${last}d`,
          due_date: `today-${last}d+30d`,
          payment_status: "paid",
          paid_date: `today-${Math.max(0, last - between(3, 20))}d`,
          recurring: "yes",
          recurrence: p.months === 3 ? "quarterly" : p.months === 6 ? "semi_annual" : "annual",
          description: `${p.type} — ${a.name}`,
          classification: "operating",
          invoice_number: `INV-${between(10000, 99999)}`,
          work_order_number: "",
          renovation_title: "",
          asset_name: a.name,
          notes: "",
        });
      }
    }
  }
  // Building-level plan without an asset.
  push("plans", { property_code: b.code, asset_name: "", maintenance_type: "Pest control treatment", recurrence_months: 3, last_service_date: `today-${between(30, 80)}d`, next_service_date: `today+${between(10, 60)}d`, supplier_name: "PestAway", estimated_cost: 120, status: "active", reminder_days: 7, notes: "Common areas and garbage room" });
  // Certificates on the elevators / fire system.
  addBuildingDocument(b.code, "Elevator safety certificate", `${b.code.toLowerCase()}-elevator-1-certificate.pdf`, "certificate", { asset: "Elevator 1", issued: "today-11m", expiry: b.code === "MR" ? "today+25d" : b.code === "RG" ? "today-40d" : `today+${between(2, 11)}m` });
  addBuildingDocument(b.code, "Fire system compliance certificate", `${b.code.toLowerCase()}-fire-certificate.pdf`, "certificate", { asset: "Fire alarm & extinguishers", issued: "today-10m", expiry: `today+${between(1, 8)}m` });
  addBuildingDocument(b.code, `${b.insurer} building policy`, `${b.code.toLowerCase()}-insurance-policy.pdf`, "insurance", { issued: "today-8m", expiry: b.insuranceExpiry });
  addBuildingDocument(b.code, "Title deed", `${b.code.toLowerCase()}-title-deed.pdf`, "ownership", { issued: b.acquired });
}

/* Recurring operating expenses, budgets, utilities, charges */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (monthsAgo: number): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
};

function recurring(ctx: BuildingCtx, category: string, description: string, supplier: string, base: number, opts: { monthsAgo: number; jitter?: number; extra?: number; unpaid?: boolean; dueIn?: number }) {
  const b = ctx.spec;
  const amount = roundTo(base * (1 + ((opts.jitter ?? 0.1) * (rand() * 2 - 1))) + (opts.extra ?? 0), 5);
  const m = opts.monthsAgo;
  push("expenses", {
    property_code: b.code,
    unit_number: "",
    supplier_name: supplier,
    category,
    amount,
    expense_date: m === 0 ? `today-${between(1, 4)}d` : `today-${m}m`,
    due_date: opts.dueIn !== undefined ? `today+${opts.dueIn}d` : m === 0 ? `today+${between(10, 25)}d` : `today-${m}m+30d`,
    payment_status: opts.unpaid ? "unpaid" : m === 0 ? "scheduled" : "paid",
    paid_date: opts.unpaid || m === 0 ? "" : `today-${m}m+${between(5, 25)}d`,
    recurring: "yes",
    recurrence: "monthly",
    description: `${description} — ${monthLabel(m)}`,
    classification: "operating",
    invoice_number: `INV-${between(10000, 99999)}`,
    work_order_number: "",
    renovation_title: "",
    asset_name: "",
    notes: "",
  });
  return amount;
}

function generateFinance(ctx: BuildingCtx) {
  const b = ctx.spec;
  const size = ctx.units.length;
  const staffed = ["BH", "MR", "DT"].includes(b.code);
  const spendByCategory = new Map<string, number>();
  const add = (cat: string, amt: number) => spendByCategory.set(cat, (spendByCategory.get(cat) ?? 0) + amt);

  for (let m = 11; m >= 0; m--) {
    const summer = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      const mo = d.getMonth();
      return mo >= 5 && mo <= 8;
    })();
    // Escalating generator + repair costs at Verdun Plaza for the last three complete months.
    const vpExtra = b.code === "VP" ? (m === 3 ? 0 : m === 2 ? 320 : m === 1 ? 760 : 0) : 0;
    add("cleaning", recurring(ctx, "cleaning", "Common-area cleaning", "Bright Clean Co.", 180 + size * 9, { monthsAgo: m, jitter: 0.06, extra: b.code === "BH" && m === 0 ? 70 : 0 }));
    add("electricity", recurring(ctx, "electricity", "Common-area electricity (EDL)", "", 90 + size * 4 + (summer ? 60 : 0), { monthsAgo: m, jitter: 0.12 }));
    add("water", recurring(ctx, "water", "Water authority", "", 60 + size * 2.5, { monthsAgo: m, jitter: 0.08 }));
    add("generator", recurring(ctx, "generator", "Generator fuel", "PowerGen Services", 160 + size * 8 + (summer ? 140 : 0), { monthsAgo: m, jitter: 0.15, extra: vpExtra }));
    if (staffed) add("staff", recurring(ctx, "staff", "Concierge salary", "", b.code === "DT" ? 900 : 650, { monthsAgo: m, jitter: 0 }));
    if (b.code === "DT" || b.code === "BH") add("security", recurring(ctx, "security", "Night security", "SecureWatch", b.code === "DT" ? 1100 : 700, { monthsAgo: m, jitter: 0.02 }));
  }
  // Annual items.
  push("expenses", { property_code: b.code, unit_number: "", supplier_name: "", category: "insurance", amount: roundTo(b.value * 0.0012, 50), expense_date: "today-4m", due_date: "today-4m", payment_status: "paid", paid_date: "today-4m", recurring: "yes", recurrence: "annual", description: `${b.insurer} building policy renewal`, classification: "operating", invoice_number: `POL-${between(10000, 99999)}`, work_order_number: "", renovation_title: "", asset_name: "", notes: "" });
  add("insurance", roundTo(b.value * 0.0012, 50));
  push("expenses", { property_code: b.code, unit_number: "", supplier_name: "", category: "municipality", amount: roundTo(size * 95, 50), expense_date: "today-6m", due_date: "today-6m+30d", payment_status: "paid", paid_date: "today-6m+18d", recurring: "yes", recurrence: "annual", description: "Municipality fees", classification: "operating", invoice_number: "", work_order_number: "", renovation_title: "", asset_name: "", notes: "" });
  add("municipality", roundTo(size * 95, 50));

  // Yearly budgets per category: generous everywhere except the scripted over-budget lines.
  const yearShare = (new Date().getMonth() + 1) / 12;
  for (const [cat, spend] of spendByCategory) {
    const annualised = spend / Math.max(yearShare, 0.5);
    push("budgets", { property_code: b.code, period: "year", category: cat, amount: roundTo(annualised * (1.12 + rand() * 0.2), 50), notes: "" });
  }
  push("budgets", { property_code: b.code, period: "year", category: "maintenance", amount: roundTo(size * 260, 100), notes: "" });
  push("budgets", { property_code: b.code, period: "year", category: "electrical", amount: roundTo(size * 70, 50), notes: "" });
  push("budgets", { property_code: b.code, period: "year", category: "elevator", amount: roundTo((b.floors >= 8 ? 2 : 1) * 2600, 100), notes: "" });
  push("budgets", { property_code: b.code, period: "year", category: "plumbing", amount: b.code === "MR" ? 1200 : roundTo(size * 90, 50), notes: b.code === "MR" ? "Set before the B402 leak saga" : "" });
  if (b.code === "BH") push("budgets", { property_code: b.code, period: "today", category: "cleaning", amount: 450, notes: "Monthly cleaning cap" });
  if (b.code === "MR") push("budgets", { property_code: b.code, period: "today", category: "generator", amount: 900, notes: "" });

  // Meters: building electricity + water, unit meters in the two flagship buildings.
  push("meters", { property_code: b.code, unit_number: "", utility_type: "electricity", meter_number: `EDL-${b.code}-COMMON`, billing_method: "metered", unit_rate: 0.11, unit_label: "kWh" });
  push("meters", { property_code: b.code, unit_number: "", utility_type: "water", meter_number: `WAT-${b.code}-MAIN`, billing_method: "metered", unit_rate: 1.4, unit_label: "m³" });
  push("meters", { property_code: b.code, unit_number: "", utility_type: "generator", meter_number: `GEN-${b.code}`, billing_method: "metered", unit_rate: 0.32, unit_label: "kWh" });
  let elec = between(40000, 90000);
  let water = between(3000, 9000);
  let gen = between(10000, 30000);
  for (let m = 6; m >= 0; m--) {
    const e = between(600, 1400) + size * 12;
    const w = between(80, 160) + size * 4;
    const g = between(900, 2200) + size * 15;
    push("readings", { meter_number: `EDL-${b.code}-COMMON`, reading_date: `today-${m}m`, previous_reading: elec, current_reading: elec + e, meter_reset: "no", note: "" });
    push("readings", { meter_number: `WAT-${b.code}-MAIN`, reading_date: `today-${m}m`, previous_reading: water, current_reading: water + w, meter_reset: "no", note: "" });
    push("readings", { meter_number: `GEN-${b.code}`, reading_date: `today-${m}m`, previous_reading: gen, current_reading: gen + g, meter_reset: "no", note: "" });
    elec += e;
    water += w;
    gen += g;
  }
  if (b.code === "DT" || b.code === "BH") {
    for (const u of ctx.units) {
      const number = `EDL-${b.code}-${u.number}`;
      push("meters", { property_code: b.code, unit_number: u.number, utility_type: "electricity", meter_number: number, billing_method: "metered", unit_rate: 0.11, unit_label: "kWh" });
      let r = between(8000, 30000);
      for (let m = 2; m >= 0; m--) {
        const use = ctx.tenants.has(u.number) ? between(180, 520) : between(0, 15);
        push("readings", { meter_number: number, reading_date: `today-${m}m`, previous_reading: r, current_reading: r + use, meter_reset: "no", note: "" });
        r += use;
      }
    }
  }

  // Common charges for the last two months.
  const rented = [...ctx.tenants.keys()];
  for (const m of [1, 0]) {
    const paidShare = m === 1 ? 0.75 : 0.3;
    for (const [category, total] of [["generator", 160 + size * 8 + 100], ["cleaning", 180 + size * 9], ["elevator", 120 + size * 3]] as [string, number][]) {
      const paid = rented.filter(() => chance(paidShare));
      push("charges", { property_code: b.code, period: m === 0 ? "today" : "today-1m", category, total_amount: roundTo(total, 5), allocation_method: category === "elevator" ? "equal" : "by_area", paid_units: paid.join(", "), notes: "" });
    }
  }
}

/* Maintenance history per building */
function generateMaintenance(ctx: BuildingCtx) {
  const b = ctx.spec;
  randomWorkOrders(ctx, b.code === "MR" ? 8 : b.code === "BH" ? 6 : b.code === "DT" ? 5 : 4);
  const rented = [...ctx.tenants.keys()];

  // A few things still open everywhere.
  addWorkOrder({ code: b.code, unit: pick(rented), title: pick(ISSUES.electrical.titles), category: "electrical", status: "assigned", reportedDaysAgo: between(1, 6), supplier: "Nakhle Electric", estimated: roundTo(between(80, 300), 5) });
  if (chance(0.6)) addWorkOrder({ code: b.code, unit: pick(rented), title: pick(ISSUES.hvac.titles), category: "hvac", status: "awaiting_quote", reportedDaysAgo: between(2, 9), supplier: "CoolAir HVAC" });

  switch (b.code) {
    case "MR": {
      // B402: the recurring plumbing problem — four work orders in 90 days, same supplier.
      const unit = rented.includes("B402") ? "B402" : rented[0];
      const w1 = addWorkOrder({ code: "MR", unit, title: "Bathroom drain blocked", description: "Tenant reports slow drain and gurgling", category: "plumbing", reportedDaysAgo: 82, supplier: "Abou Rjeily Plumbing", estimated: 150, actual: 180 });
      const w2 = addWorkOrder({ code: "MR", unit, title: "Bathroom drain blocked again", description: "Same drain — snake cleared it", category: "plumbing", reportedDaysAgo: 55, supplier: "Abou Rjeily Plumbing", estimated: 150, actual: 240, repeatOf: w1 });
      const w3 = addWorkOrder({ code: "MR", unit, title: "Water backing up in bathroom", description: "Third visit; suspected broken stack pipe", category: "plumbing", reportedDaysAgo: 28, supplier: "Abou Rjeily Plumbing", estimated: 300, actual: 320, repeatOf: w2 });
      addWorkOrder({ code: "MR", unit, title: "Bathroom drain — replace stack section", description: "Camera inspection recommended; quote for stack replacement", category: "plumbing", priority: "high", status: "awaiting_approval", reportedDaysAgo: 4, supplier: "Khalil & Sons Plumbing", estimated: 1450, approval: true, repeatOf: w3 });
      addWorkOrder({ code: "MR", asset: "Elevator 2", title: "Elevator 2 door sensor intermittent", description: "Doors reopen randomly; running at reduced speed", category: "elevator", priority: "high", status: "in_progress", reportedDaysAgo: 9, supplier: "Elevatech", estimated: 900, approval: true, approvedDaysAgo: 7 });
      addWorkOrder({ code: "MR", asset: "Elevator 2", title: "Elevator 2 stuck between floors", category: "elevator", priority: "emergency", reportedDaysAgo: 47, supplier: "Elevatech", estimated: 600, actual: 780 });
      addWorkOrder({ code: "MR", asset: "Elevator 2", title: "Elevator 2 noisy motor", category: "elevator", reportedDaysAgo: 120, supplier: "Elevatech", estimated: 400, actual: 520 });
      break;
    }
    case "BH": {
      addWorkOrder({ code: "BH", unit: rented.includes("205") ? "205" : rented[1], title: "Balcony door lock broken", description: "Cannot lock the balcony door", category: "structural", status: "assigned", reportedDaysAgo: 22, supplier: "Metn Contractors", estimated: 260, notes: "Contractor keeps postponing" });
      addWorkOrder({ code: "BH", unit: "403", title: "Kitchen tap dripping", category: "plumbing", reportedDaysAgo: 140, supplier: "Khalil & Sons Plumbing", estimated: 90, actual: 90 });
      addWorkOrder({ code: "BH", unit: "502", title: "Bedroom AC not cooling", category: "hvac", reportedDaysAgo: 75, supplier: "CoolAir HVAC", estimated: 220, actual: 210 });
      break;
    }
    case "WR": {
      addWorkOrder({ code: "WR", asset: "Generator", title: "Generator failed to start during outage", description: "Building without backup power; starter motor and controller suspected", category: "generator", priority: "emergency", status: "awaiting_approval", source: "owner", reportedDaysAgo: 2, supplier: "PowerGen Services", estimated: 2400, approval: true });
      addWorkOrder({ code: "WR", asset: "Generator", title: "Generator emergency repair — fuel pump", description: "Replaced fuel pump after breakdown", category: "generator", priority: "emergency", reportedDaysAgo: 8, supplier: "PowerGen Services", estimated: 1800, actual: 2100, approval: true, approvedDaysAgo: 7, invoiceUnpaid: true });
      break;
    }
    case "DT": {
      addWorkOrder({ code: "DT", asset: "Central chiller", title: "Chiller compressor 2 tripping", category: "hvac", priority: "high", status: "in_progress", reportedDaysAgo: 5, supplier: "CoolAir HVAC", estimated: 1300, approval: true, approvedDaysAgo: 3 });
      addWorkOrder({ code: "DT", asset: "Parking gate", title: "Parking gate stuck open", category: "security", reportedDaysAgo: 33, supplier: "SecureWatch", estimated: 180, actual: 195 });
      break;
    }
    case "RG": {
      addWorkOrder({ code: "RG", unit: pick(rented), title: "Roof leak into stairwell", category: "structural", priority: "high", status: "awaiting_quote", reportedDaysAgo: 11, supplier: "Beirut Painters", notes: "Waterproofing quote requested" });
      break;
    }
    case "VP": {
      addWorkOrder({ code: "VP", asset: "Generator", title: "Generator overheating", category: "generator", reportedDaysAgo: 40, supplier: "PowerGen Services", estimated: 450, actual: 520 });
      addWorkOrder({ code: "VP", asset: "Generator", title: "Generator radiator replacement", category: "generator", reportedDaysAgo: 18, supplier: "PowerGen Services", estimated: 900, actual: 980, approval: true, invoiceUnpaid: true });
      break;
    }
    default:
      break;
  }
  // An unpaid electrician invoice that is now overdue.
  if (b.code === "MV") addWorkOrder({ code: "MV", unit: pick(rented), title: "Circuit breaker tripping", category: "electrical", reportedDaysAgo: 48, supplier: "Nakhle Electric", estimated: 400, actual: 420, invoiceUnpaid: true });
}

/* Inspections, renovations, parking, keys */
function generateOperations(ctx: BuildingCtx, cast: ReturnType<typeof generateCast> | null) {
  const b = ctx.spec;
  const rented = [...ctx.tenants.keys()];

  // Annual building inspection (one overdue at Waterfront).
  if (b.code === "WR") {
    push("inspections", { property_code: b.code, unit_number: "", asset_name: "", tenant_phone: "", type: "building", scheduled_date: "today-10d", completed_date: "", inspector: "George", status: "scheduled", overall_result: "", items: "", notes: "Annual walk-through — postponed twice" });
  } else {
    const ago = between(30, 150);
    push("inspections", { property_code: b.code, unit_number: "", asset_name: "", tenant_phone: "", type: "building", scheduled_date: `today-${ago}d`, completed_date: `today-${ago}d`, inspector: "George", status: "completed", overall_result: chance(0.7) ? "pass" : "attention", items: "Entrance/Lighting:pass | Stairwell/Handrails:pass | Roof/Drainage:pass | Garage/Signage:attention:Faded markings | Garbage room/Doors:pass", notes: "" });
  }
  if (b.code === "DT") push("inspections", { property_code: "DT", unit_number: "", asset_name: "Fire alarm & extinguishers", tenant_phone: "", type: "safety", scheduled_date: "today+20d", completed_date: "", inspector: "FireSafe Lebanon", status: "scheduled", overall_result: "", items: "", notes: "Annual certification visit" });
  if (b.code === "MR") {
    const unit = rented.includes("B402") ? "B402" : rented[0];
    push("inspections", { property_code: "MR", unit_number: unit, asset_name: "", tenant_phone: ctx.tenants.get(unit)?.phone ?? "", type: "annual_unit", scheduled_date: "today-12d", completed_date: "today-12d", inspector: "George", status: "completed", overall_result: "fail", items: "Bathroom/Sink drain:fail!:Slow drain, recurring — stack pipe suspected | Kitchen/Faucet:attention:Minor drip | Bedroom/Windows:pass | Living/Walls:pass | Balcony/Railing:pass", notes: "Tenant frustrated with repeat plumbing visits" });
  }
  // Move-in inspections for the cast and a handful of tenants.
  if (cast && b.code === "BH") {
    push("inspections", { property_code: "BH", unit_number: "403", asset_name: "", tenant_phone: cast.karim.phone, type: "move_in", scheduled_date: "today+28d-12m", completed_date: "today+28d-12m", inspector: "George", status: "completed", overall_result: "pass", items: "Kitchen/Appliances:pass | Bathroom/Fixtures:pass | Living/Walls:pass | Bedroom/Flooring:pass | Keys/2 keys + 1 card issued:pass", notes: "" });
    push("inspections", { property_code: "BH", unit_number: "502", asset_name: "", tenant_phone: cast.nadine.phone, type: "move_in", scheduled_date: "today+45d-24m", completed_date: "today+45d-24m", inspector: "George", status: "completed", overall_result: "pass", items: "Kitchen/Appliances:pass | Bathroom/Fixtures:pass | Living/Walls:pass | Keys/2 keys + 1 card issued:pass", notes: "" });
  }
  if (cast && b.code === "MR") {
    push("inspections", { property_code: "MR", unit_number: "B704", asset_name: "", tenant_phone: cast.michel.phone, type: "move_in", scheduled_date: "today-7m", completed_date: "today-7m", inspector: "George", status: "completed", overall_result: "attention", items: "Kitchen/Appliances:pass | Bathroom/Fixtures:attention:Old silicone | Living/Walls:pass | Keys/2 keys issued:pass", notes: "" });
  }
  for (const unit of rented.filter(() => chance(0.12))) {
    const ago = between(20, 200);
    push("inspections", { property_code: b.code, unit_number: unit, asset_name: "", tenant_phone: ctx.tenants.get(unit)?.phone ?? "", type: "annual_unit", scheduled_date: `today-${ago}d`, completed_date: `today-${ago}d`, inspector: "George", status: "completed", overall_result: chance(0.8) ? "pass" : "attention", items: "Kitchen/Appliances:pass | Bathroom/Fixtures:pass | Living/Walls:pass | Bedroom/Windows:pass", notes: "" });
  }

  // Renovations.
  if (b.code === "MR") {
    push("renovations", { property_code: "MR", unit_number: "", title: "Lobby modernisation", description: "New reception desk, lighting, marble repair and mailboxes", project_type: "upgrade", budget: 18000, contractor_name: "Metn Contractors", start_date: "today-70d", target_end_date: "today-10d", actual_end_date: "", status: "in_progress", progress_percent: "", tasks: "Demolition:done | Electrical rough-in:done | Marble repair:done | Lighting | Reception desk & mailboxes", notes: "Marble supplier delayed the stone by three weeks" });
    for (const [desc, amount, ago] of [["Lobby — demolition & rubbish removal", 3200, 62], ["Lobby — electrical works", 4600, 40], ["Lobby — marble supply and repair", 12700, 12]] as [string, number, number][]) {
      push("expenses", { property_code: "MR", unit_number: "", supplier_name: "Metn Contractors", category: "renovation", amount, expense_date: `today-${ago}d`, due_date: `today-${ago}d+30d`, payment_status: ago < 20 ? "unpaid" : "paid", paid_date: ago < 20 ? "" : `today-${ago - 10}d`, recurring: "no", recurrence: "", description: desc, classification: "capex", invoice_number: `MC-${between(1000, 9999)}`, work_order_number: "", renovation_title: "Lobby modernisation", asset_name: "", notes: "" });
    }
    // The unit being renovated after its tenant left.
    const renovating = [...ctx.vacant].find((u) => u !== "B304");
    if (renovating) {
      const row = rows.units.find((u) => u.property_code === "MR" && u.unit_number === renovating);
      if (row) {
        row.status = "renovation";
        row.condition = "needs_work";
      }
      push("renovations", { property_code: "MR", unit_number: renovating, title: `${renovating} full refurbishment`, description: "Kitchen, bathroom and flooring before re-letting", project_type: "renovation", budget: 11000, contractor_name: "Metn Contractors", start_date: "today-15d", target_end_date: "today+35d", actual_end_date: "", status: "in_progress", progress_percent: "", tasks: "Strip-out:done | Plumbing:done | Tiling | Kitchen install | Painting", notes: "" });
      push("expenses", { property_code: "MR", unit_number: renovating, supplier_name: "Metn Contractors", category: "renovation", amount: 4200, expense_date: "today-9d", due_date: "today+21d", payment_status: "unpaid", paid_date: "", recurring: "no", recurrence: "", description: `${renovating} refurbishment — first instalment`, classification: "capex", invoice_number: `MC-${between(1000, 9999)}`, work_order_number: "", renovation_title: `${renovating} full refurbishment`, asset_name: "", notes: "" });
    }
  }
  if (b.code === "BH") push("renovations", { property_code: "BH", unit_number: "", title: "Rooftop waterproofing", description: "Membrane replacement over the top floor", project_type: "repair", budget: 9500, contractor_name: "Beirut Painters", start_date: "today+20d", target_end_date: "today+50d", actual_end_date: "", status: "planned", progress_percent: 0, tasks: "Survey | Membrane removal | New membrane | Drainage test", notes: "Before the rainy season" });
  if (b.code === "VP") {
    const unit = rented.includes("302") ? "302" : rented[2];
    push("renovations", { property_code: "VP", unit_number: unit, title: `${unit} kitchen refit`, description: "New cabinets, counter and appliances", project_type: "upgrade", budget: 7000, contractor_name: "Metn Contractors", start_date: "today-5m", target_end_date: "today-4m", actual_end_date: "today-4m+5d", status: "completed", progress_percent: 100, tasks: "Demolition:done | Cabinets:done | Counter:done | Appliances:done", notes: "" });
    push("expenses", { property_code: "VP", unit_number: unit, supplier_name: "Metn Contractors", category: "renovation", amount: 6800, expense_date: "today-4m+5d", due_date: "today-4m+35d", payment_status: "paid", paid_date: "today-4m+20d", recurring: "no", recurrence: "", description: `${unit} kitchen refit — final invoice`, classification: "capex", invoice_number: `MC-${between(1000, 9999)}`, work_order_number: "", renovation_title: `${unit} kitchen refit`, asset_name: "", notes: "" });
  }

  // Parking.
  if (b.parking > 0) {
    const assignable = rented.slice();
    for (let i = 1; i <= b.parking; i++) {
      const space = `P-${String(i).padStart(2, "0")}`;
      const unit = i <= Math.min(assignable.length, Math.round(b.parking * 0.8)) ? assignable[i - 1] : null;
      const tenant = unit ? ctx.tenants.get(unit) : undefined;
      const paid = b.code === "DT";
      push("parking", { property_code: b.code, space_number: space, unit_number: unit ?? "", tenant_phone: tenant?.phone ?? "", vehicle_plate: unit ? `${pick(["B", "G", "M", "N"])} ${between(10000, 999999)}` : "", paid: paid ? "yes" : "no", monthly_fee: paid ? 75 : 0, status: unit ? "assigned" : i === b.parking ? "reserved" : "free", notes: "" });
    }
  }

  // Keys: every rented unit has issued keys; the office holds spares; one lost.
  for (const unit of rented) {
    const tenant = ctx.tenants.get(unit)!;
    push("keys", { property_code: b.code, unit_number: unit, type: "apartment_key", identifier: `${b.code}-${unit}-K1`, assigned_to: "", tenant_phone: tenant.phone, issued_date: `today-${between(30, 700)}d`, returned_date: "", status: "issued", notes: "" });
    if (b.code === "DT" || b.code === "BH") push("keys", { property_code: b.code, unit_number: unit, type: "access_card", identifier: `${b.code}-${unit}-C1`, assigned_to: "", tenant_phone: tenant.phone, issued_date: `today-${between(30, 700)}d`, returned_date: "", status: "issued", notes: "" });
  }
  push("keys", { property_code: b.code, unit_number: "", type: "building_key", identifier: `${b.code}-MAIN-1`, assigned_to: "Office", tenant_phone: "", issued_date: "", returned_date: "", status: "in_office", notes: "Master key" });
  push("keys", { property_code: b.code, unit_number: "", type: "building_key", identifier: `${b.code}-MAIN-2`, assigned_to: "Concierge", tenant_phone: "", issued_date: "today-2y", returned_date: "", status: "issued", notes: "" });
  for (const unit of [...ctx.vacant].slice(0, 3)) {
    push("keys", { property_code: b.code, unit_number: unit, type: "apartment_key", identifier: `${b.code}-${unit}-K1`, assigned_to: "Office", tenant_phone: "", issued_date: "", returned_date: "", status: "in_office", notes: "" });
  }
  if (b.code === "RG") push("keys", { property_code: "RG", unit_number: rented[3] ?? rented[0], type: "mailbox_key", identifier: `RG-${rented[3] ?? rented[0]}-M1`, assigned_to: "", tenant_phone: ctx.tenants.get(rented[3] ?? rented[0])?.phone ?? "", issued_date: "today-300d", returned_date: "", status: "lost", notes: "Tenant reported it lost — replacement ordered" });
}

/* ---------------------------------- Main ---------------------------------- */

function reset() {
  rows = emptyRows();
  ctxByCode.clear();
  woSeq = 0;
}

const outDir = join(process.cwd(), "public", "seed");
mkdirSync(outDir, { recursive: true });

reset();
const cast = generateCast();
generateSuppliers();
for (const b of BUILDINGS) generateBuilding(b, { cast: true, history: true });
// Make B304's asking rent the demo number.
const b304 = rows.units.find((u) => u.property_code === "MR" && u.unit_number === "B304");
if (b304) {
  b304.asking_rent = 1350;
  b304.asking_deposit = 1350;
  b304.condition = "fair";
}
for (const b of BUILDINGS) {
  const ctx = ctxByCode.get(b.code)!;
  generateAssets(ctx);
  generateMaintenance(ctx);
  generateFinance(ctx);
  generateOperations(ctx, cast);
}
const portfolio = buildWorkbook(toAoa(rows));
writeFileSync(join(outDir, "portfolio.xlsx"), Buffer.from(workbookToArrayBuffer(portfolio)));
console.log(
  `portfolio.xlsx: ${IMPORT_ORDER.map((e) => `${rows[e].length} ${e}`).join(", ")}`,
);

reset();
generateSuppliers();
const cedar = generateBuilding(CEDAR, { cast: false, history: false });
generateAssets(cedar);
const cedarBook = buildWorkbook(toAoa(rows));
writeFileSync(join(outDir, "cedar-residence.xlsx"), Buffer.from(workbookToArrayBuffer(cedarBook)));
console.log(
  `cedar-residence.xlsx: ${IMPORT_ORDER.map((e) => `${rows[e].length} ${e}`).filter((s) => !s.startsWith("0 ")).join(", ")}`,
);
