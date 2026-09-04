import * as XLSX from "xlsx";

/**
 * The one import template the app understands: one tab per entity, header row
 * = field names. The seed workbooks are built from these same definitions, so
 * the seed is the importer's first test.
 */

export type ImportEntity = "properties" | "units" | "tenants" | "contracts" | "documents";

export const IMPORT_ORDER: ImportEntity[] = ["properties", "units", "tenants", "contracts", "documents"];

export const SHEET_NAMES: Record<ImportEntity, string> = {
  properties: "Properties",
  units: "Units",
  tenants: "Tenants",
  contracts: "Contracts",
  documents: "Documents",
};

/** Present so users can see the shape; ignored by the importer in v1. */
export const PAYMENTS_SHEET = "Payments";
export const README_SHEET = "README";

export type ColumnType = "text" | "int" | "number" | "date" | "bool" | "enum";

export interface ColumnSpec {
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
  /** For `enum` columns. */
  values?: string[];
  description: string;
}

export const COLUMNS: Record<ImportEntity, ColumnSpec[]> = {
  properties: [
    { key: "property_code", label: "property_code", type: "text", required: true, description: "Short unique code, e.g. BH. Re-imports match on this." },
    { key: "name", label: "name", type: "text", required: true, description: "Building name." },
    { key: "address", label: "address", type: "text", description: "Street address." },
    { key: "district", label: "district", type: "text", description: "Neighbourhood / district." },
    { key: "city", label: "city", type: "text", description: "City." },
    { key: "country", label: "country", type: "text", description: "Country." },
    { key: "year_built", label: "year_built", type: "int", description: "Year of construction." },
    { key: "floors", label: "floors", type: "int", required: true, description: "Number of floors (rectangular layout)." },
    { key: "units_per_floor", label: "units_per_floor", type: "int", required: true, description: "Units on each floor." },
    { key: "notes", label: "notes", type: "text", description: "Free text." },
  ],
  units: [
    { key: "property_code", label: "property_code", type: "text", required: true, description: "Must match a property in this file or already imported." },
    { key: "unit_number", label: "unit_number", type: "text", required: true, description: "Unique within the building, e.g. 403. Re-imports match on property_code + unit_number." },
    { key: "floor", label: "floor", type: "int", required: true, description: "Floor number (0 = ground)." },
    { key: "bedrooms", label: "bedrooms", type: "int", description: "Bedrooms." },
    { key: "bathrooms", label: "bathrooms", type: "int", description: "Bathrooms." },
    { key: "size_sqm", label: "size_sqm", type: "number", description: "Size in m²." },
    { key: "furnished", label: "furnished", type: "bool", description: "yes / no." },
    { key: "asking_rent", label: "asking_rent", type: "number", description: "Monthly asking rent (USD). Blank → imported as available with no asking price." },
    { key: "asking_deposit", label: "asking_deposit", type: "number", description: "Asking deposit (USD)." },
    { key: "status", label: "status", type: "enum", values: ["", "maintenance", "reserved"], description: "Leave blank — rented/available is derived from contracts. Use maintenance or reserved to override." },
    { key: "notes", label: "notes", type: "text", description: "Free text." },
  ],
  tenants: [
    { key: "first_name", label: "first_name", type: "text", required: true, description: "First name." },
    { key: "last_name", label: "last_name", type: "text", required: true, description: "Last name." },
    { key: "phone", label: "phone", type: "text", required: true, description: "Primary key for re-imports (with id_number)." },
    { key: "email", label: "email", type: "text", description: "Email." },
    { key: "nationality", label: "nationality", type: "text", description: "Nationality." },
    { key: "id_type", label: "id_type", type: "enum", values: ["national_id", "passport", "residency_permit"], description: "national_id / passport / residency_permit." },
    { key: "id_number", label: "id_number", type: "text", description: "ID or passport number. Also a re-import key." },
    { key: "occupation", label: "occupation", type: "text", description: "Occupation." },
    { key: "emergency_contact_name", label: "emergency_contact_name", type: "text", description: "Emergency contact." },
    { key: "emergency_contact_phone", label: "emergency_contact_phone", type: "text", description: "Emergency contact phone." },
    { key: "notes", label: "notes", type: "text", description: "Free text." },
  ],
  contracts: [
    { key: "contract_number", label: "contract_number", type: "text", required: true, description: "Unique. Re-imports match on this." },
    { key: "property_code", label: "property_code", type: "text", required: true, description: "Building code." },
    { key: "unit_number", label: "unit_number", type: "text", required: true, description: "Unit within the building." },
    { key: "tenant_phone", label: "tenant_phone", type: "text", required: true, description: "Phone of a tenant in this file or already imported." },
    { key: "start_date", label: "start_date", type: "date", required: true, description: "YYYY-MM-DD, or a relative token like today-11m." },
    { key: "end_date", label: "end_date", type: "date", required: true, description: "YYYY-MM-DD or relative token." },
    { key: "monthly_rent", label: "monthly_rent", type: "number", required: true, description: "USD per month." },
    { key: "deposit", label: "deposit", type: "number", description: "USD. Defaults to one month." },
    { key: "payment_day", label: "payment_day", type: "int", description: "Day of month rent is due (1–28). Defaults to start day." },
    { key: "payment_method", label: "payment_method", type: "enum", values: ["cash", "bank_transfer", "cheque", "card"], description: "cash / bank_transfer / cheque / card." },
    { key: "status", label: "status", type: "enum", values: ["active", "expired", "terminated", "renewed", "notice_given"], description: "Defaults to active if end_date is in the future, else expired." },
    { key: "move_out_date", label: "move_out_date", type: "date", description: "For terminated / notice_given contracts." },
    { key: "notes", label: "notes", type: "text", description: "Free text." },
    { key: "payment_pattern", label: "payment_pattern", type: "text", description: "Demo only: scripts the generated payment history, e.g. overdue@-8 | late@-150:5 | partial@-12:800. Leave blank for on-time history." },
  ],
  documents: [
    { key: "tenant_phone", label: "tenant_phone", type: "text", required: true, description: "Owner of the document." },
    { key: "kind", label: "kind", type: "enum", values: ["id", "passport", "contract", "receipt", "other"], required: true, description: "id / passport / contract / receipt / other." },
    { key: "title", label: "title", type: "text", description: "Display title." },
    { key: "file_name", label: "file_name", type: "text", required: true, description: "File name, e.g. karim-daher-id.pdf." },
    { key: "contract_number", label: "contract_number", type: "text", description: "Link a contract document to its contract." },
    { key: "issued_date", label: "issued_date", type: "date", description: "Issue date." },
    { key: "expiry_date", label: "expiry_date", type: "date", description: "Expiry date (drives the ID-expiring alert)." },
  ],
};

export const PAYMENTS_COLUMNS = [
  "contract_number",
  "period",
  "due_date",
  "amount_due",
  "amount_paid",
  "paid_date",
  "method",
  "reference",
];

export const README_LINES: string[] = [
  "Rental Command Center — import template",
  "",
  "One tab per entity. Row 1 is the header and must not be edited. Rows below the header are your data; the sample rows in this file can be deleted.",
  "",
  "Import order is Properties → Units → Tenants → Contracts → Documents. A row may reference something defined in the same file or already in the system.",
  "",
  "Re-importing is safe: rows are matched on their keys and updated, never duplicated.",
  "  Properties: property_code",
  "  Units: property_code + unit_number",
  "  Tenants: phone (or id_number)",
  "  Contracts: contract_number",
  "  Documents: tenant_phone + kind + file_name",
  "",
  "Dates: use YYYY-MM-DD. Relative tokens are also accepted and resolved on import: today, today+28d, today-8d, today-5m, today+1y.",
  "",
  "Units: rented / available is derived from active contracts — leave status blank unless the unit is under maintenance or reserved.",
  "",
  "Contracts: a monthly payment schedule is generated from start_date to end_date. Past periods are recorded as paid on time unless payment_pattern says otherwise.",
  "  payment_pattern entries are separated by | and refer to the payment whose due date is closest to today + N days:",
  "    overdue@-8          unpaid, due 8 days ago",
  "    late@-150:5         paid 5 days late, due ~150 days ago",
  "    partial@-12:800     paid 800 of the amount due",
  "    unpaid@+20          not yet paid (future)",
  "",
  "Payments tab: shown for reference only; payments are not imported in this version.",
];

interface SheetSpec {
  name: string;
  headers: string[];
  rows: unknown[][];
}

function sheetFrom(spec: SheetSpec): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([spec.headers, ...spec.rows]);
  ws["!cols"] = spec.headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  return ws;
}

/** Build a workbook that follows the template, with optional data per tab. */
export function buildWorkbook(data: Partial<Record<ImportEntity, unknown[][]>>, opts: { readme?: boolean; payments?: boolean } = {}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  if (opts.readme !== false) {
    const ws = XLSX.utils.aoa_to_sheet(README_LINES.map((l) => [l]));
    ws["!cols"] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, ws, README_SHEET);
  }
  for (const entity of IMPORT_ORDER) {
    XLSX.utils.book_append_sheet(
      wb,
      sheetFrom({ name: SHEET_NAMES[entity], headers: COLUMNS[entity].map((c) => c.key), rows: data[entity] ?? [] }),
      SHEET_NAMES[entity],
    );
  }
  if (opts.payments !== false) {
    XLSX.utils.book_append_sheet(wb, sheetFrom({ name: PAYMENTS_SHEET, headers: PAYMENTS_COLUMNS, rows: [] }), PAYMENTS_SHEET);
  }
  return wb;
}

/** Template download: headers + 3 sample rows per tab + README. */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  return buildWorkbook({
    properties: [
      ["CR", "Cedar Residence", "12 Cedar Street", "Achrafieh", "Beirut", "Lebanon", 2015, 6, 3, ""],
      ["PL", "Pine Lofts", "4 Pine Avenue", "Hamra", "Beirut", "Lebanon", 2018, 4, 4, ""],
      ["OV", "Olive View", "9 Olive Road", "Jounieh", "Keserwan", "Lebanon", 2010, 5, 2, ""],
    ],
    units: [
      ["CR", "101", 1, 2, 1, 95, "no", 1100, 1100, "", ""],
      ["CR", "102", 1, 1, 1, 70, "yes", 900, 900, "", ""],
      ["CR", "201", 2, 3, 2, 140, "no", 1400, 1400, "", "Corner unit"],
    ],
    tenants: [
      ["Layla", "Haddad", "+961 3 123 456", "layla.haddad@example.com", "Lebanese", "national_id", "LB-1234567", "Architect", "Samir Haddad", "+961 3 654 321", ""],
      ["Omar", "Farah", "+961 70 222 333", "omar.farah@example.com", "Lebanese", "passport", "RL0987654", "Engineer", "", "", ""],
      ["Rita", "Nassar", "+961 71 444 555", "rita.nassar@example.com", "Lebanese", "national_id", "LB-7654321", "Teacher", "", "", ""],
    ],
    contracts: [
      ["CR-101-2025", "CR", "101", "+961 3 123 456", "today-8m", "today+4m", 1100, 1100, 5, "bank_transfer", "", "", "", ""],
      ["CR-102-2025", "CR", "102", "+961 70 222 333", "today-3m", "today+9m", 900, 900, 1, "cash", "", "", "", ""],
      ["CR-201-2024", "CR", "201", "+961 71 444 555", "today-14m", "today-2m", 1400, 1400, 10, "bank_transfer", "expired", "today-2m", "Moved abroad", ""],
    ],
    documents: [
      ["+961 3 123 456", "id", "National ID", "layla-haddad-id.pdf", "", "2019-03-01", "2029-03-01"],
      ["+961 3 123 456", "contract", "Signed contract", "CR-101-2025.pdf", "CR-101-2025", "today-8m", ""],
      ["+961 70 222 333", "passport", "Passport", "omar-farah-passport.pdf", "", "2021-06-15", "2031-06-15"],
    ],
  });
}

export function workbookToArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
