import { nowISO } from "@/lib/date";
import type {
  Alert,
  AlertThresholds,
  Asset,
  Budget,
  CommonCharge,
  Contract,
  Expense,
  ID,
  Inspection,
  KeyItem,
  ParkingSpace,
  Payment,
  PreventivePlan,
  Property,
  Reminder,
  Renovation,
  SecurityDeposit,
  Settings,
  Store,
  StoredDocument,
  Supplier,
  Tenant,
  Unit,
  UtilityMeter,
  UtilityReading,
  WorkOrder,
} from "@/types";

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  vacantWarningDays: 45,
  vacantCriticalDays: 60,
  contractCriticalDays: 7,
  contractWarningDays: 30,
  contractInfoDays: 90,
  paymentDueSoonDays: 3,
  repeatLateWindowMonths: 6,
  repeatLateMinCount: 3,
  outstandingWarning: 15_000,
  buildingOccupancyWarning: 0.75,
  expiryClusterCount: 5,
  idExpiringDays: 60,
  tenantBalanceHighMonths: 2,
  workOrderOpenTooLongDays: 14,
  repeatIssueWindowDays: 90,
  repeatIssueMinCount: 3,
  maintenanceCostHighMultiplier: 1.3,
  serviceDueSoonDays: 30,
  warrantyExpiringDays: 60,
  certificateExpiringDays: 60,
  insuranceExpiringDays: 60,
  budgetOverPct: 0.1,
  expenseUnusualMultiplier: 2,
  inspectionOverdueDays: 7,
  moveOutInspectionLeadDays: 30,
  moveInInspectionLeadDays: 14,
  forecastHorizonDays: 90,
};

export const DEFAULT_SETTINGS: Settings = {
  companyName: "Succar Holdings",
  ownerName: "George",
  logoUrl: null,
  currency: "USD",
  thresholds: DEFAULT_THRESHOLDS,
  customExpenseCategories: [],
  mutedAlertTypes: [],
};

export function createEmptyStore(settings: Settings = DEFAULT_SETTINGS): Store {
  return {
    properties: [],
    units: [],
    tenants: [],
    contracts: [],
    payments: [],
    documents: [],
    expenses: [],
    budgets: [],
    deposits: [],
    workOrders: [],
    preventivePlans: [],
    assets: [],
    suppliers: [],
    meters: [],
    readings: [],
    commonCharges: [],
    inspections: [],
    renovations: [],
    parking: [],
    keys: [],
    reminders: [],
    alerts: [],
    mutedAlerts: [],
    activity: [],
    audit: [],
    settings,
    loadedAt: nowISO(),
  };
}

/* -------------------------------------------------------------------------- */
/* Indexes — built on demand by queries; cheap for a few thousand rows.       */
/* -------------------------------------------------------------------------- */

export interface StoreIndex {
  propertyById: Map<ID, Property>;
  unitById: Map<ID, Unit>;
  tenantById: Map<ID, Tenant>;
  contractById: Map<ID, Contract>;
  paymentById: Map<ID, Payment>;
  documentById: Map<ID, StoredDocument>;
  expenseById: Map<ID, Expense>;
  budgetById: Map<ID, Budget>;
  depositById: Map<ID, SecurityDeposit>;
  workOrderById: Map<ID, WorkOrder>;
  planById: Map<ID, PreventivePlan>;
  assetById: Map<ID, Asset>;
  supplierById: Map<ID, Supplier>;
  meterById: Map<ID, UtilityMeter>;
  readingById: Map<ID, UtilityReading>;
  chargeById: Map<ID, CommonCharge>;
  inspectionById: Map<ID, Inspection>;
  renovationById: Map<ID, Renovation>;
  parkingById: Map<ID, ParkingSpace>;
  keyById: Map<ID, KeyItem>;
  reminderById: Map<ID, Reminder>;
  unitsByProperty: Map<ID, Unit[]>;
  contractsByUnit: Map<ID, Contract[]>;
  contractsByTenant: Map<ID, Contract[]>;
  activeContractByUnit: Map<ID, Contract>;
  paymentsByContract: Map<ID, Payment[]>;
  paymentsByTenant: Map<ID, Payment[]>;
  documentsByTenant: Map<ID, StoredDocument[]>;
  alertsByEntity: Map<string, Alert[]>;
  expensesByProperty: Map<ID, Expense[]>;
  expensesByUnit: Map<ID, Expense[]>;
  expensesBySupplier: Map<ID, Expense[]>;
  workOrdersByProperty: Map<ID, WorkOrder[]>;
  workOrdersByUnit: Map<ID, WorkOrder[]>;
  workOrdersByAsset: Map<ID, WorkOrder[]>;
  workOrdersBySupplier: Map<ID, WorkOrder[]>;
  assetsByProperty: Map<ID, Asset[]>;
  plansByProperty: Map<ID, PreventivePlan[]>;
  plansByAsset: Map<ID, PreventivePlan[]>;
  depositByContract: Map<ID, SecurityDeposit>;
  metersByProperty: Map<ID, UtilityMeter[]>;
  readingsByMeter: Map<ID, UtilityReading[]>;
  inspectionsByProperty: Map<ID, Inspection[]>;
  inspectionsByUnit: Map<ID, Inspection[]>;
  renovationsByProperty: Map<ID, Renovation[]>;
  parkingByProperty: Map<ID, ParkingSpace[]>;
  keysByProperty: Map<ID, KeyItem[]>;
  keysByUnit: Map<ID, KeyItem[]>;
}

function groupBy<T>(items: T[], key: (item: T) => ID | null): Map<ID, T[]> {
  const map = new Map<ID, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

const byId = <T extends { id: ID }>(items: T[]): Map<ID, T> => new Map(items.map((x) => [x.id, x]));

const indexCache = new WeakMap<Store, StoreIndex>();

/** Memoised per store snapshot — a new snapshot after every command. */
export function indexStore(store: Store): StoreIndex {
  const cached = indexCache.get(store);
  if (cached) return cached;

  const activeContractByUnit = new Map<ID, Contract>();
  for (const c of store.contracts) {
    if (c.status === "active" || c.status === "notice_given") activeContractByUnit.set(c.unitId, c);
  }
  const liveExpenses = store.expenses.filter((e) => !e.deleted);
  const liveDocuments = store.documents.filter((d) => !d.deleted);

  const index: StoreIndex = {
    propertyById: byId(store.properties),
    unitById: byId(store.units),
    tenantById: byId(store.tenants),
    contractById: byId(store.contracts),
    paymentById: byId(store.payments),
    documentById: byId(store.documents),
    expenseById: byId(store.expenses),
    budgetById: byId(store.budgets),
    depositById: byId(store.deposits),
    workOrderById: byId(store.workOrders),
    planById: byId(store.preventivePlans),
    assetById: byId(store.assets),
    supplierById: byId(store.suppliers),
    meterById: byId(store.meters),
    readingById: byId(store.readings),
    chargeById: byId(store.commonCharges),
    inspectionById: byId(store.inspections),
    renovationById: byId(store.renovations),
    parkingById: byId(store.parking),
    keyById: byId(store.keys),
    reminderById: byId(store.reminders),
    unitsByProperty: groupBy(store.units, (u) => u.propertyId),
    contractsByUnit: groupBy(store.contracts, (c) => c.unitId),
    contractsByTenant: groupBy(store.contracts, (c) => c.tenantId),
    activeContractByUnit,
    paymentsByContract: groupBy(store.payments, (p) => p.contractId),
    paymentsByTenant: groupBy(store.payments, (p) => p.tenantId),
    documentsByTenant: groupBy(liveDocuments, (d) => d.tenantId),
    alertsByEntity: groupBy(store.alerts, (a) => `${a.entityType}:${a.entityId}`),
    expensesByProperty: groupBy(liveExpenses, (e) => e.propertyId),
    expensesByUnit: groupBy(liveExpenses, (e) => e.unitId),
    expensesBySupplier: groupBy(liveExpenses, (e) => e.supplierId),
    workOrdersByProperty: groupBy(store.workOrders, (w) => w.propertyId),
    workOrdersByUnit: groupBy(store.workOrders, (w) => w.unitId),
    workOrdersByAsset: groupBy(store.workOrders, (w) => w.assetId),
    workOrdersBySupplier: groupBy(store.workOrders, (w) => w.supplierId),
    assetsByProperty: groupBy(store.assets, (a) => a.propertyId),
    plansByProperty: groupBy(store.preventivePlans, (p) => p.propertyId),
    plansByAsset: groupBy(store.preventivePlans, (p) => p.assetId),
    depositByContract: new Map(store.deposits.map((d) => [d.contractId, d])),
    metersByProperty: groupBy(store.meters, (m) => m.propertyId),
    readingsByMeter: groupBy(store.readings, (r) => r.meterId),
    inspectionsByProperty: groupBy(store.inspections, (i) => i.propertyId),
    inspectionsByUnit: groupBy(store.inspections, (i) => i.unitId),
    renovationsByProperty: groupBy(store.renovations, (r) => r.propertyId),
    parkingByProperty: groupBy(store.parking, (p) => p.propertyId),
    keysByProperty: groupBy(store.keys, (k) => k.propertyId),
    keysByUnit: groupBy(store.keys, (k) => k.unitId),
  };
  indexCache.set(store, index);
  return index;
}
