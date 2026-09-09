import type { AlertActionKind, AlertType } from "@/types";

/**
 * Which parts of the product are switched on. The owner asked for a simpler,
 * friendlier edition: everything from Budgets to Reports in the old sidebar is
 * off. The data model, importer and engine still know about those records, so
 * turning a section back on is a one-line change here — nothing was deleted.
 */
export type FeatureKey =
  | "budgets"
  | "deposits"
  | "utilities"
  | "charges"
  | "cashflow"
  | "maintenance"
  | "suppliers"
  | "inspections"
  | "keys"
  | "parking"
  | "renovations"
  | "analytics"
  | "documents"
  | "reports";

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  budgets: "Budgets",
  deposits: "Deposits",
  utilities: "Utilities",
  charges: "Common charges",
  cashflow: "Cash flow",
  maintenance: "Work orders & preventive maintenance",
  suppliers: "Suppliers",
  inspections: "Inspections",
  keys: "Keys",
  parking: "Parking",
  renovations: "Renovations",
  analytics: "Analytics",
  documents: "Documents",
  reports: "Reports",
};

const OFF_BY_DEFAULT: FeatureKey[] = ["budgets", "deposits", "utilities", "charges", "cashflow", "maintenance", "suppliers", "inspections", "keys", "parking", "renovations", "analytics", "documents", "reports"];

let hidden: ReadonlySet<FeatureKey> = new Set(OFF_BY_DEFAULT);

export function featureOn(key: FeatureKey): boolean {
  return !hidden.has(key);
}

export function hiddenFeatures(): FeatureKey[] {
  return [...hidden];
}

/** Tests and future editions flip the set; the app uses the default above. */
export function setHiddenFeatures(keys: FeatureKey[]): void {
  hidden = new Set(keys);
}

export function resetHiddenFeatures(): void {
  hidden = new Set(OFF_BY_DEFAULT);
}

/* -------------------------------- Routes --------------------------------- */

const ROUTE_FEATURES: [string, FeatureKey][] = [
  ["/finance/budgets", "budgets"],
  ["/finance/deposits", "deposits"],
  ["/finance/utilities", "utilities"],
  ["/finance/charges", "charges"],
  ["/finance/cash-flow", "cashflow"],
  ["/maintenance", "maintenance"],
  ["/suppliers", "suppliers"],
  ["/inspections", "inspections"],
  ["/keys", "keys"],
  ["/parking", "parking"],
  ["/renovations", "renovations"],
  ["/analytics", "analytics"],
  ["/documents", "documents"],
  ["/reports", "reports"],
];

/** The feature a path or href belongs to, if any. */
export function routeFeature(href: string): FeatureKey | null {
  const path = href.split(/[?#]/)[0];
  for (const [prefix, feature] of ROUTE_FEATURES) if (path === prefix || path.startsWith(`${prefix}/`)) return feature;
  return null;
}

/** True when a link can be shown — its section is switched on (or it belongs to no section). */
export function hrefVisible(href: string): boolean {
  const f = routeFeature(href);
  return f === null || featureOn(f);
}

/** `href` when its section is on, otherwise undefined — for optional links on cards. */
export function visibleHref(href: string): string | undefined {
  return hrefVisible(href) ? href : undefined;
}

/* -------------------------------- Alerts --------------------------------- */

const ALERT_FEATURES: Partial<Record<AlertType, FeatureKey>> = {
  document_missing_id: "documents",
  document_missing_contract: "documents",
  document_id_expiring: "documents",
  document_certificate_expiring: "documents",
  maintenance_emergency_open: "maintenance",
  maintenance_open_too_long: "maintenance",
  maintenance_repeat_issue: "maintenance",
  maintenance_cost_high: "maintenance",
  maintenance_awaiting_approval: "maintenance",
  preventive_service_due: "maintenance",
  preventive_service_overdue: "maintenance",
  budget_over: "budgets",
  noi_deteriorating: "cashflow",
  deposit_unsettled: "deposits",
  deposit_not_received: "deposits",
  inspection_overdue: "inspections",
  inspection_followup_open: "inspections",
  move_out_unplanned: "inspections",
  move_in_unplanned: "inspections",
  key_lost: "keys",
  renovation_over_budget: "renovations",
  renovation_delayed: "renovations",
};

export function alertTypeVisible(type: AlertType): boolean {
  const f = ALERT_FEATURES[type];
  return f === undefined || featureOn(f);
}

/** Alert types parked because their section is off. */
export function hiddenAlertTypes(): AlertType[] {
  return (Object.keys(ALERT_FEATURES) as AlertType[]).filter((t) => !alertTypeVisible(t));
}

const ACTION_FEATURES: Partial<Record<AlertActionKind, FeatureKey>> = {
  upload_document: "documents",
  view_work_order: "maintenance",
  create_work_order: "maintenance",
  approve_work_order: "maintenance",
  view_plan: "maintenance",
  schedule_service: "maintenance",
  view_supplier: "suppliers",
  create_supplier: "suppliers",
  view_inspection: "inspections",
  schedule_inspection: "inspections",
  view_keys: "keys",
  view_renovation: "renovations",
  view_deposit: "deposits",
  settle_deposit: "deposits",
  view_budget: "budgets",
};

export function actionVisible(kind: AlertActionKind): boolean {
  const f = ACTION_FEATURES[kind];
  return f === undefined || featureOn(f);
}

/* ------------------------------- Briefing -------------------------------- */

const BRIEFING_ITEM_FEATURES: [RegExp, FeatureKey][] = [
  [/^(wo|em|old)-/, "maintenance"],
  [/^plan-/, "maintenance"],
  [/^(completed|serviced)$/, "maintenance"],
  [/^dep-/, "deposits"],
  [/^rn-/, "renovations"],
  [/^(insp|move)-/, "inspections"],
  [/^key-/, "keys"],
];

/** Briefing items are keyed by id; the prefix says which section they come from. */
export function briefingItemVisible(id: string): boolean {
  for (const [re, f] of BRIEFING_ITEM_FEATURES) if (re.test(id)) return featureOn(f);
  return true;
}

/* -------------------------------- Assistant ------------------------------ */

/** A question about a section that is switched off gets a friendly "not in this edition". */
export function hiddenTopicIn(q: string): FeatureKey | null {
  // "How much did we spend on maintenance" is an expenses question (visible), not a maintenance one.
  const spendQuestion = /\b(spend|spent|expenses?|costs?|paid|pay|how much|invoices?|capex)\b/.test(q);
  const table: [RegExp, FeatureKey, boolean?][] = [
    [/\bbudgets?\b|\bover budget\b/, "budgets"],
    [/\b(security )?deposits?\b/, "deposits"],
    [/\b(utilit\w*|meter readings?|utility readings?|consumption)\b/, "utilities"],
    [/\bcommon charges?\b|\bservice charges?\b/, "charges"],
    [/\b(cash ?flow|forecast|projection|projected|expected (income|cash|money)|coming months?)\b/, "cashflow"],
    [/\b(work orders?|tickets?|preventive|services? (are )?due|technician visits?|jobs?|needs? (a )?service|service (is )?due|keeps? (breaking|failing)|recurring (problems?|issues?)|same problem)\b/, "maintenance"],
    [/\b(maintenance|repairs?)\b/, "maintenance", true],
    [/\b(suppliers?|contractors?|technicians?|vendors?)\b/, "suppliers"],
    [/\b(inspections?|checklists?|move[- ]?(in|out) (inspection|checklist)s?)\b/, "inspections"],
    [/\b(lost|spare|issued|apartment|building|mailbox|office|extra) keys?\b|\bkey register\b|\bkeys? (issued|returned|lost|held)\b/, "keys"],
    [/\bparking\b/, "parking"],
    [/\brenovations?\b/, "renovations"],
    [/\banalytics\b/, "analytics"],
    [/\b(documents?|paperwork|passports?|id cards?|ids?|identification|missing id|expired ids?)\b/, "documents"],
    [/\breports?\b|\bexport\b/, "reports"],
  ];
  for (const [re, f, skipIfSpend] of table) if (re.test(q) && !(skipIfSpend && spendQuestion) && !featureOn(f)) return f;
  return null;
}

/* -------------------------------- Timelines ------------------------------ */

const TIMELINE_KIND_FEATURES: Record<string, FeatureKey> = { maintenance: "maintenance", inspection: "inspections", renovation: "renovations", deposit: "deposits", document: "documents" };

/** Timeline events of hidden sections stay out of the building, unit and tenant histories. */
export function timelineKindVisible(kind: string): boolean {
  const f = TIMELINE_KIND_FEATURES[kind];
  return f === undefined || featureOn(f);
}
