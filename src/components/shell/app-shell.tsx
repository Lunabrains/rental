"use client";

import { Suspense, useCallback, useMemo } from "react";

import { useActions } from "@/components/actions/action-provider";
import { ErrorState, PageSkeleton } from "@/components/common/states";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { DrawerHost } from "@/components/units/drawer-host";
import { markAllAlertsRead, markAlertRead } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { getAlerts } from "@/lib/queries";
import type { Alert } from "@/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { store, status, run, reset } = useStoreContext();
  const { perform } = useActions();

  const critical = useMemo(() => getAlerts(store, { severity: "critical" }), [store]);
  const criticalUnread = critical.filter((a) => !a.read).length;
  const bellAlerts = useMemo(() => getAlerts(store, { unreadOnly: true }).slice(0, 8), [store]);

  const onOpenAlert = useCallback(
    (alert: Alert) => {
      run(markAlertRead(alert.id));
      const view = alert.actions.find((a) => a.kind.startsWith("view_")) ?? alert.actions[0];
      if (view) perform(view);
    },
    [run, perform],
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
          companyName={companyName}
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
      {status.state === "ready" && (
        <Suspense fallback={null}>
          <DrawerHost />
        </Suspense>
      )}
    </div>
  );
}
