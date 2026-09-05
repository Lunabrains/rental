"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ScoreBadge } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { useStore } from "@/lib/data/store-context";
import { buildingHealth } from "@/lib/derived/metrics";
import { formatMoney, formatMoneyCompact, formatPercent } from "@/lib/format";
import { getPortfolioComparison, getUnitRankings, type BuildingComparison, type ProfitabilityWindow, type UnitRanking } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface BarPayload {
  payload?: BuildingComparison;
}

function CompareTooltip({ active, payload }: { active?: boolean; payload?: BarPayload[] }) {
  const r = payload?.[0]?.payload;
  if (!active || !r) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{r.property.name}</div>
      <div className="tabular mt-1.5 space-y-1">
        <div className="flex gap-4"><span className="text-muted-foreground">Revenue</span><span className="ml-auto font-medium">{formatMoney(r.revenue)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">Operating expenses</span><span className="ml-auto font-medium">{formatMoney(r.operatingExpenses)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">NOI</span><span className="ml-auto font-medium">{formatMoney(r.noi)} · {formatPercent(r.margin)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">NOI / unit / month</span><span className="ml-auto font-medium">{formatMoney(Math.round(r.noiPerUnit))}</span></div>
      </div>
    </div>
  );
}

/**
 * Portfolio performance (plan §Phase 5 comparison + §Phase 17 building
 * comparison): which building makes the money and why.
 */
export function PerformancePage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openProperty, openUnitPage } = useActions();
  const window = (params.get("window") as ProfitabilityWindow | null) ?? "12m";
  const propertyId = params.get("property");
  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "all" || (k === "window" && v === "12m")) sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/analytics/performance${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const cmp = useMemo(() => getPortfolioComparison(store, window), [store, window]);
  const units = useMemo(() => getUnitRankings(store, window, propertyId ?? undefined), [store, window, propertyId]);
  const t = cmp.totals;

  const columns: Column<BuildingComparison>[] = [
    { key: "name", header: "Building", cell: (r) => <span className="font-medium">{r.property.name}</span>, value: (r) => r.property.name },
    { key: "units", header: "Units", align: "right", cell: (r) => r.units, value: (r) => r.units },
    { key: "occupancy", header: "Occupancy", align: "right", cell: (r) => <span className={cn(r.occupancy < store.settings.thresholds.buildingOccupancyWarning && "text-warning-foreground")}>{formatPercent(r.occupancy)}</span>, value: (r) => r.occupancy },
    { key: "revenue", header: "Revenue", align: "right", cell: (r) => formatMoney(r.revenue), value: (r) => r.revenue },
    { key: "collection", header: "Collected", align: "right", cell: (r) => <span className={cn(r.collectionRate < 0.9 && "text-warning-foreground")}>{formatPercent(r.collectionRate)}</span>, value: (r) => r.collectionRate },
    { key: "expenses", header: "Op. expenses", align: "right", cell: (r) => formatMoney(r.operatingExpenses), value: (r) => r.operatingExpenses },
    { key: "maintenance", header: "Maintenance", align: "right", cell: (r) => formatMoney(r.maintenance), value: (r) => r.maintenance },
    { key: "noi", header: "NOI", align: "right", cell: (r) => <span className={cn("font-medium", r.noi < 0 && "text-critical")}>{formatMoney(r.noi)}</span>, value: (r) => r.noi },
    { key: "margin", header: "Margin", align: "right", cell: (r) => formatPercent(r.margin), value: (r) => r.margin },
    { key: "perUnit", header: "NOI / unit / mo", align: "right", cell: (r) => <span className="font-medium">{formatMoney(Math.round(r.noiPerUnit))}</span>, value: (r) => r.noiPerUnit },
    { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => (r.outstanding > 0 ? <span className="text-critical">{formatMoney(r.outstanding)}</span> : "—"), value: (r) => r.outstanding },
    { key: "vacancy", header: "Vacancy loss*", align: "right", cell: (r) => (r.vacancyLoss > 0 ? formatMoney(r.vacancyLoss) : "—"), value: (r) => r.vacancyLoss },
    { key: "health", header: "Health", align: "right", cell: (r) => <ScoreBadge size="sm" score={r.health} label={`${r.property.name} health`} components={buildingHealth(store, r.property.id).components} />, value: (r) => r.health },
  ];

  const unitColumns: Column<UnitRanking>[] = [
    { key: "unit", header: "Unit", cell: (r) => <span className="font-medium">{r.property.name} · {r.unit.unitNumber}</span>, value: (r) => `${r.property.name} ${r.unit.unitNumber}` },
    { key: "tenant", header: "Tenant", cell: (r) => r.tenant ?? <span className="text-muted-foreground">vacant</span>, value: (r) => r.tenant ?? "" },
    { key: "billed", header: "Rent billed", align: "right", cell: (r) => formatMoney(r.rentBilled), value: (r) => r.rentBilled },
    { key: "costs", header: "Costs", align: "right", cell: (r) => (r.costs > 0 ? formatMoney(r.costs) : "—"), value: (r) => r.costs },
    { key: "net", header: "Net contribution", align: "right", cell: (r) => <span className={cn("font-medium", r.net < 0 && "text-critical")}>{formatMoney(r.net)}</span>, value: (r) => r.net },
    { key: "vacancy", header: "Vacant days", align: "right", cell: (r) => (r.vacancyDays > 0 ? <span className="text-warning-foreground">{r.vacancyDays}</span> : "—"), value: (r) => r.vacancyDays },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Portfolio performance"
        description={`${cmp.label} · ${cmp.best ? `${cmp.best.property.name} leads on NOI per unit` : ""}${cmp.worst ? ` · ${cmp.worst.property.name} trails` : ""}`}
        actions={<Chips<ProfitabilityWindow> aria-label="Window" value={window} onChange={(v) => setParams({ window: v })} options={[{ value: "month", label: "This month" }, { value: "ytd", label: "Year to date" }, { value: "12m", label: "12 months" }]} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Revenue" value={formatMoney(t.revenue)} sublabel={`${formatPercent(t.collectionRate)} collected`} />
        <KpiCard label="Operating expenses" value={formatMoney(t.operatingExpenses)} sublabel={`maintenance ${formatMoney(t.maintenance)} · utilities ${formatMoney(t.utilities)}`} />
        <KpiCard label="NOI" value={formatMoney(t.noi)} sublabel={`${formatPercent(t.margin)} margin · ${formatMoney(Math.round(t.noiPerUnit))}/unit/month`} tone={t.margin < 0.5 ? "warning" : "success"} />
        <KpiCard label="CapEx" value={formatMoney(t.capex)} sublabel="Excluded from NOI" />
        <KpiCard label="Vacancy loss*" value={formatMoney(t.vacancyLoss)} sublabel="Estimate at reference rents" tone={t.vacancyLoss > 0 ? "warning" : "success"} />
      </div>

      <SectionCard title="NOI by building" description={`${cmp.label} — revenue vs operating expenses; the difference is NOI`}>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cmp.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey={(r: BuildingComparison) => r.property.name.split(" ")[0]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
              <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <Tooltip content={<CompareTooltip />} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="revenue" name="Revenue" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="operatingExpenses" name="Operating expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="noi" name="NOI" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Building comparison" description="Sorted by NOI per unit per month — click a building to open it" flush>
        <div className="p-3">
          <DataTable rows={cmp.rows} columns={columns} rowKey={(r) => r.property.id} onRowClick={(r) => openProperty(r.property.id)} dense exportName={`building-comparison-${window}`} defaultSort={{ key: "perUnit", dir: "desc" }} />
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">*Vacancy loss is an estimate: reference rent (last contracted → market → asking) × days vacant.</p>
      </SectionCard>

      <SectionCard
        title="Unit profitability"
        description={`${cmp.label} · net contribution = rent billed − operating expenses and maintenance attributed to the unit`}
        action={
          <div className="w-48">
            <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
          </div>
        }
        flush
      >
        <div className="p-3">
          <DataTable rows={units} columns={unitColumns} rowKey={(r) => r.unit.id} onRowClick={(r) => openUnitPage(r.unit.id, "profitability")} dense pageSize={25} exportName={`unit-profitability-${window}`} defaultSort={{ key: "net", dir: "desc" }} searchable={(r) => `${r.property.name} ${r.unit.unitNumber} ${r.tenant ?? ""}`} />
        </div>
      </SectionCard>
    </div>
  );
}
