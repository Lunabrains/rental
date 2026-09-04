/**
 * Builds the demo seed workbooks:
 *   public/seed/portfolio.xlsx        — 7 buildings, the demo cast, all history
 *   public/seed/cedar-residence.xlsx  — the 8th building, dropped live in the demo
 *
 * Every date is a relative token (today-8d, today+28d) resolved by the
 * importer, so the files never go stale. Deterministic: same output every run.
 *
 *   npx tsx scripts/generate-seed.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COLUMNS, buildWorkbook, workbookToArrayBuffer, type ImportEntity } from "../src/lib/import/template";

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
  notes?: string;
}

const BUILDINGS: BuildingSpec[] = [
  { code: "BH", name: "Beirut Heights", address: "18 Rue Sursock", district: "Achrafieh", city: "Beirut", yearBuilt: 2016, floors: 8, upf: 4, prefix: "", rent: [1000, 1700], vacant: 5 },
  { code: "MR", name: "Marina Residence", address: "Marina Boulevard 4", district: "Dbayeh", city: "Metn", yearBuilt: 2012, floors: 10, upf: 4, prefix: "B", rent: [850, 1350], vacant: 11 },
  { code: "DT", name: "Downtown Tower", address: "Foch Street 22", district: "Downtown", city: "Beirut", yearBuilt: 2019, floors: 6, upf: 3, prefix: "", rent: [2200, 3300], vacant: 3 },
  { code: "RG", name: "Raouche Gardens", address: "Avenue du Général de Gaulle 71", district: "Raouche", city: "Beirut", yearBuilt: 2008, floors: 5, upf: 4, prefix: "", rent: [700, 1000], vacant: 3 },
  { code: "WR", name: "Waterfront Residence", address: "Corniche El Nahr 9", district: "Jounieh", city: "Keserwan", yearBuilt: 2014, floors: 6, upf: 4, prefix: "", rent: [800, 1150], vacant: 5 },
  { code: "VP", name: "Verdun Plaza", address: "Rachid Karameh Street 45", district: "Verdun", city: "Beirut", yearBuilt: 2011, floors: 5, upf: 4, prefix: "", rent: [750, 1050], vacant: 3 },
  { code: "MV", name: "Mountain View", address: "Old Broumana Road 3", district: "Broumana", city: "Metn", yearBuilt: 2005, floors: 4, upf: 4, prefix: "", rent: [650, 900], vacant: 3 },
];

const CEDAR: BuildingSpec = {
  code: "CR", name: "Cedar Residence", address: "12 Cedar Street", district: "Badaro", city: "Beirut", yearBuilt: 2017, floors: 6, upf: 3, prefix: "", rent: [750, 1100], vacant: 4,
};

/* ---------------------------------- Rows ---------------------------------- */

type Row = Record<string, unknown>;
const rows: Record<ImportEntity, Row[]> = { properties: [], units: [], tenants: [], contracts: [], documents: [] };

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
    payment_method: o.method ?? pick(["bank_transfer", "bank_transfer", "cash", "cheque"]),
    status: o.status ?? "",
    move_out_date: o.moveOut ?? "",
    notes: o.notes ?? "",
    payment_pattern: o.pattern ?? "",
  });
  return number;
}

function addDocument(phone: string, kind: string, title: string, fileName: string, extra: Partial<{ contract: string; issued: string; expiry: string }> = {}) {
  push("documents", {
    tenant_phone: phone,
    kind,
    title,
    file_name: fileName,
    contract_number: extra.contract ?? "",
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
}

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

function generateBuilding(b: BuildingSpec, opts: { cast: boolean; history: boolean }) {
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
        status: "",
        notes: "",
      });
      units.push({ code: b.code, number, floor, rent });
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

    const number = addContract({ code: b.code, unit: u.number, phone: tenant.phone, start, end, rent: u.rent, paymentDay, pattern: patterns.join(" | ") });

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
}

function generateCast() {
  // Karim Daher — protagonist. BH 403, 2BR, $1,500. Ends today+28d. Overdue 8d.
  const karim = addTenant({ first: "Karim", last: "Daher", phone: "+961 3 612 345", idType: "national_id", idNumber: "LB-2201983" });
  const karimContract = addContract({
    code: "BH", unit: "403", phone: karim.phone, start: "today+28d-12m", end: "today+28d", rent: 1500, paymentDay: "today-8d", method: "bank_transfer",
    pattern: "overdue@-8 | late@-150:5",
  });
  addDocument(karim.phone, "id", "National ID", "karim-daher-id.pdf", { issued: "today-4y", expiry: "today+6y" });
  addDocument(karim.phone, "passport", "Passport", "karim-daher-passport.pdf", { issued: "today-3y", expiry: "today+7y" });
  addDocument(karim.phone, "contract", "Signed contract", `${karimContract}.pdf`, { contract: karimContract, issued: "today+28d-12m" });

  // Nadine Khoury — model tenant. BH 502, $2,100. Ends today+45d. Renewed once before.
  const nadine = addTenant({ first: "Nadine", last: "Khoury", phone: "+961 71 345 678", idType: "national_id", idNumber: "LB-1178204" });
  addContract({ code: "BH", unit: "502", phone: nadine.phone, start: "today+45d-24m", end: "today+45d-12m-1d", rent: 2000, paymentDay: 1, method: "bank_transfer", status: "renewed" });
  const nadineContract = addContract({ code: "BH", unit: "502", phone: nadine.phone, start: "today+45d-12m", end: "today+45d", rent: 2100, paymentDay: 1, method: "bank_transfer" });
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
  addContract({ code: "MR", unit: "B304", phone: rami.phone, start: "today-87d-12m", end: "today-87d", rent: 1300, paymentDay: 5, status: "expired", moveOut: "today-87d", notes: "Relocated to Dubai" });
}

/* ---------------------------------- Main ---------------------------------- */

function reset() {
  for (const e of Object.keys(rows) as ImportEntity[]) rows[e] = [];
}

const outDir = join(process.cwd(), "public", "seed");
mkdirSync(outDir, { recursive: true });

reset();
generateCast();
for (const b of BUILDINGS) generateBuilding(b, { cast: true, history: true });
// Make B304's asking rent the demo number.
const b304 = rows.units.find((u) => u.property_code === "MR" && u.unit_number === "B304");
if (b304) {
  b304.asking_rent = 1350;
  b304.asking_deposit = 1350;
}
const portfolio = buildWorkbook(toAoa(rows));
writeFileSync(join(outDir, "portfolio.xlsx"), Buffer.from(workbookToArrayBuffer(portfolio)));
console.log(
  `portfolio.xlsx: ${rows.properties.length} properties, ${rows.units.length} units, ${rows.tenants.length} tenants, ${rows.contracts.length} contracts, ${rows.documents.length} documents`,
);

reset();
generateBuilding(CEDAR, { cast: false, history: false });
const cedar = buildWorkbook(toAoa(rows));
writeFileSync(join(outDir, "cedar-residence.xlsx"), Buffer.from(workbookToArrayBuffer(cedar)));
console.log(
  `cedar-residence.xlsx: ${rows.properties.length} property, ${rows.units.length} units, ${rows.tenants.length} tenants, ${rows.contracts.length} contracts, ${rows.documents.length} documents`,
);
