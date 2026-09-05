import { applyImport, summarize } from "@/lib/import/apply";
import type { ImportPlan, ImportSummary } from "@/lib/import/types";
import { today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import type { AlertThresholds, AlertType } from "@/types";

import { finish, logActivity, type Command } from "./core";

export * from "./core";
export * from "./writes";
export * from "./operations";
export * from "./contracts";
export * from "./payments";
export * from "./expenses";
export * from "./finance";
export * from "./maintenance";
export * from "./inspections";
export * from "./renovations";

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

export function snoozeAlert(alertId: string, until: string): Command {
  return (store) => {
    const prev = store.alerts.find((a) => a.id === alertId);
    if (!prev) throw new Error("Alert not found");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today()) throw new Error("Pick a date in the future");
    return {
      store: { ...store, alerts: store.alerts.map((a) => (a.id === alertId ? { ...a, snoozedUntil: until, read: true } : a)) },
      result: undefined,
      undo: (s) => ({ ...s, alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, snoozedUntil: prev.snoozedUntil } : a)) }),
    };
  };
}

export function unsnoozeAlert(alertId: string): Command {
  return (store) => {
    const prev = store.alerts.find((a) => a.id === alertId);
    if (!prev) throw new Error("Alert not found");
    return {
      store: { ...store, alerts: store.alerts.map((a) => (a.id === alertId ? { ...a, snoozedUntil: null } : a)) },
      result: undefined,
      undo: (s) => ({ ...s, alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, snoozedUntil: prev.snoozedUntil } : a)) }),
    };
  };
}

/** Mute or enable one rule; alerts recompute immediately. */
export function setAlertTypeMuted(type: AlertType, muted: boolean): Command {
  return (store) => {
    const prevMuted = store.settings.mutedAlertTypes;
    const next = muted ? Array.from(new Set([...prevMuted, type])) : prevMuted.filter((t) => t !== type);
    if (next.length === prevMuted.length && next.every((t, i) => t === prevMuted[i])) return { store, result: undefined };
    return finish({ ...store, settings: { ...store.settings, mutedAlertTypes: next } }, undefined, (s) => recompute({ ...s, settings: { ...s.settings, mutedAlertTypes: prevMuted } }));
  };
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
