import { nowISO } from "@/lib/date";
import type {
  Alert,
  AlertThresholds,
  Contract,
  ID,
  Payment,
  Property,
  Settings,
  Store,
  StoredDocument,
  Tenant,
  Unit,
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
};

export const DEFAULT_SETTINGS: Settings = {
  companyName: "Cedar Holdings",
  ownerName: "George",
  logoUrl: null,
  currency: "USD",
  thresholds: DEFAULT_THRESHOLDS,
};

export function createEmptyStore(settings: Settings = DEFAULT_SETTINGS): Store {
  return {
    properties: [],
    units: [],
    tenants: [],
    contracts: [],
    payments: [],
    documents: [],
    alerts: [],
    activity: [],
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
  unitsByProperty: Map<ID, Unit[]>;
  contractsByUnit: Map<ID, Contract[]>;
  contractsByTenant: Map<ID, Contract[]>;
  activeContractByUnit: Map<ID, Contract>;
  paymentsByContract: Map<ID, Payment[]>;
  paymentsByTenant: Map<ID, Payment[]>;
  documentsByTenant: Map<ID, StoredDocument[]>;
  alertsByEntity: Map<string, Alert[]>;
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

const indexCache = new WeakMap<Store, StoreIndex>();

/** Memoised per store snapshot — a new snapshot after every command. */
export function indexStore(store: Store): StoreIndex {
  const cached = indexCache.get(store);
  if (cached) return cached;

  const activeContractByUnit = new Map<ID, Contract>();
  for (const c of store.contracts) {
    if (c.status === "active" || c.status === "notice_given") activeContractByUnit.set(c.unitId, c);
  }

  const index: StoreIndex = {
    propertyById: new Map(store.properties.map((p) => [p.id, p])),
    unitById: new Map(store.units.map((u) => [u.id, u])),
    tenantById: new Map(store.tenants.map((t) => [t.id, t])),
    contractById: new Map(store.contracts.map((c) => [c.id, c])),
    paymentById: new Map(store.payments.map((p) => [p.id, p])),
    documentById: new Map(store.documents.map((d) => [d.id, d])),
    unitsByProperty: groupBy(store.units, (u) => u.propertyId),
    contractsByUnit: groupBy(store.contracts, (c) => c.unitId),
    contractsByTenant: groupBy(store.contracts, (c) => c.tenantId),
    activeContractByUnit,
    paymentsByContract: groupBy(store.payments, (p) => p.contractId),
    paymentsByTenant: groupBy(store.payments, (p) => p.tenantId),
    documentsByTenant: groupBy(store.documents, (d) => d.tenantId),
    alertsByEntity: groupBy(store.alerts, (a) => `${a.entityType}:${a.entityId}`),
  };
  indexCache.set(store, index);
  return index;
}
