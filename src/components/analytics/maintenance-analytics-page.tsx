"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Wrench } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ScoreBadge } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { exportXlsx, stampedName } from "@/lib/export";
import { formatDate, formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent, labelize } from "@/lib/format";
import { getMaintenanceAnalytics, type AssetRow, type MaintenanceAnalytics, type SupplierRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tick = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Maintenance analytics (plan §Phase 17): jobs and cost by category, resolution time, repeat issues, suppliers and the assets that cost the most. */
export function MaintenanceAnalyticsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openUnitPage, openSupplier, openAsset } = useActions();
  const propertyId = params.get("property");

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/analytics/maintenance${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const a = useMemo(() => getMaintenanceAnalytics(store, propertyId ?? undefined), [store, propertyId]);

  const categoryColumns: Column<MaintenanceAnalytics["byCategory"][number]>[] = [
    { key: "category", header: "Category", cell: (r) => <span className="font-medium">{labelize(r.category)}</span>, value: (r) => r.category },
    { key: "jobs", header: "Jobs", align: "right", cell: (r) => r.jobs, value: (r) => r.jobs },
    { key: "open", header: "Open", align: "right", cell: (r) => (r.open > 0 ? <span className="text-warning-foreground">{r.open}</span> : "—"), value: (r) => r.open },
    { key: "cost", header: "Cost", align: "right", cell: (r) => formatMoney(r.cost), value: (r) => r.cost },
    { key: "avg", header: "Avg cost / job", align: "right", cell: (r) => (r.jobs > 0 ? formatMoney(Math.round(r.cost / r.jobs)) : "—"), value: (r) => (r.jobs > 0 ? r.cost / r.jobs : 0) },
    { key: "res", header: "Avg resolution", align: "right", cell: (r) => (r.avgResolutionDays !== null ? `${r.avgResolutionDays}d` : "—"), value: (r) => r.avgResolutionDays ?? 0 },
  ];
  const repeatColumns: Column<MaintenanceAnalytics["repeatIssues"][number]>[] = [
    { key: "unit", header: "Unit", cell: (r) => <span className="font-medium">{r.property} · {r.unit}</span>, value: (r) => `${r.property} ${r.unit}` },
    { key: "category", header: "Category", cell: (r) => labelize(r.category), value: (r) => r.category },
    { key: "count", header: "Jobs", align: "right", cell: (r) => <span className="font-medium text-critical">{r.count}</span>, value: (r) => r.count },
    { key: "cost", header: "Cost", align: "right", cell: (r) => formatMoney(r.cost), value: (r) => r.cost },
    { key: "last", header: "Last reported", cell: (r) => formatDate(r.lastAt), value: (r) => r.lastAt },
  ];
  const supplierColumns: Column<SupplierRow>[] = [
    { key: "name", header: "Supplier", cell: (r) => <span className="font-medium">{r.supplier.name}</span>, value: (r) => r.supplier.name },
    { key: "score", header: "Score", cell: (r) => <ScoreBadge score={r.score} label={r.scoreLabel} components={r.components} size="sm" />, value: (r) => r.score ?? -1 },
    { key: "jobs", header: "Jobs", align: "right", cell: (r) => `${r.completedJobs}/${r.jobs}`, value: (r) => r.jobs },
    { key: "response", header: "Response", align: "right", cell: (r) => (r.avgResponseDays !== null ? `${r.avgResponseDays.toFixed(1)}d` : "—"), value: (r) => r.avgResponseDays ?? 999 },
    { key: "completion", header: "Completion", align: "right", cell: (r) => (r.avgCompletionDays !== null ? `${r.avgCompletionDays.toFixed(1)}d` : "—"), value: (r) => r.avgCompletionDays ?? 999 },
    { key: "repeat", header: "Repeat", align: "right", cell: (r) => (r.repeatIssueRate !== null ? <span className={cn(r.repeatIssueRate > 0.2 && "text-critical")}>{formatPercent(r.repeatIssueRate)}</span> : "—"), value: (r) => r.repeatIssueRate ?? 0 },
    { key: "spend", header: "Spend", align: "right", cell: (r) => formatMoney(r.totalSpend), value: (r) => r.totalSpend },
  ];
  const assetColumns: Column<AssetRow>[] = [
    { key: "asset", header: "Asset", cell: (r) => <span className="font-medium">{r.asset.name}</span>, value: (r) => r.asset.name },
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.asset.status} dot />, value: (r) => r.asset.status },
    { key: "open", header: "Open WOs", align: "right", cell: (r) => (r.openOrders > 0 ? <span className="text-warning-foreground">{r.openOrders}</span> : "—"), value: (r) => r.openOrders },
    { key: "spend", header: "Spend to date", align: "right", cell: (r) => formatMoney(r.totalSpend), value: (r) => r.totalSpend },
    { key: "purchase", header: "Purchase cost", align: "right", cell: (r) => (r.asset.purchaseCost ? formatMoney(r.asset.purchaseCost) : "—"), value: (r) => r.asset.purchaseCost ?? 0 },
  ];

  function exportAll() {
    exportXlsx(stampedName("maintenance-analytics", today()), [
      { name: "By category", columns: ["Category", "Jobs", "Open", "Cost", "Avg resolution (d)"], rows: a.byCategory.map((r) => [labelize(r.category), r.jobs, r.open, r.cost, r.avgResolutionDays ?? ""]) },
      { name: "Monthly", columns: ["Month", "Reported", "Completed", "Cost"], rows: a.monthly.map((m) => [m.period, m.reported, m.completed, m.cost]) },
      { name: "Resolution", columns: ["Priority", "Jobs", "Avg days"], rows: a.resolution.byPriority.map((p) => [labelize(p.priority), p.jobs, p.avgDays ?? ""]) },
      { name: "Repeat issues", columns: ["Building", "Unit", "Category", "Jobs", "Cost", "Last reported"], rows: a.repeatIssues.map((r) => [r.property, r.unit, labelize(r.category), r.count, r.cost, r.lastAt]) },
      { name: "Suppliers", columns: ["Supplier", "Score", "Jobs", "Completed", "Avg response (d)", "Avg completion (d)", "Repeat %", "Spend"], rows: a.suppliers.map((r) => [r.supplier.name, r.score ?? "", r.jobs, r.completedJobs, r.avgResponseDays ?? "", r.avgCompletionDays ?? "", r.repeatIssueRate === null ? "" : Math.round(r.repeatIssueRate * 100), r.totalSpend]) },
      { name: "Top assets", columns: ["Asset", "Building", "Status", "Open WOs", "Spend to date", "Purchase cost"], rows: a.topAssets.map((r) => [r.asset.name, r.property.name, r.asset.status, r.openOrders, r.totalSpend, r.asset.purchaseCost ?? ""]) },
    ]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Maintenance analytics"
        description={`${a.jobs12m} jobs and ${formatMoney(a.spend12m)} over the last 12 months${propertyId ? "" : " across the portfolio"}`}
        actions={
          <Button variant="outline" onClick={exportAll}>
            <Download className="size-4" /> Export Excel
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open now" value={a.summary.open} sublabel={`${a.summary.emergencies} emergency · ${a.summary.awaitingApproval} awaiting approval · ${a.summary.overdue} overdue`} tone={a.summary.emergencies > 0 ? "critical" : a.summary.overdue > 0 ? "warning" : "default"} href="/maintenance" icon={Wrench} />
        <KpiCard label="Average resolution" value={a.resolution.avgDays !== null ? `${a.resolution.avgDays} days` : "—"} sublabel={a.resolution.medianDays !== null ? `Median ${a.resolution.medianDays} days` : "No completed jobs"} />
        <KpiCard label="Repeat issues" value={a.repeatIssues.length} sublabel={`Same category twice on a unit within ${store.settings.thresholds.repeatIssueWindowDays} days`} tone={a.repeatIssues.length > 0 ? "warning" : "success"} />
        <KpiCard label="Spend, 12 months" value={formatMoney(a.spend12m)} sublabel={`${formatMoney(a.summary.spendThisMonth)} this month`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Cost by category" description="Completed and open work orders, all time">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.byCategory.slice(0, 10).map((r) => ({ ...r, label: labelize(r.category) }))} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} tick={tick} />
                <YAxis type="category" dataKey="label" width={100} tickLine={false} axisLine={false} tick={tick} />
                <Tooltip formatter={(v, n) => (n === "Cost" ? formatMoney(Number(v)) : String(v))} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="cost" name="Cost" fill="var(--chart-3)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Jobs and cost by month" description="Reported and completed work orders, with the cost of what was completed">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={a.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={tick} dy={6} />
                <YAxis yAxisId="jobs" allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={tick} />
                <YAxis yAxisId="cost" orientation="right" tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={52} tick={tick} />
                <Tooltip formatter={(v, n) => (n === "Cost" ? formatMoney(Number(v)) : String(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="jobs" dataKey="reported" name="Reported" fill="var(--chart-1)" isAnimationActive={false} />
                <Bar yAxisId="jobs" dataKey="completed" name="Completed" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="cost" type="monotone" dataKey="cost" name="Cost" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="By category" flush>
          <div className="p-3">
            <DataTable rows={a.byCategory} columns={categoryColumns} rowKey={(r) => r.category} dense exportName="maintenance-by-category" />
          </div>
        </SectionCard>
        <SectionCard title="Resolution time by priority" description="Days from report to completion" flush>
          <div className="p-3">
            <DataTable rows={a.resolution.byPriority} columns={[{ key: "priority", header: "Priority", cell: (r) => <StatusBadge value={r.priority} />, value: (r) => r.priority }, { key: "jobs", header: "Jobs", align: "right", cell: (r) => r.jobs, value: (r) => r.jobs }, { key: "avg", header: "Avg days", align: "right", cell: (r) => (r.avgDays !== null ? r.avgDays : "—"), value: (r) => r.avgDays ?? 0 }]} rowKey={(r) => r.priority} dense />
          </div>
        </SectionCard>
        <SectionCard title="Repeat issues" description="A permanent fix beats the third call-out" flush>
          <div className="p-3">
            <DataTable rows={a.repeatIssues} columns={repeatColumns} rowKey={(r) => `${r.unitId}-${r.category}`} onRowClick={(r) => openUnitPage(r.unitId)} dense emptyTitle="No repeat issues in the window" />
          </div>
        </SectionCard>
        <SectionCard title="Assets that cost the most" description="Lifetime work-order and service spend" flush>
          <div className="p-3">
            <DataTable rows={a.topAssets} columns={assetColumns} rowKey={(r) => r.asset.id} onRowClick={(r) => openAsset(r.asset.id)} dense emptyTitle="No asset spend recorded" />
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Supplier performance" description="Computed from completed jobs — click a supplier for the breakdown" flush>
        <div className="p-3">
          <DataTable rows={a.suppliers} columns={supplierColumns} rowKey={(r) => r.supplier.id} onRowClick={(r) => openSupplier(r.supplier.id)} dense pageSize={20} exportName="supplier-performance" />
        </div>
      </SectionCard>
    </div>
  );
}
