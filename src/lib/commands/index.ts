import { ids } from "@/lib/data/ids";
import { nowISO } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { applyImport, summarize } from "@/lib/import/apply";
import type { ImportPlan, ImportSummary } from "@/lib/import/types";
import type { ActivityLog, AlertThresholds, ID, Store } from "@/types";

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

export function logActivity(store: Store, entry: ActivityInput): Store {
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
  return { ...store, activity: [item, ...store.activity] };
}

export function finish<T>(store: Store, result: T, undo?: (store: Store) => Store): CommandResult<T> {
  return { store: recompute(store), result, undo };
}

/* -------------------------------- Import ---------------------------------- */

export function importData(plan: ImportPlan): Command<ImportSummary> {
  return (store) => {
    const { store: next, summary, createdContractIds } = applyImport(store, plan);
    const withLog = logActivity(next, {
      type: "data_imported",
      message: `Imported ${plan.fileName}: ${summarize(summary)}`,
      entityType: "import",
      entityId: plan.fileName,
    });
    void createdContractIds;
    return finish(withLog, summary);
  };
}

/* -------------------------------- Alerts ---------------------------------- */

export function markAlertRead(alertId: string): Command {
  return (store) => ({
    store: { ...store, alerts: store.alerts.map((a) => (a.id === alertId ? { ...a, read: true } : a)) },
    result: undefined,
  });
}

export function markAllAlertsRead(): Command {
  return (store) => ({
    store: { ...store, alerts: store.alerts.map((a) => (a.read ? a : { ...a, read: true })) },
    result: undefined,
  });
}

export function dismissAlert(alertId: string): Command {
  return (store) => ({
    store: { ...store, alerts: store.alerts.map((a) => (a.id === alertId ? { ...a, dismissed: true, read: true } : a)) },
    result: undefined,
    undo: (s) => ({ ...s, alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, dismissed: false } : a)) }),
  });
}

/* ------------------------------- Settings --------------------------------- */

export function updateThresholds(patch: Partial<AlertThresholds>): Command {
  return (store) =>
    finish({ ...store, settings: { ...store.settings, thresholds: { ...store.settings.thresholds, ...patch } } }, undefined);
}

export function updateCompany(patch: { companyName?: string; ownerName?: string; logoUrl?: string | null }): Command {
  return (store) => ({ store: { ...store, settings: { ...store.settings, ...patch } }, result: undefined });
}

/* ----------------------------- Demo lifecycle ----------------------------- */

/** Fresh store after a reload — the provider re-runs the seed import. */
export function stampReset(): Command {
  return (store) =>
    finish(
      logActivity(store, {
        type: "demo_reset",
        message: "Demo data reset to the seed workbook",
        entityType: "import",
        entityId: "reset",
      }),
      undefined,
    );
}

export type { ID };
