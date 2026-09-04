import { ids } from "@/lib/data/ids";
import { nowISO } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import type { ActivityLog, Store } from "@/types";

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

type ActivityLinks = "propertyId" | "unitId" | "tenantId" | "contractId" | "paymentId";

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
  };
  return { store: { ...store, activity: [item, ...store.activity] }, entry: item };
}

export function logActivity(store: Store, entry: ActivityInput): Store {
  return appendActivity(store, entry).store;
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
