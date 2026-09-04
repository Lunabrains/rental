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
  imageUrl: string | null;
  notes: string | null;
  createdAt: ISODate;
}

/* -------------------------------------------------------------------------- */
/* Unit                                                                        */
/* -------------------------------------------------------------------------- */

export type UnitStatus = "available" | "rented" | "reserved" | "maintenance";

export const UNIT_STATUSES: UnitStatus[] = [
  "available",
  "rented",
  "reserved",
  "maintenance",
];

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
  paymentMethod: PaymentMethod;
  status: ContractStatus;
  /** Set by `markAsLeaving`. */
  moveOutDate: ISODate | null;
  /** Renewal chain. */
  renewedFromContractId: ID | null;
  renewedToContractId: ID | null;
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
  | "scheduled";

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "paid",
  "partial",
  "overdue",
  "due",
  "scheduled",
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
  /** Derived by `recompute()`. */
  status: PaymentStatus;
  /** Derived: days between dueDate and paidDate (or today if unpaid). */
  daysLate: number;
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

export interface StoredDocument {
  id: ID;
  kind: DocumentKind;
  title: string;
  fileName: string;
  mimeType: string;
  sizeKb: number;
  tenantId: ID | null;
  contractId: ID | null;
  unitId: ID | null;
  propertyId: ID | null;
  paymentId: ID | null;
  issuedDate: ISODate | null;
  expiryDate: ISODate | null;
  uploadedAt: ISODate;
  /** True for receipts produced by `recordPayment`. */
  generated: boolean;
}

/* -------------------------------------------------------------------------- */
/* Alert                                                                       */
/* -------------------------------------------------------------------------- */

export type AlertSeverity = "critical" | "warning" | "info";

export const ALERT_SEVERITIES: AlertSeverity[] = [
  "critical",
  "warning",
  "info",
];

export type AlertCategory =
  | "payment"
  | "contract"
  | "occupancy"
  | "document"
  | "portfolio";

export const ALERT_CATEGORIES: AlertCategory[] = [
  "payment",
  "contract",
  "occupancy",
  "document",
  "portfolio",
];

/** One id per rule in §4 of the implementation plan. */
export type AlertType =
  | "payment_overdue"
  | "payment_partial"
  | "payment_repeat_late"
  | "payment_due_today"
  | "payment_due_soon"
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
  | "portfolio_outstanding_high"
  | "portfolio_expiry_cluster"
  | "portfolio_revenue_down";

export type AlertEntityType =
  | "payment"
  | "contract"
  | "unit"
  | "tenant"
  | "property"
  | "portfolio";

export type AlertActionKind =
  | "record_payment"
  | "send_reminder"
  | "renew_contract"
  | "mark_as_leaving"
  | "view_unit"
  | "view_tenant"
  | "view_property"
  | "view_contract"
  | "upload_document";

export interface AlertAction {
  kind: AlertActionKind;
  label: string;
  /** Entity the action operates on (payment id, contract id, unit id …). */
  targetId: ID;
}

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
  createdAt: ISODateTime;
  read: boolean;
  dismissed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Activity log                                                                */
/* -------------------------------------------------------------------------- */

export type ActivityType =
  | "payment_recorded"
  | "payment_undone"
  | "contract_renewed"
  | "contract_terminated"
  | "notice_given"
  | "tenant_added"
  | "tenant_updated"
  | "unit_updated"
  | "unit_became_available"
  | "document_added"
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
}

export interface Settings {
  companyName: string;
  ownerName: string;
  logoUrl: string | null;
  currency: "USD";
  thresholds: AlertThresholds;
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
  alerts: Alert[];
  activity: ActivityLog[];
  settings: Settings;
  loadedAt: ISODateTime;
}
