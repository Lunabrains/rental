"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { SeverityDot } from "@/components/common/badges";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { setAlertTypeMuted, updateThresholds } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { ALERT_TYPES, CATEGORY_LABELS, rulesByCategory, thresholdField, type ThresholdKey } from "@/lib/derived/alert-catalog";
import { cn } from "@/lib/utils";
import type { AlertThresholds, AlertType } from "@/types";

/** Alert rules (plan §Phase 12): every rule the engine runs, its thresholds, what it is raising right now, and a mute switch. */
export function AlertRulesPage() {
  const { store, run } = useStoreContext();
  const [draft, setDraft] = useState<AlertThresholds>(store.settings.thresholds);
  const dirtyKeys = (Object.keys(draft) as ThresholdKey[]).filter((k) => draft[k] !== store.settings.thresholds[k]);
  const muted = new Set(store.settings.mutedAlertTypes);
  const groups = useMemo(() => rulesByCategory(), []);
  const counts = useMemo(() => {
    const c = new Map<AlertType, { open: number; critical: number }>();
    for (const a of store.alerts) {
      if (a.dismissed || a.resolved) continue;
      const cur = c.get(a.type) ?? { open: 0, critical: 0 };
      cur.open += 1;
      if (a.severity === "critical") cur.critical += 1;
      c.set(a.type, cur);
    }
    return c;
  }, [store.alerts]);
  const activeRules = ALERT_TYPES.filter((t) => (counts.get(t)?.open ?? 0) > 0).length;

  function apply() {
    run(updateThresholds(draft));
    toast.success(`${dirtyKeys.length} threshold${dirtyKeys.length === 1 ? "" : "s"} applied`, { description: "Alerts were recomputed with the new rules." });
  }
  function toggle(type: AlertType, enabled: boolean) {
    const { undo } = run(setAlertTypeMuted(type, !enabled));
    toast(enabled ? "Rule enabled — alerts recomputed" : "Rule muted — its alerts are hidden until you enable it again", { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }
  function setValue(key: ThresholdKey, raw: number, unit: string) {
    setDraft((d) => ({ ...d, [key]: unit === "%" ? Math.min(100, Math.max(0, raw)) / 100 : Math.max(0, raw) }));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        crumbs={[{ label: "Alerts", href: "/alerts" }, { label: "Rules" }]}
        title="Alert rules"
        description="Rules run on every change. Adjust the numbers, or mute a rule you do not want to hear about — nothing is sent anywhere; alerts live in this app."
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/alerts"><ArrowLeft className="size-4" /> Back to alerts</Link>
            </Button>
            <Button variant="outline" onClick={() => setDraft(store.settings.thresholds)} disabled={dirtyKeys.length === 0}>Revert</Button>
            <Button onClick={apply} disabled={dirtyKeys.length === 0}><Save className="size-4" /> Apply {dirtyKeys.length > 0 ? `(${dirtyKeys.length})` : ""}</Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rules" value={ALERT_TYPES.length} sublabel={`${activeRules} raising something right now`} />
        <KpiCard label="Muted" value={muted.size} tone={muted.size > 0 ? "warning" : "default"} sublabel={muted.size > 0 ? [...muted].map((t) => t.replace(/_/g, " ")).slice(0, 3).join(", ") : "Every rule is live"} />
        <KpiCard label="Open alerts" value={store.alerts.filter((a) => !a.dismissed && !a.resolved).length} sublabel={`${store.alerts.filter((a) => !a.dismissed && !a.resolved && a.severity === "critical").length} critical`} href="/alerts" />
        <KpiCard label="Unsaved changes" value={dirtyKeys.length} tone={dirtyKeys.length > 0 ? "warning" : "default"} sublabel={dirtyKeys.length > 0 ? "Apply to recompute" : "Thresholds match the live rules"} />
      </div>

      {groups.map((g) => (
        <SectionCard key={g.category} title={CATEGORY_LABELS[g.category]} description={`${g.rules.length} rule${g.rules.length === 1 ? "" : "s"} · ${g.rules.reduce((n, r) => n + (counts.get(r.type)?.open ?? 0), 0)} open`} flush>
          <ul className="divide-y">
            {g.rules.map((r) => {
              const c = counts.get(r.type);
              const enabled = !muted.has(r.type);
              return (
                <li key={r.type} className={cn("flex flex-wrap items-start gap-3 px-4 py-3", !enabled && "opacity-60")}>
                  <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
                    {r.severity === "varies" ? <span className="mt-1.5 inline-block size-2 rounded-full bg-muted-foreground/50" title="Severity depends on the case" /> : <SeverityDot severity={r.severity} className="mt-1.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {r.label}
                        {c && c.open > 0 && (
                          <Link href={`/alerts?type=${r.type}`} className={cn("ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-normal tabular hover:underline", c.critical > 0 ? "bg-critical-muted text-critical" : "bg-muted text-muted-foreground")}>
                            {c.open} open
                          </Link>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.thresholds.map((key) => {
                      const f = thresholdField(key);
                      const raw = draft[key];
                      const shown = f.unit === "%" ? Math.round(raw * 100) : raw;
                      const dirty = draft[key] !== store.settings.thresholds[key];
                      return (
                        <label key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground" title={f.hint}>
                          <span className="max-w-32 truncate">{f.label}</span>
                          <span className="relative">
                            {f.unit === "$" && <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs">$</span>}
                            <Input type="number" min={0} step={f.unit === "×" ? 0.1 : 1} value={shown} onChange={(e) => setValue(key, Number(e.target.value), f.unit)} className={cn("h-7 w-24 tabular pr-8 text-xs", f.unit === "$" && "pl-5", dirty && "border-warning ring-1 ring-warning/40")} aria-label={f.label} />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]">{f.unit === "$" ? "" : f.unit}</span>
                          </span>
                        </label>
                      );
                    })}
                    <Switch checked={enabled} onCheckedChange={(v) => toggle(r.type, v)} aria-label={`${r.label} enabled`} />
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ))}
    </div>
  );
}
