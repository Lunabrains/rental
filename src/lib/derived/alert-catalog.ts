import type { AlertCategory, AlertSeverity, AlertThresholds, AlertType } from "@/types";

export type ThresholdKey = keyof AlertThresholds;
export type ThresholdUnit = "days" | "$" | "%" | "count" | "months" | "×";

export interface ThresholdField {
  key: ThresholdKey;
  label: string;
  hint: string;
  unit: ThresholdUnit;
}

/** Every tunable number the rule engine reads, with how to show it. */
export const THRESHOLD_FIELDS: ThresholdField[] = [
  { key: "paymentDueSoonDays", label: "Rent due soon", hint: "Warn this many days before a due date", unit: "days" },
  { key: "repeatLateMinCount", label: "Repeat late payer — times", hint: "Late at least this many times…", unit: "count" },
  { key: "repeatLateWindowMonths", label: "Repeat late payer — window", hint: "…within the last N months", unit: "months" },
  { key: "tenantBalanceHighMonths", label: "High tenant balance", hint: "Balance above N months of rent", unit: "months" },
  { key: "outstandingWarning", label: "Portfolio outstanding", hint: "Warn when total outstanding rent exceeds this", unit: "$" },
  { key: "contractCriticalDays", label: "Contract ending — critical", hint: "Contracts ending within this window", unit: "days" },
  { key: "contractWarningDays", label: "Contract ending — warning", hint: "Contracts ending within this window", unit: "days" },
  { key: "contractInfoDays", label: "Contract ending — heads-up", hint: "Contracts ending within this window", unit: "days" },
  { key: "expiryClusterCount", label: "Renewal wave", hint: "Warn when this many contracts end in one month", unit: "count" },
  { key: "vacantWarningDays", label: "Vacancy — warning", hint: "Unit empty longer than this", unit: "days" },
  { key: "vacantCriticalDays", label: "Vacancy — critical", hint: "…and longer than this becomes critical", unit: "days" },
  { key: "buildingOccupancyWarning", label: "Building occupancy", hint: "Warn when a building falls below this", unit: "%" },
  { key: "idExpiringDays", label: "Tenant ID expiring", hint: "Days before an ID document lapses", unit: "days" },
  { key: "certificateExpiringDays", label: "Certificate expiring", hint: "Days before a certificate or licence lapses", unit: "days" },
  { key: "insuranceExpiringDays", label: "Insurance expiring", hint: "Days before a building policy lapses", unit: "days" },
  { key: "workOrderOpenTooLongDays", label: "Work order open too long", hint: "Open longer than this without completion", unit: "days" },
  { key: "repeatIssueMinCount", label: "Repeat issue — times", hint: "Same category on the same unit or asset at least N times…", unit: "count" },
  { key: "repeatIssueWindowDays", label: "Repeat issue — window", hint: "…within this many days", unit: "days" },
  { key: "maintenanceCostHighMultiplier", label: "Maintenance spend spike", hint: "Month above N × the 6-month average", unit: "×" },
  { key: "serviceDueSoonDays", label: "Service due soon", hint: "Days before a preventive service falls due", unit: "days" },
  { key: "warrantyExpiringDays", label: "Warranty expiring", hint: "Days before an asset warranty ends", unit: "days" },
  { key: "budgetOverPct", label: "Over budget", hint: "Actual exceeds budget by this share", unit: "%" },
  { key: "expenseUnusualMultiplier", label: "Unusual expense", hint: "Expense above N × the category's average", unit: "×" },
  { key: "inspectionOverdueDays", label: "Inspection grace", hint: "Days past the scheduled date before it is overdue", unit: "days" },
  { key: "moveOutInspectionLeadDays", label: "Move-out lead", hint: "Days before a contract ends to plan the move-out", unit: "days" },
  { key: "moveInInspectionLeadDays", label: "Move-in lead", hint: "Days before a contract starts to plan the move-in", unit: "days" },
  { key: "forecastHorizonDays", label: "Forecast horizon", hint: "Days the cash-flow forecast looks ahead", unit: "days" },
];

export interface AlertRule {
  type: AlertType;
  label: string;
  description: string;
  category: AlertCategory;
  severity: AlertSeverity | "varies";
  thresholds: ThresholdKey[];
}

const rule = (type: AlertType, label: string, description: string, category: AlertCategory, severity: AlertSeverity | "varies", thresholds: ThresholdKey[] = []): AlertRule => ({ type, label, description, category, severity, thresholds });

/** The rule book: every alert the engine can raise, what it means and which thresholds drive it. */
export const ALERT_RULES: Record<AlertType, AlertRule> = {
  payment_overdue: rule("payment_overdue", "Rent overdue", "A rent instalment is past its due date and not fully paid.", "payment", "critical"),
  payment_partial: rule("payment_partial", "Partial payment", "Part of an instalment was paid; the remainder is still open.", "payment", "warning"),
  payment_repeat_late: rule("payment_repeat_late", "Repeat late payer", "The tenant paid late several times in the look-back window.", "payment", "warning", ["repeatLateMinCount", "repeatLateWindowMonths"]),
  payment_due_today: rule("payment_due_today", "Rent due today", "An instalment falls due today.", "payment", "attention"),
  payment_due_soon: rule("payment_due_soon", "Rent due soon", "An instalment falls due within the notice window.", "payment", "info", ["paymentDueSoonDays"]),
  tenant_balance_high: rule("tenant_balance_high", "Tenant balance unusually high", "Outstanding balance exceeds N months of rent.", "payment", "critical", ["tenantBalanceHighMonths"]),
  contract_expired_occupied: rule("contract_expired_occupied", "Contract expired, tenant still in", "The contract ended but the tenant has not moved out or renewed.", "contract", "critical"),
  contract_expires_7d: rule("contract_expires_7d", "Contract ending — critical", "Ends within the critical window without a decision.", "contract", "critical", ["contractCriticalDays"]),
  contract_expires_30d: rule("contract_expires_30d", "Contract ending — warning", "Ends within the warning window.", "contract", "warning", ["contractWarningDays"]),
  contract_expires_60d: rule("contract_expires_60d", "Contract ending — attention", "Ends within the attention window.", "contract", "attention", ["contractInfoDays"]),
  contract_expires_90d: rule("contract_expires_90d", "Contract ending — heads-up", "Ends within the heads-up window.", "contract", "info", ["contractInfoDays"]),
  contract_renewal_pending: rule("contract_renewal_pending", "Renewal decision pending", "The renewal is awaiting the owner's decision.", "contract", "attention"),
  occupancy_vacant_long: rule("occupancy_vacant_long", "Unit vacant too long", "Empty longer than the warning threshold.", "occupancy", "warning", ["vacantWarningDays"]),
  occupancy_vacant_critical: rule("occupancy_vacant_critical", "Unit vacant — critical", "Empty longer than the critical threshold.", "occupancy", "critical", ["vacantCriticalDays"]),
  occupancy_building_low: rule("occupancy_building_low", "Building occupancy low", "A building's occupancy fell below the warning level.", "occupancy", "warning", ["buildingOccupancyWarning"]),
  occupancy_unit_available: rule("occupancy_unit_available", "Unit available", "A unit became available (internal tracking only).", "occupancy", "info"),
  document_missing_id: rule("document_missing_id", "Tenant ID missing", "No identity document on the tenant's file.", "document", "attention"),
  document_missing_contract: rule("document_missing_contract", "Contract file missing", "No signed contract document attached.", "document", "attention"),
  document_id_expiring: rule("document_id_expiring", "Tenant ID expiring", "An identity document lapses soon.", "document", "info", ["idExpiringDays"]),
  document_certificate_expiring: rule("document_certificate_expiring", "Certificate expiring", "A certificate, licence or permit lapses soon.", "document", "warning", ["certificateExpiringDays"]),
  property_insurance_expiring: rule("property_insurance_expiring", "Insurance expiring", "A building policy lapses soon.", "document", "warning", ["insuranceExpiringDays"]),
  portfolio_outstanding_high: rule("portfolio_outstanding_high", "Outstanding rent high", "Total outstanding across the portfolio exceeds the limit.", "portfolio", "warning", ["outstandingWarning"]),
  portfolio_expiry_cluster: rule("portfolio_expiry_cluster", "Renewal wave", "Many contracts end in the same month.", "portfolio", "attention", ["expiryClusterCount"]),
  portfolio_revenue_down: rule("portfolio_revenue_down", "Revenue down", "The monthly rent roll fell versus last month.", "portfolio", "attention"),
  maintenance_emergency_open: rule("maintenance_emergency_open", "Emergency open", "An emergency work order is not yet resolved.", "maintenance", "critical"),
  maintenance_open_too_long: rule("maintenance_open_too_long", "Work order open too long", "Open past the allowed number of days.", "maintenance", "warning", ["workOrderOpenTooLongDays"]),
  maintenance_repeat_issue: rule("maintenance_repeat_issue", "Repeat issue", "The same category keeps recurring on a unit or asset.", "maintenance", "warning", ["repeatIssueMinCount", "repeatIssueWindowDays"]),
  maintenance_cost_high: rule("maintenance_cost_high", "Maintenance spend spike", "A building's month is far above its recent average.", "maintenance", "attention", ["maintenanceCostHighMultiplier"]),
  maintenance_awaiting_approval: rule("maintenance_awaiting_approval", "Awaiting approval", "A quote is waiting for the owner's approval.", "maintenance", "attention"),
  preventive_service_due: rule("preventive_service_due", "Service due soon", "A preventive service falls due within the window.", "preventive", "info", ["serviceDueSoonDays"]),
  preventive_service_overdue: rule("preventive_service_overdue", "Service overdue", "A preventive service is past its due date.", "preventive", "warning"),
  asset_warranty_expiring: rule("asset_warranty_expiring", "Warranty expiring", "An asset's warranty ends soon.", "preventive", "info", ["warrantyExpiringDays"]),
  asset_out_of_service: rule("asset_out_of_service", "Asset out of service", "Critical equipment is down.", "maintenance", "critical"),
  budget_over: rule("budget_over", "Over budget", "Actual spend exceeds the budget line by the allowed share.", "finance", "warning", ["budgetOverPct"]),
  expense_unusual: rule("expense_unusual", "Unusual expense", "An expense is far above the category's usual amount.", "finance", "attention", ["expenseUnusualMultiplier"]),
  expense_overdue: rule("expense_overdue", "Supplier invoice overdue", "An unpaid expense is past its due date.", "finance", "warning"),
  noi_deteriorating: rule("noi_deteriorating", "NOI deteriorating", "Net operating income is trending down.", "finance", "attention"),
  deposit_unsettled: rule("deposit_unsettled", "Deposit not settled", "The tenancy ended but the deposit was not refunded or closed.", "finance", "warning"),
  deposit_not_received: rule("deposit_not_received", "Deposit not received", "A contract started without its deposit being collected.", "finance", "warning"),
  inspection_overdue: rule("inspection_overdue", "Inspection overdue", "A scheduled inspection is past its date plus grace.", "inspection", "warning", ["inspectionOverdueDays"]),
  inspection_followup_open: rule("inspection_followup_open", "Failed item without follow-up", "A completed inspection has failed items with no work order.", "inspection", "attention"),
  move_out_unplanned: rule("move_out_unplanned", "Move-out not planned", "A tenant is leaving and no move-out checklist exists.", "inspection", "varies", ["moveOutInspectionLeadDays", "inspectionOverdueDays"]),
  move_in_unplanned: rule("move_in_unplanned", "Move-in not planned", "A contract is starting without a condition report.", "inspection", "attention", ["moveInInspectionLeadDays", "inspectionOverdueDays"]),
  key_lost: rule("key_lost", "Key lost", "A key is recorded as lost; consider changing the lock.", "inspection", "varies"),
  renovation_over_budget: rule("renovation_over_budget", "Project over budget", "CapEx booked against a project exceeds its budget.", "finance", "warning"),
  renovation_delayed: rule("renovation_delayed", "Project behind schedule", "A live project is past its target end date.", "maintenance", "attention"),
  reminder_due: rule("reminder_due", "Reminder due", "A reminder you set has come due.", "reminder", "attention"),
};

export const ALERT_TYPES = Object.keys(ALERT_RULES) as AlertType[];

export const CATEGORY_LABELS: Record<AlertCategory, string> = {
  payment: "Payments",
  contract: "Contracts & renewals",
  occupancy: "Occupancy",
  document: "Documents & compliance",
  portfolio: "Portfolio",
  maintenance: "Maintenance",
  preventive: "Preventive & assets",
  finance: "Finance",
  inspection: "Inspections, moves & keys",
  reminder: "Reminders",
};

export function rulesByCategory(): { category: AlertCategory; rules: AlertRule[] }[] {
  const order: AlertCategory[] = ["payment", "contract", "occupancy", "finance", "maintenance", "preventive", "inspection", "document", "portfolio", "reminder"];
  return order.map((category) => ({ category, rules: ALERT_TYPES.map((t) => ALERT_RULES[t]).filter((r) => r.category === category) })).filter((g) => g.rules.length > 0);
}

export function thresholdField(key: ThresholdKey): ThresholdField {
  return THRESHOLD_FIELDS.find((f) => f.key === key) ?? { key, label: key, hint: "", unit: "count" };
}
