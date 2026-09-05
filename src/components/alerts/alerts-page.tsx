"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AlertRow } from "@/components/alerts/alert-row";
import { SeverityDot } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dismissAlert, markAlertRead, markAllAlertsRead } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { labelize } from "@/lib/format";
import { getAlerts } from "@/lib/queries";
import { ALERT_CATEGORIES, ALERT_SEVERITIES, type Alert, type AlertCategory, type AlertSeverity } from "@/types";

type SeverityFilter = "all" | AlertSeverity;
type CategoryFilter = "all" | AlertCategory;

export function AlertsPage() {
  const { store, run } = useStoreContext();
  const { perform } = useActions();
  const router = useRouter();
  const params = useSearchParams();

  const severity = (ALERT_SEVERITIES.includes(params.get("severity") as AlertSeverity) ? params.get("severity") : "all") as SeverityFilter;
  const category = (ALERT_CATEGORIES.includes(params.get("category") as AlertCategory) ? params.get("category") : "all") as CategoryFilter;
  const propertyId = params.get("property") ?? "all";

  const setParam = useCallback(
    (key: string, value: string) => {
      const sp = new URLSearchParams(params.toString());
      if (value === "all") sp.delete(key);
      else sp.set(key, value);
      router.replace(`/alerts${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const all = useMemo(() => getAlerts(store), [store]);
  const filtered = useMemo(
    () =>
      all.filter(
        (a) =>
          (severity === "all" || a.severity === severity) &&
          (category === "all" || a.category === category) &&
          (propertyId === "all" || a.propertyId === propertyId),
      ),
    [all, severity, category, propertyId],
  );

  const bySeverity = useMemo(() => {
    const groups: Record<AlertSeverity, Alert[]> = { critical: [], warning: [], attention: [], info: [] };
    for (const a of filtered) groups[a.severity].push(a);
    return groups;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<SeverityFilter, number> = { all: all.length, critical: 0, warning: 0, attention: 0, info: 0 };
    for (const a of all) c[a.severity]++;
    return c;
  }, [all]);

  const unread = all.filter((a) => !a.read).length;

  function open(alert: Alert) {
    run(markAlertRead(alert.id));
    const view = alert.actions.find((a) => a.kind.startsWith("view_")) ?? alert.actions[0];
    if (view) perform(view);
  }

  function dismiss(alert: Alert) {
    const { undo } = run(dismissAlert(alert.id));
    toast(`Dismissed — ${alert.title}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description={`${all.length} open · ${counts.critical} critical · ${unread} unread`}
        actions={
          <Button variant="outline" size="sm" onClick={() => run(markAllAlertsRead())} disabled={unread === 0}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<SeverityFilter>
          aria-label="Severity"
          value={severity}
          onChange={(v) => setParam("severity", v)}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "critical", label: "Critical", count: counts.critical },
            { value: "warning", label: "Warning", count: counts.warning },
            { value: "attention", label: "Attention", count: counts.attention },
            { value: "info", label: "Info", count: counts.info },
          ]}
        />
        <Select value={category} onValueChange={(v) => setParam("category", v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {ALERT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {labelize(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={propertyId} onValueChange={(v) => setParam("property", v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Building" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buildings</SelectItem>
            {store.properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellOff} title="No alerts match" description="Nothing needs attention with these filters." />
      ) : (
        <div className="space-y-6">
          {ALERT_SEVERITIES.map((s) => {
            const list = bySeverity[s];
            if (list.length === 0) return null;
            return (
              <section key={s}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <SeverityDot severity={s} />
                  {labelize(s)}
                  <span className="tabular text-xs font-normal text-muted-foreground">{list.length}</span>
                </h2>
                <div className="space-y-2">
                  {list.map((a) => (
                    <AlertRow key={a.id} alert={a} maxActions={2} onOpen={open} onDismiss={dismiss} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
