import type {
  ContractStatus,
  DocumentKind,
  ID,
  IdDocumentType,
  ISODate,
  PaymentMethod,
} from "@/types";

import type { ImportEntity } from "./template";

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
  statusOverride: "maintenance" | "reserved" | null;
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
  paymentMethod: PaymentMethod;
  status: ContractStatus;
  moveOutDate: ISODate | null;
  notes: string | null;
  paymentPattern: PatternEntry[];
}

export interface DocumentDraft {
  tenantPhone: string;
  kind: DocumentKind;
  title: string;
  fileName: string;
  contractNumber: string | null;
  issuedDate: ISODate | null;
  expiryDate: ISODate | null;
}

export interface DraftByEntity {
  properties: PropertyDraft;
  units: UnitDraft;
  tenants: TenantDraft;
  contracts: ContractDraft;
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

export const EMPTY_COUNTS = (): Record<ImportEntity, number> => ({
  properties: 0,
  units: 0,
  tenants: 0,
  contracts: 0,
  documents: 0,
});
