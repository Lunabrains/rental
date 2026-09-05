"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Hammer, Plus } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatPercent, labelize } from "@/lib/format";
import { getCapexSummary, getRenovations, type CapexBuildingRow, type RenovationRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { RenovationStatus } from "@/types";

type StatusChip = "live" | RenovationStatus | "all";

export function ProgressBar({ value, tone = "default", className }: { value: number; tone?: "default" | "warning" | "critical" | "success"; className?: string }) {
  return (
    <span className={cn("inline-flex h-1.5 w-24 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className={cn("h-full rounded-full", tone === "critical" ? "bg-critical" : tone === "warning" ? "bg-warning" : tone === "success" ? "bg-success" : "bg-primary")} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export const renovationColumns: Column<RenovationRow>[] = [
  { key: "title", header: "Project", cell: (r) => <span className="font-medium">{r.renovation.title}<span className="block text-xs font-normal text-muted-foreground">{labelize(r.renovation.projectType)}{r.contractor ? ` · ${r.contractor.name}` : ""}</span></span>, value: (r) => r.renovation.title },
  { key: "where", header: "Where", cell: (r) => `${r.property.name}${r.unit ? ` · ${r.unit.unitNumber}` : ""}`, value: (r) => `${r.property.name} ${r.unit?.unitNumber ?? ""}` },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.delayed ? "delayed" : r.renovation.status} label={r.delayed ? `Delayed ${Math.abs(r.daysToTarget)}d` : undefined} dot />, value: (r) => r.renovation.status },
  { key: "progress", header: "Progress", cell: (r) => <span className="inline-flex items-center gap-2"><ProgressBar value={r.renovation.progressPercent} tone={r.delayed ? "warning" : r.renovation.status === "completed" ? "success" : "default"} /><span className="tabular text-xs">{r.renovation.progressPercent}%</span></span>, value: (r) => r.renovation.progressPercent },
  { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.renovation.budget), value: (r) => r.renovation.budget },
  { key: "actual", header: "Spent", align: "right", cell: (r) => formatMoney(r.renovation.actualCost), value: (r) => r.renovation.actualCost },
  { key: "variance", header: "Variance", align: "right", cell: (r) => (r.variancePct === null ? "—" : <span className={cn(r.variance > 0 ? "font-medium text-critical" : "text-success")}>{r.variance > 0 ? "+" : ""}{formatMoney(r.variance)} ({formatPercent(r.variancePct)})</span>), value: (r) => r.variance },
  { key: "dates", header: "Dates", cell: (r) => `${formatDate(r.renovation.startDate)} → ${formatDate(r.renovation.actualEndDate ?? r.renovation.targetEndDate)}`, value: (r) => r.renovation.startDate },
  { key: "tasks", header: "Tasks", align: "right", cell: (r) => (r.tasksTotal > 0 ? `${r.tasksDone}/${r.tasksTotal}` : "—"), value: (r) => r.tasksDone },
];

/** Renovations & CapEx (plan §Phase 11): every project, its budget, progress and slip. */
export function RenovationsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openRenovation, createRenovation } = useActions();
  const propertyId = params.get("property");
  const status = (params.get("status") as StatusChip | null) ?? "live";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "status" && v === "live")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/renovations${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getRenovations(store, { propertyId: propertyId ?? undefined, status: status === "all" ? undefined : status }), [store, propertyId, status]);
  const all = useMemo(() => getRenovations(store, { propertyId: propertyId ?? undefined }), [store, propertyId]);
  const summary = useMemo(() => getCapexSummary(store), [store]);
  const counts = { live: all.filter((r) => r.renovation.status !== "completed" && r.renovation.status !== "cancelled").length, planned: all.filter((r) => r.renovation.status === "planned").length, in_progress: all.filter((r) => r.renovation.status === "in_progress").length, on_hold: all.filter((r) => r.renovation.status === "on_hold").length, completed: all.filter((r) => r.renovation.status === "completed").length };

  const buildingColumns: Column<CapexBuildingRow>[] = [
    { key: "building", header: "Building", cell: (r) => <span className="font-medium">{r.property.name}</span> },
    { key: "projects", header: "Projects", align: "right", cell: (r) => `${r.live} live / ${r.projects}` },
    { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.budget) },
    { key: "actual", header: "Spent", align: "right", cell: (r) => formatMoney(r.actual) },
    { key: "variance", header: "Variance", align: "right", cell: (r) => <span className={cn(r.variance > 0 ? "text-critical" : "text-success")}>{r.variance > 0 ? "+" : ""}{formatMoney(r.variance)}</span> },
    { key: "flags", header: "Flags", cell: (r) => (r.overBudget + r.delayed > 0 ? <span className="text-xs text-warning-foreground">{[r.overBudget > 0 ? `${r.overBudget} over budget` : null, r.delayed > 0 ? `${r.delayed} delayed` : null].filter(Boolean).join(" · ")}</span> : <span className="text-xs text-muted-foreground">On track</span>) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Renovations & CapEx"
        description={`${summary.live} live project${summary.live === 1 ? "" : "s"} · ${formatMoney(summary.actualLive)} spent of ${formatMoney(summary.budgetLive)} committed · ${formatMoney(summary.spentThisYear)} CapEx this year`}
        actions={
          <Button onClick={() => createRenovation({ propertyId })}>
            <Plus className="size-4" /> New project
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Over budget" value={summary.overBudget} tone={summary.overBudget > 0 ? "critical" : "success"} sublabel="Live projects past their budget" />
        <KpiCard label="Delayed" value={summary.delayed} tone={summary.delayed > 0 ? "warning" : "success"} sublabel="Past the target end date" />
        <KpiCard label="CapEx this year" value={formatMoney(summary.spentThisYear)} sublabel={`${formatMoney(summary.spentLastYear)} last year · kept out of NOI`} />
        <KpiCard label="Live projects" value={summary.live} sublabel={`${summary.planned} planned · ${summary.completedThisYear} completed this year`} icon={Hammer} />
      </div>
      {summary.byBuilding.length > 1 && (
        <SectionCard title="By building" description="Committed vs spent across all projects" flush>
          <div className="p-3">
            <DataTable rows={summary.byBuilding} columns={buildingColumns} rowKey={(r) => r.property.id} dense onRowClick={(r) => setParams({ property: r.property.id })} />
          </div>
        </SectionCard>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusChip> aria-label="Status" value={status} onChange={(v) => setParams({ status: v })} options={[{ value: "live", label: "Live", count: counts.live }, { value: "planned", label: "Planned", count: counts.planned }, { value: "in_progress", label: "In progress", count: counts.in_progress }, { value: "on_hold", label: "On hold", count: counts.on_hold }, { value: "completed", label: "Completed", count: counts.completed }, { value: "all", label: "All" }]} />
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={renovationColumns} rowKey={(r) => r.renovation.id} onRowClick={(r) => openRenovation(r.renovation.id)} rowClassName={(r) => (r.variance > 0 && r.renovation.status !== "completed" ? "bg-critical-muted/30" : r.delayed ? "bg-warning-muted/30" : undefined)} searchable={(r) => `${r.renovation.title} ${r.property.name} ${r.unit?.unitNumber ?? ""} ${r.contractor?.name ?? ""}`} exportName="renovations" pageSize={50} emptyTitle="No projects match" emptyIcon={Hammer} />
    </div>
  );
}
