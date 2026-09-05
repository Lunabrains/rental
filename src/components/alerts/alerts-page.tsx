"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { BellOff, CheckCheck, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AlertRow } from "@/components/alerts/alert-row";
import { SeverityDot } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dismissAlert, markAlertRead, markAllAlertsRead, resolveAlert, snoozeAlert, unsnoozeAlert } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { addDaysISO, today } from "@/lib/date";
import { ALERT_RULES } from "@/lib/derived/alert-catalog";
import { formatDate, labelize } from "@/lib/format";
import { getAlerts, type AlertStatusFilter } from "@/lib/queries";
import { ALERT_CATEGORIES, ALERT_SEVERITIES, type Alert, type AlertCategory, type AlertSeverity, type AlertType } from "@/types";

type SeverityFilter = "all" | AlertSeverity;
type CategoryFilter = "all" | AlertCategory;
const STATUSES: AlertStatusFilter[] = ["open", "snoozed", "resolved", "dismissed", "all"];

export function AlertsPage() {
  const { store, run } = useStoreContext();
  const { perform } = useActions();
  const router = useRouter();
  const params = useSearchParams();

  const severity = (ALERT_SEVERITIES.includes(params.get("severity") as AlertSeverity) ? params.get("severity") : "all") as SeverityFilter;
  const category = (ALERT_CATEGORIES.includes(params.get("category") as AlertCategory) ? params.get("category") : "all") as CategoryFilter;
  const status = (STATUSES.includes(params.get("status") as AlertStatusFilter) ? params.get("status") : "open") as AlertStatusFilter;
  const type = (params.get("type") && params.get("type")! in ALERT_RULES ? params.get("type") : null) as AlertType | null;
  const propertyId = params.get("property") ?? "all";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (value === null || value === "all" || (key === "status" && value === "open")) sp.delete(key);
      else sp.set(key, value);
      router.replace(`/alerts${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const all = useMemo(() => getAlerts(store, { status }), [store, status]);
  const filtered = useMemo(
    () => all.filter((a) => (severity === "all" || a.severity === severity) && (category === "all" || a.category === category) && (propertyId === "all" || a.propertyId === propertyId) && (!type || a.type === type)),
    [all, severity, category, propertyId, type],
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
  const statusCounts = useMemo(() => ({ open: getAlerts(store, { status: "open" }).length, snoozed: getAlerts(store, { status: "snoozed" }).length, resolved: getAlerts(store, { status: "resolved" }).length, dismissed: getAlerts(store, { status: "dismissed" }).length }), [store]);
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
  function snooze(alert: Alert, days: number) {
    const until = addDaysISO(today(), days);
    const { undo } = run(snoozeAlert(alert.id, until));
    toast(`Snoozed until ${formatDate(until)} — ${alert.title}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }
  function resolve(alert: Alert) {
    const { undo } = run(resolveAlert(alert.id, !alert.resolved));
    toast(alert.resolved ? `Reopened — ${alert.title}` : `Resolved — ${alert.title}`, { description: alert.resolved ? undefined : "Stays hidden until the underlying condition changes.", action: undo ? { label: "Undo", onClick: undo } : undefined });
  }
  function wake(alert: Alert) {
    const { undo } = run(unsnoozeAlert(alert.id));
    toast(`Back in the list — ${alert.title}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description={`${statusCounts.open} open · ${counts.critical} critical${status === "open" ? ` · ${unread} unread` : ""}${statusCounts.snoozed > 0 ? ` · ${statusCounts.snoozed} snoozed` : ""}${store.settings.mutedAlertTypes.length > 0 ? ` · ${store.settings.mutedAlertTypes.length} rule${store.settings.mutedAlertTypes.length === 1 ? "" : "s"} muted` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/alerts/rules"><SlidersHorizontal className="size-4" /> Rules</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => run(markAllAlertsRead())} disabled={unread === 0}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<AlertStatusFilter> aria-label="Status" value={status} onChange={(v) => setParam("status", v)} options={[{ value: "open", label: "Open", count: statusCounts.open }, { value: "snoozed", label: "Snoozed", count: statusCounts.snoozed }, { value: "resolved", label: "Resolved", count: statusCounts.resolved }, { value: "dismissed", label: "Dismissed", count: statusCounts.dismissed }, { value: "all", label: "All" }]} />
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
        {type && (
          <Button variant="ghost" size="sm" onClick={() => setParam("type", null)}>
            Rule: {ALERT_RULES[type].label} ×
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={BellOff} title={status === "open" ? "Nothing needs attention" : "No alerts match"} description={status === "open" ? "Every rule is quiet with these filters." : "Try another status or filter."} />
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
                    <AlertRow key={a.id} alert={a} maxActions={2} onOpen={open} onDismiss={status === "dismissed" ? undefined : dismiss} onSnooze={status === "open" ? snooze : undefined} onResolve={status === "open" || status === "resolved" ? resolve : undefined} onWake={status === "snoozed" ? wake : undefined} />
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
