import { ids } from "@/lib/data/ids";
import { nowISO } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import type { ActivityLog, AuditAction, AuditEntry, Store } from "@/types";

/**
 * Commands are the only write path. Each one is a pure function
 * `Store → { store, result }` that ends with `recompute()`, so alerts, KPIs
 * and derived statuses are always consistent with the data. The UI never
 * mutates state directly — it hands a command to the store provider.
 */

export interface CommandResult<T = void> {
  store: Store;
  result: T;
  /** Reverse this command. Only offered for user-facing writes. */
  undo?: (store: Store) => Store;
}

export type Command<T = void> = (store: Store) => CommandResult<T>;

export const ACTOR = "George";

let activitySeq = 0;

type ActivityLinks =
  | "propertyId"
  | "unitId"
  | "tenantId"
  | "contractId"
  | "paymentId"
  | "workOrderId"
  | "assetId"
  | "expenseId"
  | "supplierId"
  | "inspectionId"
  | "renovationId";

export type ActivityInput = Omit<ActivityLog, "id" | "at" | "actor" | ActivityLinks> & Partial<Pick<ActivityLog, ActivityLinks>>;

export function appendActivity(store: Store, entry: ActivityInput): { store: Store; entry: ActivityLog } {
  const item: ActivityLog = {
    id: ids.activity(activitySeq++),
    at: nowISO(),
    actor: ACTOR,
    type: entry.type,
    message: entry.message,
    entityType: entry.entityType,
    entityId: entry.entityId,
    propertyId: entry.propertyId ?? null,
    unitId: entry.unitId ?? null,
    tenantId: entry.tenantId ?? null,
    contractId: entry.contractId ?? null,
    paymentId: entry.paymentId ?? null,
    workOrderId: entry.workOrderId ?? null,
    assetId: entry.assetId ?? null,
    expenseId: entry.expenseId ?? null,
    supplierId: entry.supplierId ?? null,
    inspectionId: entry.inspectionId ?? null,
    renovationId: entry.renovationId ?? null,
  };
  return { store: { ...store, activity: [item, ...store.activity] }, entry: item };
}

export function logActivity(store: Store, entry: ActivityInput): Store {
  return appendActivity(store, entry).store;
}

/* --------------------------------- Audit ---------------------------------- */

export interface AuditInput {
  action: AuditAction;
  entityType: AuditEntry["entityType"];
  entityId: string;
  entityLabel: string;
  field?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, string> | null;
}

const serialize = (v: unknown): string | null => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));

/** Append one audit entry — every financial / contract / maintenance write records what changed. */
export function appendAudit(store: Store, input: AuditInput): { store: Store; entry: AuditEntry } {
  const entry: AuditEntry = {
    id: ids.audit(),
    at: nowISO(),
    actor: ACTOR,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    field: input.field ?? null,
    previousValue: serialize(input.previousValue),
    newValue: serialize(input.newValue),
    metadata: input.metadata ?? null,
  };
  return { store: { ...store, audit: [entry, ...store.audit] }, entry };
}

/**
 * Audit every changed field between two versions of a record. Returns the
 * store with one entry per changed field (skips derived / bookkeeping keys).
 */
export function auditChanges<T extends object>(
  store: Store,
  entityType: AuditEntry["entityType"],
  entityId: string,
  entityLabel: string,
  previous: T,
  next: T,
  ignore: (keyof T)[] = [],
): { store: Store; entryIds: string[] } {
  let s = store;
  const entryIds: string[] = [];
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (ignore.includes(key)) continue;
    const a = previous[key];
    const b = next[key];
    if (serialize(a) === serialize(b)) continue;
    const r = appendAudit(s, { action: "update", entityType, entityId, entityLabel, field: String(key), previousValue: a, newValue: b });
    s = r.store;
    entryIds.push(r.entry.id);
  }
  return { store: s, entryIds };
}

export function removeAudit(store: Store, entryIds: string[]): Store {
  if (entryIds.length === 0) return store;
  const drop = new Set(entryIds);
  return { ...store, audit: store.audit.filter((a) => !drop.has(a.id)) };
}

export function finish<T>(store: Store, result: T, undo?: (store: Store) => Store): CommandResult<T> {
  return { store: recompute(store), result, undo };
}

export function replaceById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((x) => x.id !== id);
}
