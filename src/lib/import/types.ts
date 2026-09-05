import type {
  AllocationMethod,
  AssetStatus,
  AssetType,
  BillingMethod,
  ContractStatus,
  DocumentCategory,
  DocumentKind,
  ExpenseCategory,
  ExpenseClassification,
  ExpensePaymentStatus,
  ID,
  IdDocumentType,
  InspectionResult,
  InspectionStatus,
  InspectionType,
  ISODate,
  ItemResult,
  KeyStatus,
  KeyType,
  ParkingStatus,
  PaymentFrequency,
  PaymentMethod,
  PlanStatus,
  PropertyStatus,
  PropertyType,
  Recurrence,
  RenewalDecision,
  RenovationStatus,
  RenovationType,
  SupplierCategory,
  UnitCondition,
  UtilityType,
  WorkOrderCategory,
  WorkOrderPriority,
  WorkOrderSource,
  WorkOrderStatus,
} from "@/types";

import { IMPORT_ORDER, type ImportEntity } from "./template";

/* ------------------------------ Parsed input ------------------------------ */

export interface RawRow {
  entity: ImportEntity;
  /** 1-based row number in the sheet (header is row 1). */
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface ParsedSheet {
  present: boolean;
  headers: string[];
  rows: RawRow[];
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: Record<ImportEntity, ParsedSheet>;
  hasPaymentsSheet: boolean;
  unknownSheets: string[];
}

/* -------------------------------- Drafts --------------------------------- */

export interface PropertyDraft {
  code: string;
  name: string;
  address: string;
  district: string;
  city: string;
  country: string;
  yearBuilt: number | null;
  floors: number;
  unitsPerFloor: number;
  type: PropertyType;
  status: PropertyStatus;
  acquisitionDate: ISODate | null;
  acquisitionCost: number | null;
  estimatedValue: number | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: ISODate | null;
  notes: string | null;
}

export interface UnitDraft {
  propertyCode: string;
  unitNumber: string;
  floor: number;
  bedrooms: number;
  bathrooms: number;
  sizeSqm: number;
  furnished: boolean;
  askingRent: number;
  askingDeposit: number;
  marketRent: number | null;
  condition: UnitCondition;
  statusOverride: "maintenance" | "reserved" | "renovation" | "unavailable" | null;
  notes: string | null;
}

export interface TenantDraft {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  nationality: string;
  idType: IdDocumentType;
  idNumber: string;
  occupation: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
}

export type PatternKind = "overdue" | "late" | "partial" | "unpaid";

export interface PatternEntry {
  kind: PatternKind;
  /** Days from today of the targeted due date. */
  offsetDays: number;
  /** `late` → days late; `partial` → amount paid. */
  arg: number | null;
}

export interface ContractDraft {
  contractNumber: string;
  propertyCode: string;
  unitNumber: string;
  tenantPhone: string;
  startDate: ISODate;
  endDate: ISODate;
  monthlyRent: number;
  deposit: number;
  paymentDay: number;
  paymentFrequency: PaymentFrequency;
  paymentMethod: PaymentMethod;
  status: ContractStatus;
  moveOutDate: ISODate | null;
  rentIncreaseClause: string | null;
  specialTerms: string | null;
  renewalDecision: RenewalDecision | null;
  proposedRent: number | null;
  renewalNotes: string | null;
  notes: string | null;
  paymentPattern: PatternEntry[];
}

export interface SupplierDraft {
  name: string;
  category: SupplierCategory;
  phone: string;
  email: string;
  company: string | null;
  services: string[];
  rating: number | null;
  active: boolean;
  notes: string | null;
}

export interface AssetDraft {
  propertyCode: string;
  unitNumber: string | null;
  assetType: AssetType;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  installationDate: ISODate | null;
  purchaseCost: number | null;
  warrantyExpiry: ISODate | null;
  supplierName: string | null;
  status: AssetStatus;
  lastServiceDate: ISODate | null;
  qrCode: string | null;
  notes: string | null;
}

export interface WorkOrderDraft {
  number: string;
  propertyCode: string;
  unitNumber: string | null;
  assetName: string | null;
  tenantPhone: string | null;
  title: string;
  description: string;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  source: WorkOrderSource;
  reportedAt: ISODate;
  supplierName: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  approvalRequired: boolean;
  approvedAt: ISODate | null;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
  closedAt: ISODate | null;
  repeatOfNumber: string | null;
  notes: string | null;
}

export interface PlanDraft {
  propertyCode: string;
  assetName: string | null;
  maintenanceType: string;
  recurrenceMonths: number;
  lastServiceDate: ISODate | null;
  nextServiceDate: ISODate;
  supplierName: string | null;
  estimatedCost: number | null;
  status: PlanStatus;
  reminderDays: number;
  notes: string | null;
}

export interface ExpenseDraft {
  propertyCode: string;
  unitNumber: string | null;
  supplierName: string | null;
  category: ExpenseCategory;
  amount: number;
  expenseDate: ISODate;
  dueDate: ISODate | null;
  paymentStatus: ExpensePaymentStatus;
  paidDate: ISODate | null;
  recurring: boolean;
  recurrence: Recurrence | null;
  description: string;
  classification: ExpenseClassification;
  invoiceNumber: string | null;
  workOrderNumber: string | null;
  renovationTitle: string | null;
  assetName: string | null;
  notes: string | null;
}

export interface BudgetDraft {
  propertyCode: string;
  periodType: "month" | "year";
  period: string;
  category: ExpenseCategory;
  amount: number;
  notes: string | null;
}

export interface DeductionDraft {
  description: string;
  amount: number;
  date: ISODate;
}

export interface DepositDraft {
  contractNumber: string;
  amountExpected: number | null;
  amountReceived: number | null;
  receivedDate: ISODate | null;
  deductions: DeductionDraft[];
  finalRefund: number | null;
  settlementDate: ISODate | null;
  notes: string | null;
}

export interface MeterDraft {
  propertyCode: string;
  unitNumber: string | null;
  utilityType: UtilityType;
  meterNumber: string;
  billingMethod: BillingMethod;
  unitRate: number | null;
  unitLabel: string;
}

export interface ReadingDraft {
  meterNumber: string;
  readingDate: ISODate;
  previousReading: number | null;
  currentReading: number;
  meterReset: boolean;
  note: string | null;
}

export interface ChargeDraft {
  propertyCode: string;
  period: string;
  category: string;
  totalAmount: number;
  allocationMethod: AllocationMethod;
  paidUnits: string[];
  notes: string | null;
}

export interface InspectionItemDraft {
  area: string;
  item: string;
  result: ItemResult;
  followUpRequired: boolean;
  notes: string | null;
}

export interface InspectionDraft {
  propertyCode: string;
  unitNumber: string | null;
  assetName: string | null;
  tenantPhone: string | null;
  type: InspectionType;
  scheduledDate: ISODate;
  completedDate: ISODate | null;
  inspector: string;
  status: InspectionStatus;
  overallResult: InspectionResult | null;
  items: InspectionItemDraft[];
  notes: string | null;
}

export interface RenovationDraft {
  propertyCode: string;
  unitNumber: string | null;
  title: string;
  description: string;
  projectType: RenovationType;
  budget: number;
  contractorName: string | null;
  startDate: ISODate;
  targetEndDate: ISODate;
  actualEndDate: ISODate | null;
  status: RenovationStatus;
  progressPercent: number;
  tasks: { title: string; done: boolean }[];
  notes: string | null;
}

export interface ParkingDraft {
  propertyCode: string;
  spaceNumber: string;
  unitNumber: string | null;
  tenantPhone: string | null;
  vehiclePlate: string | null;
  paid: boolean;
  monthlyFee: number;
  status: ParkingStatus;
  notes: string | null;
}

export interface KeyDraft {
  propertyCode: string;
  unitNumber: string | null;
  type: KeyType;
  identifier: string;
  assignedTo: string | null;
  tenantPhone: string | null;
  issuedDate: ISODate | null;
  returnedDate: ISODate | null;
  status: KeyStatus;
  notes: string | null;
}

export interface DocumentDraft {
  tenantPhone: string | null;
  propertyCode: string | null;
  assetName: string | null;
  kind: DocumentKind;
  category: DocumentCategory;
  title: string;
  fileName: string;
  contractNumber: string | null;
  workOrderNumber: string | null;
  issuedDate: ISODate | null;
  expiryDate: ISODate | null;
}

export interface DraftByEntity {
  properties: PropertyDraft;
  units: UnitDraft;
  tenants: TenantDraft;
  contracts: ContractDraft;
  suppliers: SupplierDraft;
  assets: AssetDraft;
  workorders: WorkOrderDraft;
  plans: PlanDraft;
  expenses: ExpenseDraft;
  budgets: BudgetDraft;
  deposits: DepositDraft;
  meters: MeterDraft;
  readings: ReadingDraft;
  charges: ChargeDraft;
  inspections: InspectionDraft;
  renovations: RenovationDraft;
  parking: ParkingDraft;
  keys: KeyDraft;
  documents: DocumentDraft;
}

/* --------------------------------- Plan ---------------------------------- */

export type RowAction = "create" | "update" | "skip";

export interface RowIssue {
  level: "error" | "warning";
  column: string | null;
  message: string;
}

export interface PlannedRow<E extends ImportEntity = ImportEntity> {
  entity: E;
  rowNumber: number;
  /** Idempotency key, e.g. "BH:403". */
  key: string;
  /** Short human label for the preview table. */
  label: string;
  action: RowAction;
  /** Id of the record this row updates, when action = update. */
  existingId: ID | null;
  issues: RowIssue[];
  /** Null when the row has errors and will be skipped. */
  data: DraftByEntity[E] | null;
}

export interface PlanCounts {
  create: number;
  update: number;
  skip: number;
}

export interface ImportPlan {
  fileName: string;
  today: ISODate;
  rows: { [E in ImportEntity]: PlannedRow<E>[] };
  counts: Record<ImportEntity, PlanCounts>;
  errorCount: number;
  warningCount: number;
  hasPaymentsSheet: boolean;
  unknownSheets: string[];
  /** Nothing usable in the file at all. */
  empty: boolean;
}

export interface ImportSummary {
  fileName: string;
  created: Record<ImportEntity, number>;
  updated: Record<ImportEntity, number>;
  skipped: Record<ImportEntity, number>;
  paymentsGenerated: number;
  durationMs: number;
}

export const EMPTY_COUNTS = (): Record<ImportEntity, number> =>
  Object.fromEntries(IMPORT_ORDER.map((e) => [e, 0])) as Record<ImportEntity, number>;
