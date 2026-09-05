/**
 * Entity model for the Rental Portfolio Command Center.
 *
 * Every field that can be derived (payment status, days late, alerts, KPIs) is
 * recomputed by `/lib/derived` after load and after every command — it is never
 * seeded and never written by the UI.
 */

/** `YYYY-MM-DD` */
export type ISODate = string;
/** Full ISO-8601 timestamp */
export type ISODateTime = string;
/** `YYYY-MM` */
export type PeriodMonth = string;

export type ID = string;

export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "bank_transfer",
  "cheque",
  "card",
];

/* -------------------------------------------------------------------------- */
/* Property                                                                    */
/* -------------------------------------------------------------------------- */

export type PropertyType = "residential" | "mixed_use" | "commercial";
export const PROPERTY_TYPES: PropertyType[] = ["residential", "mixed_use", "commercial"];

export type PropertyStatus = "active" | "under_renovation" | "sold";
export const PROPERTY_STATUSES: PropertyStatus[] = ["active", "under_renovation", "sold"];

export interface Property {
  id: ID;
  /** Stable human key used for idempotent import (`property_code`). */
  code: string;
  name: string;
  address: string;
  district: string;
  city: string;
  country: string;
  yearBuilt: number | null;
  /** Fixed rectangular layout: floors × unitsPerFloor. */
  floors: number;
  unitsPerFloor: number;
  type: PropertyType;
  status: PropertyStatus;
  acquisitionDate: ISODate | null;
  acquisitionCost: number | null;
  /** Owner's estimate — informational only. */
  estimatedValue: number | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: ISODate | null;
  imageUrl: string | null;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Unit                                                                        */
/* -------------------------------------------------------------------------- */

/** `available` = vacant, `rented` = occupied; the others are owner overrides. */
export type UnitStatus = "available" | "rented" | "reserved" | "maintenance" | "renovation" | "unavailable";

export const UNIT_STATUSES: UnitStatus[] = [
  "available",
  "rented",
  "reserved",
  "maintenance",
  "renovation",
  "unavailable",
];

/** Statuses the owner can set by hand; rented/available are derived from contracts. */
export const UNIT_STATUS_OVERRIDES: UnitStatus[] = ["maintenance", "reserved", "renovation", "unavailable"];

export type UnitCondition = "good" | "fair" | "needs_work" | "poor";
export const UNIT_CONDITIONS: UnitCondition[] = ["good", "fair", "needs_work", "poor"];

export interface Unit {
  id: ID;
  propertyId: ID;
  /** e.g. "403" — unique within a property. */
  unitNumber: string;
  floor: number;
  bedrooms: number;
  bathrooms: number;
  sizeSqm: number;
  furnished: boolean;
  status: UnitStatus;
  askingRent: number;
  askingDeposit: number;
  /** Reference rent for vacancy-loss estimates; null → asking / last rent. */
  marketRent: number | null;
  condition: UnitCondition;
  /** Set when the unit became available; null while rented. */
  availableSince: ISODate | null;
  lastRent: number | null;
  previousTenantId: ID | null;
  notes: string | null;
}

/* -------------------------------------------------------------------------- */
/* Tenant                                                                      */
/* -------------------------------------------------------------------------- */

export type IdDocumentType = "national_id" | "passport" | "residency_permit";

export interface Tenant {
  id: ID;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  nationality: string;
  idType: IdDocumentType;
  idNumber: string;
  photoUrl: string | null;
  occupation: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Contract                                                                    */
/* -------------------------------------------------------------------------- */

export type ContractStatus =
  | "active"
  | "expired"
  | "renewed"
  | "terminated"
  | "notice_given";

export const CONTRACT_STATUSES: ContractStatus[] = [
  "active",
  "expired",
  "renewed",
  "terminated",
  "notice_given",
];

export type PaymentFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";
export const PAYMENT_FREQUENCIES: PaymentFrequency[] = ["monthly", "quarterly", "semi_annual", "annual"];
export const FREQUENCY_MONTHS: Record<PaymentFrequency, number> = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 };

/** The owner's decision on an expiring contract. */
export type RenewalDecision = "awaiting_decision" | "renew" | "do_not_renew";
export const RENEWAL_DECISIONS: RenewalDecision[] = ["awaiting_decision", "renew", "do_not_renew"];

/** Derived: decision + time left + contract status. */
export type RenewalStatus = "not_due" | "upcoming" | "awaiting_decision" | "renew" | "do_not_renew" | "renewed" | "ended";
export const RENEWAL_STATUSES: RenewalStatus[] = ["not_due", "upcoming", "awaiting_decision", "renew", "do_not_renew", "renewed", "ended"];

export interface Contract {
  id: ID;
  /** Stable human key used for idempotent import. */
  contractNumber: string;
  propertyId: ID;
  unitId: ID;
  tenantId: ID;
  startDate: ISODate;
  endDate: ISODate;
  durationMonths: number;
  monthlyRent: number;
  deposit: number;
  /** Day of month rent falls due, 1–28. */
  paymentDay: number;
  paymentFrequency: PaymentFrequency;
  paymentMethod: PaymentMethod;
  status: ContractStatus;
  /** Set by `markAsLeaving`. */
  moveOutDate: ISODate | null;
  /** Renewal chain. */
  renewedFromContractId: ID | null;
  renewedToContractId: ID | null;
  rentIncreaseClause: string | null;
  specialTerms: string | null;
  renewalDecision: RenewalDecision | null;
  /** Derived by `recompute()`. */
  renewalStatus: RenewalStatus;
  proposedRent: number | null;
  renewalNotes: string | null;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Payment                                                                     */
/* -------------------------------------------------------------------------- */

export type PaymentStatus =
  | "paid"
  | "partial"
  | "overdue"
  | "due"
  | "scheduled"
  | "waived";

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "paid",
  "partial",
  "overdue",
  "due",
  "scheduled",
  "waived",
];

export interface Payment {
  id: ID;
  contractId: ID;
  propertyId: ID;
  unitId: ID;
  tenantId: ID;
  periodMonth: PeriodMonth;
  dueDate: ISODate;
  amountDue: number;
  amountPaid: number;
  paidDate: ISODate | null;
  method: PaymentMethod | null;
  reference: string | null;
  note: string | null;
  /** Owner forgave the balance — derived status becomes `waived`. */
  waived: boolean;
  /** Derived by `recompute()`. */
  status: PaymentStatus;
  /** Derived: days between dueDate and paidDate (or today if unpaid). */
  daysLate: number;
}

/* -------------------------------------------------------------------------- */
/* Expense                                                                     */
/* -------------------------------------------------------------------------- */

export const EXPENSE_CATEGORIES = [
  "maintenance",
  "elevator",
  "plumbing",
  "electrical",
  "hvac",
  "generator",
  "cleaning",
  "security",
  "water",
  "electricity",
  "municipality",
  "insurance",
  "taxes",
  "renovation",
  "staff",
  "contractor",
  "common_area",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseClassification = "operating" | "capex";
export type ExpensePaymentStatus = "unpaid" | "paid" | "scheduled";
export const EXPENSE_PAYMENT_STATUSES: ExpensePaymentStatus[] = ["unpaid", "paid", "scheduled"];
export type Recurrence = "monthly" | "quarterly" | "semi_annual" | "annual";
export const RECURRENCES: Recurrence[] = ["monthly", "quarterly", "semi_annual", "annual"];

export interface Expense {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  supplierId: ID | null;
  category: ExpenseCategory;
  amount: number;
  expenseDate: ISODate;
  dueDate: ISODate | null;
  paymentStatus: ExpensePaymentStatus;
  paidDate: ISODate | null;
  recurring: boolean;
  recurrence: Recurrence | null;
  description: string;
  /** Invoice / receipt document. */
  documentId: ID | null;
  classification: ExpenseClassification;
  workOrderId: ID | null;
  renovationId: ID | null;
  assetId: ID | null;
  invoiceNumber: string | null;
  notes: string | null;
  /** Soft delete — financial records are never hard-deleted. */
  deleted: boolean;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Budget                                                                      */
/* -------------------------------------------------------------------------- */

export type BudgetPeriodType = "month" | "year";

export interface Budget {
  id: ID;
  propertyId: ID;
  periodType: BudgetPeriodType;
  /** `YYYY-MM` for month, `YYYY` for year. */
  period: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
}

/* -------------------------------------------------------------------------- */
/* Security deposit                                                            */
/* -------------------------------------------------------------------------- */

export type DepositStatus = "pending" | "held" | "settled";
export const DEPOSIT_STATUSES: DepositStatus[] = ["pending", "held", "settled"];

export interface DepositDeduction {
  id: ID;
  description: string;
  amount: number;
  date: ISODate;
}

export interface SecurityDeposit {
  id: ID;
  contractId: ID;
  tenantId: ID;
  unitId: ID;
  propertyId: ID;
  amountExpected: number;
  amountReceived: number;
  receivedDate: ISODate | null;
  deductions: DepositDeduction[];
  finalRefund: number | null;
  settlementDate: ISODate | null;
  settlementNotes: string | null;
  /** Derived: pending until received, held while the tenancy runs, settled after refund. */
  status: DepositStatus;
  /** Derived: received − deductions − refund. */
  amountHeld: number;
}

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                 */
/* -------------------------------------------------------------------------- */

export const WORK_ORDER_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "elevator",
  "generator",
  "appliance",
  "structural",
  "painting",
  "cleaning",
  "pest_control",
  "security",
  "water",
  "other",
] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];

export type WorkOrderPriority = "low" | "normal" | "high" | "emergency";
export const WORK_ORDER_PRIORITIES: WorkOrderPriority[] = ["low", "normal", "high", "emergency"];

export type WorkOrderStatus =
  | "open"
  | "assigned"
  | "awaiting_quote"
  | "awaiting_approval"
  | "in_progress"
  | "completed"
  | "closed"
  | "cancelled";
export const WORK_ORDER_STATUSES: WorkOrderStatus[] = [
  "open",
  "assigned",
  "awaiting_quote",
  "awaiting_approval",
  "in_progress",
  "completed",
  "closed",
  "cancelled",
];
export const OPEN_WORK_ORDER_STATUSES: WorkOrderStatus[] = ["open", "assigned", "awaiting_quote", "awaiting_approval", "in_progress"];

export type WorkOrderSource = "owner" | "tenant" | "inspection" | "preventive" | "assistant";

export interface StatusChange<S extends string = string> {
  status: S;
  at: ISODateTime;
  note: string | null;
}

export interface WorkOrder {
  id: ID;
  /** Human number, e.g. WO-0042. */
  number: string;
  propertyId: ID;
  unitId: ID | null;
  assetId: ID | null;
  tenantId: ID | null;
  title: string;
  description: string;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  source: WorkOrderSource;
  reportedAt: ISODate;
  supplierId: ID | null;
  estimatedCost: number | null;
  actualCost: number | null;
  approvalRequired: boolean;
  approvedAt: ISODate | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  closedAt: ISODate | null;
  beforePhotoIds: ID[];
  afterPhotoIds: ID[];
  invoiceDocumentId: ID | null;
  notes: string | null;
  /** Earlier work order this one repeats (set by hand or by detection). */
  repeatOfWorkOrderId: ID | null;
  inspectionId: ID | null;
  preventivePlanId: ID | null;
  statusHistory: StatusChange<WorkOrderStatus>[];
  createdAt: ISODate;
}

export type PlanStatus = "active" | "paused";

export interface PreventivePlan {
  id: ID;
  propertyId: ID;
  assetId: ID | null;
  maintenanceType: string;
  recurrenceMonths: number;
  lastServiceDate: ISODate | null;
  nextServiceDate: ISODate;
  supplierId: ID | null;
  estimatedCost: number | null;
  status: PlanStatus;
  /** Days before the due date an alert is raised. */
  reminderDays: number;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

export const ASSET_TYPES = [
  "elevator",
  "generator",
  "water_pump",
  "water_tank",
  "hvac",
  "fire_system",
  "cctv",
  "access_control",
  "boiler",
  "solar_system",
  "electrical_panel",
  "parking_gate",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export type AssetStatus = "operational" | "degraded" | "out_of_service" | "retired";
export const ASSET_STATUSES: AssetStatus[] = ["operational", "degraded", "out_of_service", "retired"];

export interface Asset {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  assetType: AssetType;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: ISODate | null;
  purchaseCost: number | null;
  warrantyExpiry: ISODate | null;
  supplierId: ID | null;
  status: AssetStatus;
  lastServiceDate: ISODate | null;
  /** Derived from the earliest active preventive plan when one exists. */
  nextServiceDate: ISODate | null;
  /** Stable QR identifier, e.g. AST-BH-ELEV1. */
  qrCode: string;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                   */
/* -------------------------------------------------------------------------- */

export const SUPPLIER_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "elevator",
  "generator",
  "cleaning",
  "security",
  "general_contractor",
  "painting",
  "pest_control",
  "appliance",
  "other",
] as const;
export type SupplierCategory = (typeof SUPPLIER_CATEGORIES)[number];

export interface Supplier {
  id: ID;
  name: string;
  category: SupplierCategory;
  phone: string;
  email: string;
  company: string | null;
  services: string[];
  notes: string | null;
  active: boolean;
  /** Manual 1–5 rating; null = not rated. */
  rating: number | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Utilities & common charges                                                  */
/* -------------------------------------------------------------------------- */

export type UtilityType = "electricity" | "water" | "generator" | "gas" | "other";
export const UTILITY_TYPES: UtilityType[] = ["electricity", "water", "generator", "gas", "other"];
export type BillingMethod = "metered" | "flat" | "included";
export const BILLING_METHODS: BillingMethod[] = ["metered", "flat", "included"];

export interface UtilityMeter {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  utilityType: UtilityType;
  meterNumber: string;
  billingMethod: BillingMethod;
  /** Price per unit of consumption when tracked by hand. */
  unitRate: number | null;
  unitLabel: string;
  createdAt: ISODate;
}

export interface UtilityReading {
  id: ID;
  meterId: ID;
  readingDate: ISODate;
  previousReading: number;
  currentReading: number;
  /** Derived: current − previous (0 after a reset). */
  consumption: number;
  /** Derived: consumption × unit rate when a rate exists. */
  calculatedAmount: number | null;
  documentId: ID | null;
  /** Meter replaced / reset — a lower reading is expected. */
  meterReset: boolean;
  note: string | null;
}

export type AllocationMethod = "equal" | "by_area" | "by_bedrooms" | "custom";
export const ALLOCATION_METHODS: AllocationMethod[] = ["equal", "by_area", "by_bedrooms", "custom"];

export interface ChargeAllocation {
  unitId: ID;
  amount: number;
  paid: boolean;
  paidDate: ISODate | null;
}

export interface CommonCharge {
  id: ID;
  propertyId: ID;
  period: PeriodMonth;
  category: string;
  totalAmount: number;
  allocationMethod: AllocationMethod;
  allocations: ChargeAllocation[];
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export type InspectionType = "move_in" | "move_out" | "annual_unit" | "building" | "safety" | "asset";
export const INSPECTION_TYPES: InspectionType[] = ["move_in", "move_out", "annual_unit", "building", "safety", "asset"];
export type InspectionStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export const INSPECTION_STATUSES: InspectionStatus[] = ["scheduled", "in_progress", "completed", "cancelled"];
export type InspectionResult = "pass" | "fail" | "attention";
export type ItemResult = InspectionResult | "na";

export interface InspectionItem {
  id: ID;
  area: string;
  item: string;
  result: ItemResult;
  notes: string | null;
  photoIds: ID[];
  followUpRequired: boolean;
  workOrderId: ID | null;
}

export interface Inspection {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  assetId: ID | null;
  tenantId: ID | null;
  contractId: ID | null;
  type: InspectionType;
  scheduledDate: ISODate;
  completedDate: ISODate | null;
  inspector: string;
  status: InspectionStatus;
  overallResult: InspectionResult | null;
  notes: string | null;
  items: InspectionItem[];
  /** Move-in / move-out extras. */
  meterReadingIds: ID[];
  keyItemIds: ID[];
  depositId: ID | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Renovation / CapEx                                                          */
/* -------------------------------------------------------------------------- */

export type RenovationType = "renovation" | "upgrade" | "repair" | "expansion";
export const RENOVATION_TYPES: RenovationType[] = ["renovation", "upgrade", "repair", "expansion"];
export type RenovationStatus = "planned" | "in_progress" | "on_hold" | "completed" | "cancelled";
export const RENOVATION_STATUSES: RenovationStatus[] = ["planned", "in_progress", "on_hold", "completed", "cancelled"];

export interface RenovationTask {
  id: ID;
  title: string;
  done: boolean;
  dueDate: ISODate | null;
}

export interface Renovation {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  title: string;
  description: string;
  projectType: RenovationType;
  budget: number;
  /** Derived: sum of CapEx expenses linked to the project. */
  actualCost: number;
  contractorSupplierId: ID | null;
  startDate: ISODate;
  targetEndDate: ISODate;
  actualEndDate: ISODate | null;
  progressPercent: number;
  status: RenovationStatus;
  tasks: RenovationTask[];
  photoIds: ID[];
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Parking & keys                                                              */
/* -------------------------------------------------------------------------- */

export type ParkingStatus = "assigned" | "free" | "reserved" | "unavailable";
export const PARKING_STATUSES: ParkingStatus[] = ["assigned", "free", "reserved", "unavailable"];

export interface ParkingSpace {
  id: ID;
  propertyId: ID;
  spaceNumber: string;
  unitId: ID | null;
  tenantId: ID | null;
  vehiclePlate: string | null;
  paid: boolean;
  monthlyFee: number;
  status: ParkingStatus;
  notes: string | null;
}

export type KeyType = "apartment_key" | "building_key" | "mailbox_key" | "access_card" | "parking_remote" | "other";
export const KEY_TYPES: KeyType[] = ["apartment_key", "building_key", "mailbox_key", "access_card", "parking_remote", "other"];
export type KeyStatus = "in_office" | "issued" | "returned" | "lost";
export const KEY_STATUSES: KeyStatus[] = ["in_office", "issued", "returned", "lost"];

export interface KeyItem {
  id: ID;
  propertyId: ID;
  unitId: ID | null;
  type: KeyType;
  identifier: string;
  assignedTo: string | null;
  tenantId: ID | null;
  issuedDate: ISODate | null;
  returnedDate: ISODate | null;
  status: KeyStatus;
  notes: string | null;
}

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

export type DocumentKind =
  | "id"
  | "passport"
  | "contract"
  | "receipt"
  | "other";

export const DOCUMENT_CATEGORIES = [
  "lease",
  "tenant_id",
  "ownership",
  "insurance",
  "invoice",
  "receipt",
  "quotation",
  "inspection",
  "maintenance_report",
  "certificate",
  "warranty",
  "municipality",
  "photo",
  "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface StoredDocument {
  id: ID;
  kind: DocumentKind;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  sizeKb: number;
  tenantId: ID | null;
  contractId: ID | null;
  unitId: ID | null;
  propertyId: ID | null;
  paymentId: ID | null;
  expenseId: ID | null;
  workOrderId: ID | null;
  assetId: ID | null;
  supplierId: ID | null;
  inspectionId: ID | null;
  renovationId: ID | null;
  issuedDate: ISODate | null;
  expiryDate: ISODate | null;
  uploadedAt: ISODate;
  /** True for receipts produced by `recordPayment`. */
  generated: boolean;
  /** Object URL of a file added in this session (never persisted). */
  dataUrl: string | null;
  /** Soft delete — the record stays for the audit trail. */
  deleted: boolean;
  /** What the app read from the file (rules or model) — kept apart from the manual fields. */
  extraction?: DocumentExtractionRecord | null;
  /** Set when the owner confirmed the filing on the review screen. */
  reviewedAt?: ISODate | null;
}

export interface DocumentExtractionRecord {
  source: "rules" | "model";
  at: ISODate;
  docType: DocumentCategory;
  fields: { key: string; value: string; confidence: number }[];
}

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

export type AlertSeverity = "critical" | "warning" | "attention" | "info";

export const ALERT_SEVERITIES: AlertSeverity[] = [
  "critical",
  "warning",
  "attention",
  "info",
];

export type AlertCategory =
  | "payment"
  | "contract"
  | "occupancy"
  | "document"
  | "portfolio"
  | "maintenance"
  | "preventive"
  | "finance"
  | "inspection"
  | "reminder";

export const ALERT_CATEGORIES: AlertCategory[] = [
  "payment",
  "contract",
  "occupancy",
  "document",
  "portfolio",
  "maintenance",
  "preventive",
  "finance",
  "inspection",
  "reminder",
];

/** One id per rule. */
export type AlertType =
  | "payment_overdue"
  | "payment_partial"
  | "payment_repeat_late"
  | "payment_due_today"
  | "payment_due_soon"
  | "tenant_balance_high"
  | "contract_expired_occupied"
  | "contract_expires_7d"
  | "contract_expires_30d"
  | "contract_expires_60d"
  | "contract_expires_90d"
  | "contract_renewal_pending"
  | "occupancy_vacant_long"
  | "occupancy_vacant_critical"
  | "occupancy_building_low"
  | "occupancy_unit_available"
  | "document_missing_id"
  | "document_missing_contract"
  | "document_id_expiring"
  | "document_certificate_expiring"
  | "property_insurance_expiring"
  | "portfolio_outstanding_high"
  | "portfolio_expiry_cluster"
  | "portfolio_revenue_down"
  | "maintenance_emergency_open"
  | "maintenance_open_too_long"
  | "maintenance_repeat_issue"
  | "maintenance_cost_high"
  | "maintenance_awaiting_approval"
  | "preventive_service_due"
  | "preventive_service_overdue"
  | "asset_warranty_expiring"
  | "asset_out_of_service"
  | "budget_over"
  | "expense_unusual"
  | "expense_overdue"
  | "noi_deteriorating"
  | "deposit_unsettled"
  | "deposit_not_received"
  | "inspection_overdue"
  | "inspection_followup_open"
  | "move_out_unplanned"
  | "move_in_unplanned"
  | "key_lost"
  | "renovation_over_budget"
  | "renovation_delayed"
  | "reminder_due";

export type AlertEntityType =
  | "payment"
  | "contract"
  | "unit"
  | "tenant"
  | "property"
  | "portfolio"
  | "expense"
  | "work_order"
  | "asset"
  | "supplier"
  | "inspection"
  | "renovation"
  | "budget"
  | "preventive_plan"
  | "deposit"
  | "meter"
  | "reminder"
  | "key"
  | "parking";

export type AlertActionKind =
  | "record_payment"
  | "send_reminder"
  | "renew_contract"
  | "mark_as_leaving"
  | "view_unit"
  | "view_tenant"
  | "view_property"
  | "view_contract"
  | "upload_document"
  | "view_work_order"
  | "view_asset"
  | "view_expense"
  | "view_supplier"
  | "view_inspection"
  | "schedule_inspection"
  | "view_keys"
  | "view_renovation"
  | "view_plan"
  | "view_deposit"
  | "view_budget"
  | "create_work_order"
  | "approve_work_order"
  | "record_expense_payment"
  | "schedule_service"
  | "settle_deposit"
  | "complete_reminder"
  | "resolve_alert";

export interface AlertAction {
  kind: AlertActionKind;
  label: string;
  /** Entity the action operates on (payment id, contract id, unit id …). */
  targetId: ID;
}

export type AlertOrigin = "rule" | "ai" | "manual";

export interface Alert {
  /** Deterministic: `${type}:${entityId}`. Alerts update, never duplicate. */
  id: string;
  type: AlertType;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  entityType: AlertEntityType;
  entityId: ID;
  propertyId: ID | null;
  unitId: ID | null;
  tenantId: ID | null;
  actions: AlertAction[];
  /** Money or days at stake — used for ranking. */
  weight: number;
  /** When the underlying obligation falls due, if it has a date. */
  dueDate: ISODate | null;
  generatedBy: AlertOrigin;
  createdAt: ISODateTime;
  read: boolean;
  dismissed: boolean;
  /** Owner marked it handled; it stays hidden until the condition changes. */
  resolved: boolean;
  resolvedAt: ISODateTime | null;
  /** Hidden from the open list until this date (owner snoozed it). */
  snoozedUntil: ISODate | null;
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

export interface Reminder {
  id: ID;
  title: string;
  note: string | null;
  dueDate: ISODate;
  entityType: AlertEntityType | null;
  entityId: ID | null;
  propertyId: ID | null;
  unitId: ID | null;
  tenantId: ID | null;
  done: boolean;
  doneAt: ISODateTime | null;
  createdBy: "owner" | "assistant";
  createdAt: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Activity log                                                                */
/* -------------------------------------------------------------------------- */

export type ActivityType =
  | "payment_recorded"
  | "payment_undone"
  | "payment_updated"
  | "payment_waived"
  | "contract_renewed"
  | "contract_terminated"
  | "contract_updated"
  | "renewal_decision"
  | "notice_given"
  | "tenant_added"
  | "tenant_updated"
  | "unit_updated"
  | "unit_became_available"
  | "document_added"
  | "document_deleted"
  | "expense_added"
  | "expense_updated"
  | "expense_paid"
  | "expense_deleted"
  | "budget_updated"
  | "deposit_updated"
  | "deposit_settled"
  | "work_order_created"
  | "work_order_updated"
  | "work_order_status"
  | "asset_added"
  | "asset_updated"
  | "asset_serviced"
  | "supplier_added"
  | "supplier_updated"
  | "plan_added"
  | "plan_updated"
  | "meter_added"
  | "reading_recorded"
  | "charge_added"
  | "charge_updated"
  | "inspection_created"
  | "inspection_updated"
  | "inspection_completed"
  | "renovation_created"
  | "renovation_updated"
  | "parking_updated"
  | "key_issued"
  | "key_returned"
  | "key_updated"
  | "reminder_created"
  | "reminder_done"
  | "alert_resolved"
  | "data_imported"
  | "demo_reset";

export interface ActivityLog {
  id: ID;
  at: ISODateTime;
  actor: string;
  type: ActivityType;
  message: string;
  entityType: AlertEntityType | "import";
  entityId: ID;
  propertyId: ID | null;
  unitId: ID | null;
  tenantId: ID | null;
  contractId: ID | null;
  paymentId: ID | null;
  workOrderId: ID | null;
  assetId: ID | null;
  expenseId: ID | null;
  supplierId: ID | null;
  inspectionId: ID | null;
  renovationId: ID | null;
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                   */
/* -------------------------------------------------------------------------- */

export type AuditAction = "create" | "update" | "delete" | "restore" | "status";

export interface AuditEntry {
  id: ID;
  at: ISODateTime;
  actor: string;
  action: AuditAction;
  entityType: AlertEntityType | "document" | "settings";
  entityId: ID;
  entityLabel: string;
  /** Field that changed, when a single field is audited. */
  field: string | null;
  previousValue: string | null;
  newValue: string | null;
  metadata: Record<string, string> | null;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface AlertThresholds {
  vacantWarningDays: number;
  vacantCriticalDays: number;
  contractCriticalDays: number;
  contractWarningDays: number;
  contractInfoDays: number;
  paymentDueSoonDays: number;
  repeatLateWindowMonths: number;
  repeatLateMinCount: number;
  outstandingWarning: number;
  buildingOccupancyWarning: number;
  expiryClusterCount: number;
  idExpiringDays: number;
  /** Tenant balance above N months of rent is "unusually high". */
  tenantBalanceHighMonths: number;
  workOrderOpenTooLongDays: number;
  repeatIssueWindowDays: number;
  repeatIssueMinCount: number;
  /** Maintenance spend above N × the 6-month average is flagged. */
  maintenanceCostHighMultiplier: number;
  serviceDueSoonDays: number;
  warrantyExpiringDays: number;
  certificateExpiringDays: number;
  insuranceExpiringDays: number;
  /** Over-budget when actual exceeds budget by this share. */
  budgetOverPct: number;
  expenseUnusualMultiplier: number;
  inspectionOverdueDays: number;
  /** Days before a contract ends by which a move-out inspection should be scheduled. */
  moveOutInspectionLeadDays: number;
  /** Days before a contract starts by which a move-in inspection should be scheduled. */
  moveInInspectionLeadDays: number;
  forecastHorizonDays: number;
}

export interface Settings {
  companyName: string;
  ownerName: string;
  logoUrl: string | null;
  currency: "USD";
  thresholds: AlertThresholds;
  /** Owner-added expense categories beyond the built-in list. */
  customExpenseCategories: string[];
  /** Alert types the owner has switched off. */
  mutedAlertTypes: AlertType[];
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export interface Store {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  contracts: Contract[];
  payments: Payment[];
  documents: StoredDocument[];
  expenses: Expense[];
  budgets: Budget[];
  deposits: SecurityDeposit[];
  workOrders: WorkOrder[];
  preventivePlans: PreventivePlan[];
  assets: Asset[];
  suppliers: Supplier[];
  meters: UtilityMeter[];
  readings: UtilityReading[];
  commonCharges: CommonCharge[];
  inspections: Inspection[];
  renovations: Renovation[];
  parking: ParkingSpace[];
  keys: KeyItem[];
  reminders: Reminder[];
  alerts: Alert[];
  activity: ActivityLog[];
  audit: AuditEntry[];
  settings: Settings;
  loadedAt: ISODateTime;
}
