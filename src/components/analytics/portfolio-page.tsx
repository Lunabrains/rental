"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download } from "lucide-react";

import { Chips } from "@/components/common/chips";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { exportXlsx, stampedName } from "@/lib/export";
import { today } from "@/lib/date";
import { formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { getExpirationTimeline, getPortfolioTrends } from "@/lib/queries";

type Months = "6" | "12" | "24";

const tick = { fill: "var(--muted-foreground)", fontSize: 11 };
const money = (v: number) => formatMoneyCompact(v);
const monthTick = (p: string) => formatMonthShort(p);

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <SectionCard title={title} description={description}>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </SectionCard>
  );
}

/** Portfolio analytics (plan §Phase 17): the trends behind the dashboard, month by month. */
export function PortfolioAnalyticsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const months = (params.get("months") as Months | null) ?? "12";
  const propertyId = params.get("property");

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "months" && v === "12")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/analytics${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const trends = useMemo(() => getPortfolioTrends(store, Number(months), propertyId ?? undefined), [store, months, propertyId]);
  const expirations = useMemo(() => getExpirationTimeline(store, 12, propertyId ?? undefined), [store, propertyId]);
  const first = trends[0];
  const last = trends[trends.length - 1];
  const sum = (k: keyof typeof last) => trends.reduce((n, t) => n + Number(t[k]), 0);
  const avgCollection = trends.filter((t) => t.expected > 0).length > 0 ? trends.filter((t) => t.expected > 0).reduce((n, t) => n + t.collectionRate, 0) / trends.filter((t) => t.expected > 0).length : 0;
  const occDelta = last && first ? last.occupancy - first.occupancy : 0;

  function exportTrends() {
    exportXlsx(stampedName("portfolio-analytics", today()), [
      { name: "Trends", columns: ["Month", "Occupancy %", "Rent due", "Collected", "Collection %", "Outstanding", "Operating expenses", "CapEx", "NOI", "Maintenance", "Vacancy loss (est.)"], rows: trends.map((t) => [t.period, Math.round(t.occupancy * 1000) / 10, t.expected, t.collected, Math.round(t.collectionRate * 1000) / 10, t.outstanding, t.operating, t.capex, t.noi, t.maintenance, t.vacancyLoss]) },
      { name: "Expirations", columns: ["Month", "Contracts ending", "Rent at stake", "Renewing", "Leaving", "Undecided"], rows: expirations.map((e) => [e.period, e.count, e.rent, e.renewing, e.leaving, e.undecided]) },
    ]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Portfolio analytics"
        description={`${trends.length} months to ${last ? formatMonth(last.period) : ""} · every series comes from the same records as the screens; vacancy loss is an estimate`}
        actions={
          <Button variant="outline" onClick={exportTrends}>
            <Download className="size-4" /> Export Excel
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Occupancy now" value={last ? formatPercent(last.occupancy) : "—"} sublabel={`${occDelta >= 0 ? "+" : ""}${(occDelta * 100).toFixed(1)} pts vs ${first ? formatMonthShort(first.period) : ""}`} tone={occDelta < -0.02 ? "warning" : "default"} />
        <KpiCard label="Average collection" value={formatPercent(avgCollection)} sublabel={`${formatMoney(sum("collected"))} collected of ${formatMoney(sum("expected"))} due`} tone={avgCollection >= 0.9 ? "success" : "warning"} />
        <KpiCard label="NOI" value={formatMoney(sum("noi"))} sublabel={`${formatMoney(sum("operating"))} operating · ${formatMoney(sum("capex"))} CapEx kept out`} tone={sum("noi") >= 0 ? "success" : "critical"} icon={BarChart3} />
        <KpiCard label="Vacancy loss (est.)" value={formatMoney(sum("vacancyLoss"))} sublabel={`${formatMoney(sum("maintenance"))} spent on maintenance`} tone={sum("vacancyLoss") > 0 ? "warning" : "success"} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<Months> aria-label="Months" value={months} onChange={(v) => setParams({ months: v })} options={[{ value: "6", label: "6 months" }, { value: "12", label: "12 months" }, { value: "24", label: "24 months" }]} />
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title="Occupancy" description="Share of rentable units occupied at month end">
          <AreaChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tickLine={false} axisLine={false} width={40} tick={tick} />
            <Tooltip formatter={(v) => formatPercent(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
            <Area type="monotone" dataKey="occupancy" name="Occupancy" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.15} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ChartCard>
        <ChartCard title="Rent due vs collected" description="Rent billed for the month against cash received in it">
          <BarChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="expected" name="Due" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="collected" name="Collected" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Outstanding rent" description="Unpaid rent at each month end">
          <LineChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
            <Line type="monotone" dataKey="outstanding" name="Outstanding" stroke="var(--chart-5)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Expenses" description="Operating expenses with CapEx shown separately">
          <BarChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="operating" name="Operating" stackId="e" fill="var(--chart-1)" isAnimationActive={false} />
            <Bar dataKey="capex" name="CapEx" stackId="e" fill="var(--chart-4)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <ChartCard title="NOI" description="Rent billed minus operating expenses">
          <ComposedChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} />
            <Bar dataKey="noi" name="NOI" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </ComposedChart>
        </ChartCard>
        <ChartCard title="Maintenance cost" description="Work-order and maintenance expenses by month">
          <BarChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Bar dataKey="maintenance" name="Maintenance" fill="var(--chart-3)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Vacancy loss (estimate)" description="Rent forgone while units sat empty, at their reference rent">
          <BarChart data={trends} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis tickFormatter={money} tickLine={false} axisLine={false} width={52} tick={tick} />
            <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Bar dataKey="vacancyLoss" name="Vacancy loss" fill="var(--chart-5)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
        <ChartCard title="Contract expirations" description="Contracts ending in the next 12 months and where the renewal stands">
          <BarChart data={expirations} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="period" tickFormatter={monthTick} tickLine={false} axisLine={false} tick={tick} dy={6} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={tick} />
            <Tooltip labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="renewing" name="Renewing" stackId="x" fill="var(--chart-2)" isAnimationActive={false} />
            <Bar dataKey="undecided" name="Undecided" stackId="x" fill="var(--chart-4)" isAnimationActive={false} />
            <Bar dataKey="leaving" name="Leaving" stackId="x" fill="var(--chart-5)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartCard>
      </div>
    </div>
  );
}
