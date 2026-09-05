import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createEmptyStore } from "../src/lib/data/store";
import { setTodayOverride } from "../src/lib/date";
import { importData } from "../src/lib/commands";
import { parseWorkbook } from "../src/lib/import/parse";
import { planImport } from "../src/lib/import/validate";
import type {
  Asset,
  Budget,
  Contract,
  Expense,
  Payment,
  PreventivePlan,
  Property,
  Reminder,
  SecurityDeposit,
  Store,
  Tenant,
  Unit,
  WorkOrder,
} from "../src/types";

/** Every test runs on the same calendar day. */
export const TODAY = "2026-09-05";
setTodayOverride(TODAY);

export function property(over: Partial<Property> = {}): Property {
  return {
    id: "bh",
    code: "BH",
    name: "Beirut Heights",
    address: "1 Test Street",
    district: "Achrafieh",
    city: "Beirut",
    country: "Lebanon",
    yearBuilt: 2016,
    floors: 2,
    unitsPerFloor: 2,
    type: "residential",
    status: "active",
    acquisitionDate: null,
    acquisitionCost: null,
    estimatedValue: null,
    insuranceProvider: null,
    insurancePolicyNumber: null,
    insuranceExpiry: null,
    imageUrl: null,
    notes: null,
    createdAt: "2026-01-01",
    ...over,
  };
}

export function unit(over: Partial<Unit> = {}): Unit {
  return {
    id: "bh-101",
    propertyId: "bh",
    unitNumber: "101",
    floor: 1,
    bedrooms: 2,
    bathrooms: 1,
    sizeSqm: 100,
    furnished: false,
    status: "available",
    askingRent: 1000,
    askingDeposit: 1000,
    marketRent: null,
    condition: "good",
    availableSince: null,
    lastRent: null,
    previousTenantId: null,
    notes: null,
    ...over,
  };
}

export function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: "t-1",
    firstName: "Karim",
    lastName: "Daher",
    fullName: "Karim Daher",
    phone: "+9613612345",
    email: "karim@example.com",
    nationality: "Lebanese",
    idType: "national_id",
    idNumber: "LB-1",
    photoUrl: null,
    occupation: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    notes: null,
    createdAt: "2026-01-01",
    ...over,
  };
}

export function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "c-1",
    contractNumber: "BH-101-01",
    propertyId: "bh",
    unitId: "bh-101",
    tenantId: "t-1",
    startDate: "2025-10-01",
    endDate: "2026-09-30",
    durationMonths: 12,
    monthlyRent: 1000,
    deposit: 1000,
    paymentDay: 1,
    paymentFrequency: "monthly",
    paymentMethod: "bank_transfer",
    status: "active",
    moveOutDate: null,
    renewedFromContractId: null,
    renewedToContractId: null,
    rentIncreaseClause: null,
    specialTerms: null,
    renewalDecision: null,
    renewalStatus: "not_due",
    proposedRent: null,
    renewalNotes: null,
    notes: null,
    createdAt: "2025-10-01",
    ...over,
  };
}

export function payment(over: Partial<Payment> = {}): Payment {
  const period = over.periodMonth ?? "2026-08";
  return {
    id: `p-${period}`,
    contractId: "c-1",
    propertyId: "bh",
    unitId: "bh-101",
    tenantId: "t-1",
    periodMonth: period,
    dueDate: `${period}-01`,
    amountDue: 1000,
    amountPaid: 0,
    paidDate: null,
    method: null,
    reference: null,
    note: null,
    waived: false,
    status: "scheduled",
    daysLate: 0,
    ...over,
  };
}

/** A settled-on-time payment for the period. */
export function paidOnTime(period: string): Payment {
  return payment({ periodMonth: period, amountPaid: 1000, paidDate: `${period}-01`, status: "paid", daysLate: 0 });
}

export function paidLate(period: string, days: number): Payment {
  const paidDate = `${period}-${String(1 + days).padStart(2, "0")}`;
  return payment({ periodMonth: period, amountPaid: 1000, paidDate, status: "paid", daysLate: days });
}

export function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: over.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    propertyId: "bh",
    unitId: null,
    supplierId: null,
    category: "cleaning",
    amount: 100,
    expenseDate: "2026-09-02",
    dueDate: null,
    paymentStatus: "paid",
    paidDate: "2026-09-02",
    recurring: false,
    recurrence: null,
    description: "Cleaning",
    documentId: null,
    classification: "operating",
    workOrderId: null,
    renovationId: null,
    assetId: null,
    invoiceNumber: null,
    notes: null,
    deleted: false,
    createdAt: "2026-09-02",
    ...over,
  };
}

export function budget(over: Partial<Budget> = {}): Budget {
  return { id: "b-1", propertyId: "bh", periodType: "month", period: "2026-09", category: "cleaning", amount: 100, notes: null, ...over };
}

export function workOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: over.id ?? "wo-1",
    number: over.number ?? "WO-0001",
    propertyId: "bh",
    unitId: "bh-101",
    assetId: null,
    tenantId: null,
    title: "Leak",
    description: "",
    category: "plumbing",
    priority: "normal",
    status: "open",
    source: "tenant",
    reportedAt: "2026-09-01",
    supplierId: null,
    estimatedCost: null,
    actualCost: null,
    approvalRequired: false,
    approvedAt: null,
    startedAt: null,
    completedAt: null,
    closedAt: null,
    beforePhotoIds: [],
    afterPhotoIds: [],
    invoiceDocumentId: null,
    notes: null,
    repeatOfWorkOrderId: null,
    inspectionId: null,
    preventivePlanId: null,
    statusHistory: [],
    createdAt: "2026-09-01",
    ...over,
  };
}

export function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "as-1",
    propertyId: "bh",
    unitId: null,
    assetType: "elevator",
    name: "Elevator 1",
    manufacturer: null,
    model: null,
    serialNumber: null,
    installationDate: null,
    purchaseCost: null,
    warrantyExpiry: null,
    supplierId: null,
    status: "operational",
    lastServiceDate: null,
    nextServiceDate: null,
    qrCode: "AST-BH-ELEV1",
    notes: null,
    createdAt: "2026-01-01",
    ...over,
  };
}

export function plan(over: Partial<PreventivePlan> = {}): PreventivePlan {
  return {
    id: "pm-1",
    propertyId: "bh",
    assetId: "as-1",
    maintenanceType: "Elevator service",
    recurrenceMonths: 3,
    lastServiceDate: "2026-06-01",
    nextServiceDate: "2026-09-01",
    supplierId: null,
    estimatedCost: 350,
    status: "active",
    reminderDays: 14,
    notes: null,
    createdAt: "2026-01-01",
    ...over,
  };
}

export function deposit(over: Partial<SecurityDeposit> = {}): SecurityDeposit {
  return {
    id: "dep-c-1",
    contractId: "c-1",
    tenantId: "t-1",
    unitId: "bh-101",
    propertyId: "bh",
    amountExpected: 1000,
    amountReceived: 1000,
    receivedDate: "2025-10-01",
    deductions: [],
    finalRefund: null,
    settlementDate: null,
    settlementNotes: null,
    status: "pending",
    amountHeld: 0,
    ...over,
  };
}

export function reminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: "rem-1",
    title: "Call the elevator company",
    note: null,
    dueDate: TODAY,
    entityType: null,
    entityId: null,
    propertyId: null,
    unitId: null,
    tenantId: null,
    done: false,
    doneAt: null,
    createdBy: "owner",
    createdAt: "2026-09-01T09:00:00.000Z",
    ...over,
  };
}

/** A small consistent store: one building, two units, one tenant on a live contract. */
export function smallStore(over: Partial<Store> = {}): Store {
  const s = createEmptyStore();
  return {
    ...s,
    properties: [property()],
    units: [unit(), unit({ id: "bh-102", unitNumber: "102" })],
    tenants: [tenant()],
    contracts: [contract()],
    payments: [paidOnTime("2026-06"), paidOnTime("2026-07"), paidOnTime("2026-08"), payment({ periodMonth: "2026-09" })],
    ...over,
  };
}

/** The real seed workbook, imported through the same path as the app. */
export function seedStore(): Store {
  const file = join(process.cwd(), "public", "seed", "portfolio.xlsx");
  const buffer = readFileSync(file);
  const parsed = parseWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "portfolio.xlsx");
  const plan = planImport(parsed, createEmptyStore());
  return importData(plan)(createEmptyStore()).store;
}
