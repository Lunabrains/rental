"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { ErrorState, PageSkeleton } from "@/components/common/states";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { markAllAlertsRead, markAlertRead } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { getAlerts } from "@/lib/queries";
import type { Alert } from "@/types";

/** Where an alert takes you when clicked from the bell. */
export function alertHref(alert: Alert): string {
  switch (alert.entityType) {
    case "unit":
      return alert.propertyId ? `/properties/${alert.propertyId}?unit=${alert.unitId ?? alert.entityId}` : "/alerts";
    case "payment":
    case "contract":
    case "tenant":
      return alert.propertyId && alert.unitId ? `/properties/${alert.propertyId}?unit=${alert.unitId}` : "/alerts";
    case "property":
      return `/properties/${alert.entityId}`;
    default:
      return "/alerts";
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { store, status, run, reset } = useStoreContext();
  const router = useRouter();

  const critical = useMemo(() => getAlerts(store, { severity: "critical" }), [store]);
  const criticalUnread = critical.filter((a) => !a.read).length;
  const bellAlerts = useMemo(() => getAlerts(store, { unreadOnly: true }).slice(0, 8), [store]);

  const onOpenAlert = useCallback(
    (alert: Alert) => {
      run(markAlertRead(alert.id));
      router.push(alertHref(alert));
    },
    [run, router],
  );

  const onMarkAllRead = useCallback(() => {
    run(markAllAlertsRead());
  }, [run]);

  const { companyName, ownerName } = store.settings;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar companyName={companyName} ownerName={ownerName} alertCount={criticalUnread} />
      <div className="lg:pl-60">
        <Topbar
          ownerName={ownerName}
          criticalUnread={criticalUnread}
          bellAlerts={bellAlerts}
          onOpenAlert={onOpenAlert}
          onMarkAllRead={onMarkAllRead}
        />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6 lg:py-8">
          {status.state === "loading" && <PageSkeleton />}
          {status.state === "error" && (
            <ErrorState title="Demo data failed to load" description={status.message} onRetry={() => void reset()} />
          )}
          {status.state === "ready" && children}
        </main>
      </div>
    </div>
  );
}
