import { applyImport, summarize } from "@/lib/import/apply";
import type { ImportPlan, ImportSummary } from "@/lib/import/types";
import type { AlertThresholds } from "@/types";

import { finish, logActivity, type Command } from "./core";

export * from "./core";
export * from "./writes";
export * from "./operations";

/* -------------------------------- Import ---------------------------------- */

export function importData(plan: ImportPlan): Command<ImportSummary> {
  return (store) => {
    const { store: next, summary } = applyImport(store, plan);
    const withLog = logActivity(next, {
      type: "data_imported",
      message: `Imported ${plan.fileName}: ${summarize(summary)}`,
      entityType: "import",
      entityId: plan.fileName,
    });
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
