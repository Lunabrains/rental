import * as XLSX from "xlsx";

/**
 * The one import template the app understands: one tab per entity, header row
 * = field names. The seed workbooks are built from these same definitions, so
 * the seed is the importer's first test.
 */

export type ImportEntity =
  | "properties"
  | "units"
  | "tenants"
  | "contracts"
  | "suppliers"
  | "assets"
  | "workorders"
  | "plans"
  | "expenses"
  | "budgets"
  | "deposits"
  | "meters"
  | "readings"
  | "charges"
  | "inspections"
  | "renovations"
  | "parking"
  | "keys"
  | "documents";

/** Referenced rows must come earlier: documents last so they can link to anything. */
export const IMPORT_ORDER: ImportEntity[] = [
  "properties",
  "units",
  "tenants",
  "contracts",
  "suppliers",
  "assets",
  "workorders",
  "plans",
  "expenses",
  "budgets",
  "deposits",
  "meters",
  "readings",
  "charges",
  "inspections",
  "renovations",
  "parking",
  "keys",
  "documents",
];

/** The five original tabs — shown first in the import preview. */
export const CORE_ENTITIES: ImportEntity[] = ["properties", "units", "tenants", "contracts", "documents"];

export const SHEET_NAMES: Record<ImportEntity, string> = {
  properties: "Properties",
  units: "Units",
  tenants: "Tenants",
  contracts: "Contracts",
  suppliers: "Suppliers",
  assets: "Assets",
  workorders: "WorkOrders",
  plans: "PreventivePlans",
  expenses: "Expenses",
  budgets: "Budgets",
  deposits: "Deposits",
  meters: "Meters",
  readings: "Readings",
  charges: "CommonCharges",
  inspections: "Inspections",
  renovations: "Renovations",
  parking: "Parking",
  keys: "Keys",
  documents: "Documents",
};

export const ENTITY_LABELS: Record<ImportEntity, [string, string]> = {
  properties: ["property", "properties"],
  units: ["unit", "units"],
  tenants: ["tenant", "tenants"],
  contracts: ["contract", "contracts"],
  suppliers: ["supplier", "suppliers"],
  assets: ["asset", "assets"],
  workorders: ["work order", "work orders"],
  plans: ["preventive plan", "preventive plans"],
  expenses: ["expense", "expenses"],
  budgets: ["budget line", "budget lines"],
  deposits: ["deposit", "deposits"],
  meters: ["meter", "meters"],
  readings: ["reading", "readings"],
  charges: ["common charge", "common charges"],
  inspections: ["inspection", "inspections"],
  renovations: ["renovation", "renovations"],
  parking: ["parking space", "parking spaces"],
  keys: ["key", "keys"],
  documents: ["document", "documents"],
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

const col = (key: string, type: ColumnType, description: string, extra: Partial<ColumnSpec> = {}): ColumnSpec => ({ key, label: key, type, description, ...extra });
const PROPERTY = col("property_code", "text", "Building code, e.g. BH.", { required: true });
const UNIT = col("unit_number", "text", "Unit within the building (optional — leave blank for building-level rows).");
const SUPPLIER_REF = col("supplier_name", "text", "Name of a supplier in this file or already imported.");
const ASSET_REF = col("asset_name", "text", "Name of an asset in this file or already imported (same building).");
const TENANT_REF = col("tenant_phone", "text", "Phone of a tenant in this file or already imported.");
const NOTES = col("notes", "text", "Free text.");

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
    col("type", "enum", "residential / mixed_use / commercial.", { values: ["residential", "mixed_use", "commercial"] }),
    col("status", "enum", "active / under_renovation / sold.", { values: ["active", "under_renovation", "sold"] }),
    col("acquisition_date", "date", "When the building was bought."),
    col("acquisition_cost", "number", "Purchase price (USD)."),
    col("estimated_value", "number", "Owner's estimate of current value (USD)."),
    col("insurance_provider", "text", "Insurer."),
    col("insurance_policy_number", "text", "Policy number."),
    col("insurance_expiry", "date", "Policy expiry — drives the insurance alert."),
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
    col("market_rent", "number", "Reference market rent used for vacancy-loss estimates."),
    col("condition", "enum", "good / fair / needs_work / poor.", { values: ["good", "fair", "needs_work", "poor"] }),
    { key: "status", label: "status", type: "enum", values: ["", "maintenance", "reserved", "renovation", "unavailable"], description: "Leave blank — rented/available is derived from contracts. Use maintenance, reserved, renovation or unavailable to override." },
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
    col("payment_frequency", "enum", "monthly / quarterly / semi_annual / annual. Defaults to monthly.", { values: ["monthly", "quarterly", "semi_annual", "annual"] }),
    { key: "payment_method", label: "payment_method", type: "enum", values: ["cash", "bank_transfer", "cheque", "card"], description: "cash / bank_transfer / cheque / card." },
    { key: "status", label: "status", type: "enum", values: ["active", "expired", "terminated", "renewed", "notice_given"], description: "Defaults to active if end_date is in the future, else expired." },
    { key: "move_out_date", label: "move_out_date", type: "date", description: "For terminated / notice_given contracts." },
    col("rent_increase_clause", "text", "e.g. 5% on renewal."),
    col("special_terms", "text", "Anything unusual in the lease."),
    col("renewal_decision", "enum", "awaiting_decision / renew / do_not_renew (blank = no decision yet).", { values: ["", "awaiting_decision", "renew", "do_not_renew"] }),
    col("proposed_rent", "number", "Rent proposed for the renewal."),
    col("renewal_notes", "text", "Renewal negotiation notes."),
    { key: "notes", label: "notes", type: "text", description: "Free text." },
    { key: "payment_pattern", label: "payment_pattern", type: "text", description: "Demo only: scripts the generated payment history, e.g. overdue@-8 | late@-150:5 | partial@-12:800. Leave blank for on-time history." },
  ],
  suppliers: [
    col("name", "text", "Supplier / technician name. Re-imports match on this.", { required: true }),
    col("category", "enum", "plumbing / electrical / hvac / elevator / generator / cleaning / security / general_contractor / painting / pest_control / appliance / other.", { values: ["plumbing", "electrical", "hvac", "elevator", "generator", "cleaning", "security", "general_contractor", "painting", "pest_control", "appliance", "other"] }),
    col("phone", "text", "Phone."),
    col("email", "text", "Email."),
    col("company", "text", "Company name, if different."),
    col("services", "text", "Comma-separated services offered."),
    col("rating", "number", "Manual rating 1–5."),
    col("active", "bool", "yes / no — defaults to yes."),
    NOTES,
  ],
  assets: [
    PROPERTY,
    UNIT,
    col("asset_type", "enum", "elevator / generator / water_pump / water_tank / hvac / fire_system / cctv / access_control / boiler / solar_system / electrical_panel / parking_gate / other.", { required: true, values: ["elevator", "generator", "water_pump", "water_tank", "hvac", "fire_system", "cctv", "access_control", "boiler", "solar_system", "electrical_panel", "parking_gate", "other"] }),
    col("name", "text", "Asset name, unique within the building. Re-imports match on property_code + name.", { required: true }),
    col("manufacturer", "text", "Manufacturer."),
    col("model", "text", "Model."),
    col("serial_number", "text", "Serial number."),
    col("installation_date", "date", "Installed on."),
    col("purchase_cost", "number", "Purchase cost (USD)."),
    col("warranty_expiry", "date", "Warranty end — drives the warranty alert."),
    SUPPLIER_REF,
    col("status", "enum", "operational / degraded / out_of_service / retired.", { values: ["operational", "degraded", "out_of_service", "retired"] }),
    col("last_service_date", "date", "Last service."),
    col("qr_code", "text", "Stable QR identifier; generated when blank."),
    NOTES,
  ],
  workorders: [
    col("number", "text", "Work order number, e.g. WO-0042. Re-imports match on this.", { required: true }),
    PROPERTY,
    UNIT,
    ASSET_REF,
    TENANT_REF,
    col("title", "text", "Short issue title.", { required: true }),
    col("description", "text", "What was reported."),
    col("category", "enum", "plumbing / electrical / hvac / elevator / generator / appliance / structural / painting / cleaning / pest_control / security / water / other.", { values: ["plumbing", "electrical", "hvac", "elevator", "generator", "appliance", "structural", "painting", "cleaning", "pest_control", "security", "water", "other"] }),
    col("priority", "enum", "low / normal / high / emergency.", { values: ["low", "normal", "high", "emergency"] }),
    col("status", "enum", "open / assigned / awaiting_quote / awaiting_approval / in_progress / completed / closed / cancelled.", { values: ["open", "assigned", "awaiting_quote", "awaiting_approval", "in_progress", "completed", "closed", "cancelled"] }),
    col("source", "enum", "owner / tenant / inspection / preventive.", { values: ["owner", "tenant", "inspection", "preventive", "assistant"] }),
    col("reported_at", "date", "Reported on.", { required: true }),
    SUPPLIER_REF,
    col("estimated_cost", "number", "Quote / estimate (USD)."),
    col("actual_cost", "number", "Final cost (USD)."),
    col("approval_required", "bool", "yes / no."),
    col("approved_at", "date", "Approved on."),
    col("started_at", "date", "Work started."),
    col("completed_at", "date", "Work completed."),
    col("closed_at", "date", "Closed on."),
    col("repeat_of_number", "text", "Earlier work order this repeats."),
    NOTES,
  ],
  plans: [
    PROPERTY,
    ASSET_REF,
    col("maintenance_type", "text", "e.g. Elevator inspection. Re-imports match on property_code + asset_name + maintenance_type.", { required: true }),
    col("recurrence_months", "int", "Every N months.", { required: true }),
    col("last_service_date", "date", "Last done."),
    col("next_service_date", "date", "Next due — drives the due / overdue alerts.", { required: true }),
    SUPPLIER_REF,
    col("estimated_cost", "number", "Cost per service (USD)."),
    col("status", "enum", "active / paused.", { values: ["active", "paused"] }),
    col("reminder_days", "int", "Days before the due date to raise an alert (default 14)."),
    NOTES,
  ],
  expenses: [
    PROPERTY,
    UNIT,
    SUPPLIER_REF,
    col("category", "enum", "maintenance / elevator / plumbing / electrical / hvac / generator / cleaning / security / water / electricity / municipality / insurance / taxes / renovation / staff / contractor / common_area / other.", { required: true, values: ["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "cleaning", "security", "water", "electricity", "municipality", "insurance", "taxes", "renovation", "staff", "contractor", "common_area", "other"] }),
    col("amount", "number", "USD.", { required: true }),
    col("expense_date", "date", "Invoice / expense date.", { required: true }),
    col("due_date", "date", "Payment due date."),
    col("payment_status", "enum", "unpaid / paid / scheduled.", { values: ["unpaid", "paid", "scheduled"] }),
    col("paid_date", "date", "Paid on."),
    col("recurring", "bool", "yes / no."),
    col("recurrence", "enum", "monthly / quarterly / semi_annual / annual.", { values: ["", "monthly", "quarterly", "semi_annual", "annual"] }),
    col("description", "text", "What it was for. Re-imports match on property_code + expense_date + description.", { required: true }),
    col("classification", "enum", "operating / capex (defaults to operating; renovation → capex).", { values: ["operating", "capex"] }),
    col("invoice_number", "text", "Invoice reference."),
    col("work_order_number", "text", "Link to a work order."),
    col("renovation_title", "text", "Link to a renovation project (same building)."),
    ASSET_REF,
    NOTES,
  ],
  budgets: [
    PROPERTY,
    col("period", "text", "YYYY-MM for a monthly budget, YYYY for a yearly one, or a relative token (today, today-1m, year).", { required: true }),
    col("category", "enum", "Expense category.", { required: true, values: ["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "cleaning", "security", "water", "electricity", "municipality", "insurance", "taxes", "renovation", "staff", "contractor", "common_area", "other"] }),
    col("amount", "number", "Budgeted amount (USD).", { required: true }),
    NOTES,
  ],
  deposits: [
    col("contract_number", "text", "Contract the deposit belongs to. Re-imports match on this.", { required: true }),
    col("amount_expected", "number", "Defaults to the contract deposit."),
    col("amount_received", "number", "Amount actually received."),
    col("received_date", "date", "Received on."),
    col("deductions", "text", "Deductions as description:amount:date entries separated by |, e.g. Repaint walls:250:today-3d"),
    col("final_refund", "number", "Refund paid out at settlement."),
    col("settlement_date", "date", "Settled on."),
    NOTES,
  ],
  meters: [
    PROPERTY,
    UNIT,
    col("utility_type", "enum", "electricity / water / generator / gas / other.", { required: true, values: ["electricity", "water", "generator", "gas", "other"] }),
    col("meter_number", "text", "Unique meter number. Re-imports match on this.", { required: true }),
    col("billing_method", "enum", "metered / flat / included.", { values: ["metered", "flat", "included"] }),
    col("unit_rate", "number", "Price per unit of consumption (USD)."),
    col("unit_label", "text", "kWh, m³ …"),
  ],
  readings: [
    col("meter_number", "text", "Meter in this file or already imported.", { required: true }),
    col("reading_date", "date", "Read on. Re-imports match on meter_number + reading_date.", { required: true }),
    col("previous_reading", "number", "Previous reading (defaults to the last known)."),
    col("current_reading", "number", "Current reading.", { required: true }),
    col("meter_reset", "bool", "yes when the meter was replaced / reset."),
    col("note", "text", "Note."),
  ],
  charges: [
    PROPERTY,
    col("period", "text", "YYYY-MM or a relative token (today, today-1m).", { required: true }),
    col("category", "text", "elevator, cleaning, generator, security, water …", { required: true }),
    col("total_amount", "number", "Total to allocate (USD).", { required: true }),
    col("allocation_method", "enum", "equal / by_area / by_bedrooms.", { values: ["equal", "by_area", "by_bedrooms"] }),
    col("paid_units", "text", "Comma-separated unit numbers that have paid their share."),
    NOTES,
  ],
  inspections: [
    PROPERTY,
    UNIT,
    ASSET_REF,
    TENANT_REF,
    col("type", "enum", "move_in / move_out / annual_unit / building / safety / asset.", { required: true, values: ["move_in", "move_out", "annual_unit", "building", "safety", "asset"] }),
    col("scheduled_date", "date", "Scheduled for. Re-imports match on property_code + unit_number + type + scheduled_date.", { required: true }),
    col("completed_date", "date", "Completed on."),
    col("inspector", "text", "Who inspected."),
    col("status", "enum", "scheduled / in_progress / completed / cancelled.", { values: ["scheduled", "in_progress", "completed", "cancelled"] }),
    col("overall_result", "enum", "pass / fail / attention.", { values: ["", "pass", "fail", "attention"] }),
    col("items", "text", "Checklist as Area/Item:result entries separated by |. Add ! for follow-up and :note for notes, e.g. Kitchen/Sink:pass | Bathroom/Tiles:fail!:Cracked tiles"),
    NOTES,
  ],
  renovations: [
    PROPERTY,
    UNIT,
    col("title", "text", "Project title. Re-imports match on property_code + title.", { required: true }),
    col("description", "text", "Scope."),
    col("project_type", "enum", "renovation / upgrade / repair / expansion.", { values: ["renovation", "upgrade", "repair", "expansion"] }),
    col("budget", "number", "Budget (USD).", { required: true }),
    col("contractor_name", "text", "Supplier acting as contractor."),
    col("start_date", "date", "Start.", { required: true }),
    col("target_end_date", "date", "Planned end.", { required: true }),
    col("actual_end_date", "date", "Actual end."),
    col("status", "enum", "planned / in_progress / on_hold / completed / cancelled.", { values: ["planned", "in_progress", "on_hold", "completed", "cancelled"] }),
    col("progress_percent", "int", "0–100 when there are no tasks."),
    col("tasks", "text", "Tasks separated by |; append :done for finished ones, e.g. Demolition:done | Tiling | Painting"),
    NOTES,
  ],
  parking: [
    PROPERTY,
    col("space_number", "text", "Space number. Re-imports match on property_code + space_number.", { required: true }),
    UNIT,
    TENANT_REF,
    col("vehicle_plate", "text", "Plate."),
    col("paid", "bool", "yes when the space is charged."),
    col("monthly_fee", "number", "USD per month."),
    col("status", "enum", "assigned / free / reserved / unavailable.", { values: ["assigned", "free", "reserved", "unavailable"] }),
    NOTES,
  ],
  keys: [
    PROPERTY,
    UNIT,
    col("type", "enum", "apartment_key / building_key / mailbox_key / access_card / parking_remote / other.", { required: true, values: ["apartment_key", "building_key", "mailbox_key", "access_card", "parking_remote", "other"] }),
    col("identifier", "text", "Tag / card number. Re-imports match on property_code + identifier.", { required: true }),
    col("assigned_to", "text", "Holder name when not a tenant."),
    TENANT_REF,
    col("issued_date", "date", "Issued on."),
    col("returned_date", "date", "Returned on."),
    col("status", "enum", "in_office / issued / returned / lost.", { values: ["in_office", "issued", "returned", "lost"] }),
    NOTES,
  ],
  documents: [
    { key: "tenant_phone", label: "tenant_phone", type: "text", description: "Owner of the document (tenant documents)." },
    col("property_code", "text", "Building the document belongs to (building documents)."),
    ASSET_REF,
    { key: "kind", label: "kind", type: "enum", values: ["id", "passport", "contract", "receipt", "other"], required: true, description: "id / passport / contract / receipt / other." },
    col("category", "enum", "lease / tenant_id / ownership / insurance / invoice / receipt / quotation / inspection / maintenance_report / certificate / warranty / municipality / photo / other. Defaults from kind.", { values: ["", "lease", "tenant_id", "ownership", "insurance", "invoice", "receipt", "quotation", "inspection", "maintenance_report", "certificate", "warranty", "municipality", "photo", "other"] }),
    { key: "title", label: "title", type: "text", description: "Display title." },
    { key: "file_name", label: "file_name", type: "text", required: true, description: "File name, e.g. karim-daher-id.pdf." },
    { key: "contract_number", label: "contract_number", type: "text", description: "Link a contract document to its contract." },
    col("work_order_number", "text", "Link to a work order."),
    { key: "issued_date", label: "issued_date", type: "date", description: "Issue date." },
    { key: "expiry_date", label: "expiry_date", type: "date", description: "Expiry date (drives the ID / certificate expiring alerts)." },
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
  "One tab per entity. Row 1 is the header and must not be edited. Rows below the header are your data; the sample rows in this file can be deleted. Every tab except Properties is optional.",
  "",
  "Import order is Properties → Units → Tenants → Contracts → Suppliers → Assets → WorkOrders → PreventivePlans → Expenses → Budgets → Deposits → Meters → Readings → CommonCharges → Inspections → Renovations → Parking → Keys → Documents. A row may reference something defined in the same file or already in the system.",
  "",
  "Re-importing is safe: rows are matched on their keys and updated, never duplicated.",
  "  Properties: property_code · Units: property_code + unit_number · Tenants: phone (or id_number) · Contracts: contract_number",
  "  Suppliers: name · Assets: property_code + name · WorkOrders: number · PreventivePlans: property_code + asset_name + maintenance_type",
  "  Expenses: property_code + expense_date + description · Budgets: property_code + period + category · Deposits: contract_number",
  "  Meters: meter_number · Readings: meter_number + reading_date · CommonCharges: property_code + period + category",
  "  Inspections: property_code + unit_number + type + scheduled_date · Renovations: property_code + title · Parking: property_code + space_number · Keys: property_code + identifier",
  "  Documents: owner + kind + file_name",
  "",
  "Dates: use YYYY-MM-DD. Relative tokens are also accepted and resolved on import: today, today+28d, today-8d, today-5m, today+1y. Periods accept YYYY-MM, YYYY, today, today-1m or year.",
  "",
  "Units: rented / available is derived from active contracts — leave status blank unless the unit is under maintenance, reserved, being renovated or unavailable.",
  "",
  "Contracts: a payment schedule is generated from start_date to end_date. Past periods are recorded as paid on time unless payment_pattern says otherwise.",
  "  payment_pattern entries are separated by | and refer to the payment whose due date is closest to today + N days:",
  "    overdue@-8          unpaid, due 8 days ago",
  "    late@-150:5         paid 5 days late, due ~150 days ago",
  "    partial@-12:800     paid 800 of the amount due",
  "    unpaid@+20          not yet paid (future)",
  "  A security deposit record is created for every contract; use the Deposits tab to record deductions and settlements.",
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

/** Rows keyed by column name → arrays in column order (missing → blank). */
export function rowsToAoa(entity: ImportEntity, rows: Record<string, unknown>[]): unknown[][] {
  return rows.map((r) => COLUMNS[entity].map((c) => r[c.key] ?? ""));
}

/** Template download: headers + sample rows per tab + README. */
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const r = rowsToAoa;
  return buildWorkbook({
    properties: r("properties", [
      { property_code: "CR", name: "Cedar Residence", address: "12 Cedar Street", district: "Achrafieh", city: "Beirut", country: "Lebanon", year_built: 2015, floors: 6, units_per_floor: 3, type: "residential", status: "active", insurance_provider: "AXA", insurance_expiry: "today+8m" },
      { property_code: "PL", name: "Pine Lofts", address: "4 Pine Avenue", district: "Hamra", city: "Beirut", country: "Lebanon", year_built: 2018, floors: 4, units_per_floor: 4, type: "residential", status: "active" },
    ]),
    units: r("units", [
      { property_code: "CR", unit_number: "101", floor: 1, bedrooms: 2, bathrooms: 1, size_sqm: 95, furnished: "no", asking_rent: 1100, asking_deposit: 1100, market_rent: 1150, condition: "good" },
      { property_code: "CR", unit_number: "102", floor: 1, bedrooms: 1, bathrooms: 1, size_sqm: 70, furnished: "yes", asking_rent: 900, asking_deposit: 900, condition: "fair" },
      { property_code: "CR", unit_number: "201", floor: 2, bedrooms: 3, bathrooms: 2, size_sqm: 140, furnished: "no", asking_rent: 1400, asking_deposit: 1400, condition: "good", notes: "Corner unit" },
    ]),
    tenants: r("tenants", [
      { first_name: "Layla", last_name: "Haddad", phone: "+961 3 123 456", email: "layla.haddad@example.com", nationality: "Lebanese", id_type: "national_id", id_number: "LB-1234567", occupation: "Architect", emergency_contact_name: "Samir Haddad", emergency_contact_phone: "+961 3 654 321" },
      { first_name: "Omar", last_name: "Farah", phone: "+961 70 222 333", email: "omar.farah@example.com", nationality: "Lebanese", id_type: "passport", id_number: "RL0987654", occupation: "Engineer" },
    ]),
    contracts: r("contracts", [
      { contract_number: "CR-101-2025", property_code: "CR", unit_number: "101", tenant_phone: "+961 3 123 456", start_date: "today-8m", end_date: "today+4m", monthly_rent: 1100, deposit: 1100, payment_day: 5, payment_method: "bank_transfer", rent_increase_clause: "5% on renewal" },
      { contract_number: "CR-102-2025", property_code: "CR", unit_number: "102", tenant_phone: "+961 70 222 333", start_date: "today-3m", end_date: "today+9m", monthly_rent: 900, deposit: 900, payment_day: 1, payment_method: "cash" },
    ]),
    suppliers: r("suppliers", [
      { name: "Schindler Lebanon", category: "elevator", phone: "+961 1 500 200", email: "service@schindler.example", company: "Schindler", services: "Elevator maintenance, inspections", rating: 4, active: "yes" },
      { name: "Abou Rjeily Plumbing", category: "plumbing", phone: "+961 3 900 100", email: "", company: "", services: "Plumbing, leaks, water heaters", rating: 3, active: "yes" },
    ]),
    assets: r("assets", [
      { property_code: "CR", asset_type: "elevator", name: "Elevator 1", manufacturer: "Schindler", model: "3300", serial_number: "SCH-33-8812", installation_date: "2015-06-01", purchase_cost: 48000, warranty_expiry: "today+2m", supplier_name: "Schindler Lebanon", status: "operational", last_service_date: "today-2m" },
    ]),
    workorders: r("workorders", [
      { number: "WO-0001", property_code: "CR", unit_number: "102", title: "Kitchen sink leaking", description: "Water under the sink cabinet", category: "plumbing", priority: "high", status: "open", source: "tenant", reported_at: "today-2d", supplier_name: "Abou Rjeily Plumbing", estimated_cost: 120 },
    ]),
    plans: r("plans", [
      { property_code: "CR", asset_name: "Elevator 1", maintenance_type: "Elevator service", recurrence_months: 3, last_service_date: "today-2m", next_service_date: "today+1m", supplier_name: "Schindler Lebanon", estimated_cost: 350, status: "active", reminder_days: 14 },
    ]),
    expenses: r("expenses", [
      { property_code: "CR", supplier_name: "Schindler Lebanon", category: "elevator", amount: 350, expense_date: "today-2m", payment_status: "paid", paid_date: "today-2m", recurring: "yes", recurrence: "quarterly", description: "Elevator quarterly service", classification: "operating", invoice_number: "INV-1201" },
    ]),
    budgets: r("budgets", [{ property_code: "CR", period: "year", category: "maintenance", amount: 6000 }]),
    deposits: r("deposits", [{ contract_number: "CR-101-2025", amount_expected: 1100, amount_received: 1100, received_date: "today-8m" }]),
    meters: r("meters", [{ property_code: "CR", unit_number: "101", utility_type: "electricity", meter_number: "EDL-CR-101", billing_method: "metered", unit_rate: 0.12, unit_label: "kWh" }]),
    readings: r("readings", [{ meter_number: "EDL-CR-101", reading_date: "today-1m", previous_reading: 10400, current_reading: 10720 }]),
    charges: r("charges", [{ property_code: "CR", period: "today", category: "cleaning", total_amount: 450, allocation_method: "equal", paid_units: "101" }]),
    inspections: r("inspections", [
      { property_code: "CR", unit_number: "101", tenant_phone: "+961 3 123 456", type: "move_in", scheduled_date: "today-8m", completed_date: "today-8m", inspector: "Office", status: "completed", overall_result: "pass", items: "Kitchen/Sink:pass | Bathroom/Tiles:pass | Living/Walls:attention:Minor scuffs" },
    ]),
    renovations: r("renovations", [
      { property_code: "CR", unit_number: "201", title: "Kitchen refit", description: "New cabinets and appliances", project_type: "upgrade", budget: 9000, contractor_name: "Abou Rjeily Plumbing", start_date: "today-1m", target_end_date: "today+1m", status: "in_progress", tasks: "Demolition:done | Plumbing:done | Cabinets | Painting" },
    ]),
    parking: r("parking", [{ property_code: "CR", space_number: "P-01", unit_number: "101", tenant_phone: "+961 3 123 456", vehicle_plate: "B 123456", paid: "no", monthly_fee: 0, status: "assigned" }]),
    keys: r("keys", [{ property_code: "CR", unit_number: "101", type: "apartment_key", identifier: "CR-101-K1", tenant_phone: "+961 3 123 456", issued_date: "today-8m", status: "issued" }]),
    documents: r("documents", [
      { tenant_phone: "+961 3 123 456", kind: "id", category: "tenant_id", title: "National ID", file_name: "layla-haddad-id.pdf", issued_date: "2019-03-01", expiry_date: "2029-03-01" },
      { tenant_phone: "+961 3 123 456", kind: "contract", category: "lease", title: "Signed contract", file_name: "CR-101-2025.pdf", contract_number: "CR-101-2025", issued_date: "today-8m" },
      { property_code: "CR", kind: "other", category: "insurance", title: "Building insurance policy", file_name: "cr-insurance-2026.pdf", issued_date: "today-4m", expiry_date: "today+8m" },
    ]),
  });
}

export function workbookToArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
