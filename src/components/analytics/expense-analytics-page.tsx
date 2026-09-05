"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Wallet } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { expenseColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { exportXlsx, stampedName } from "@/lib/export";
import { formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent, labelize } from "@/lib/format";
import { getExpenseAnalytics, type ExpenseAnalytics } from "@/lib/queries";
import { cn } from "@/lib/utils";

const tick = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Expense analytics (plan §Phase 17): where the money goes, by category, building and supplier, and how it moves. */
export function ExpenseAnalyticsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { editExpense, openProperty, openSupplier } = useActions();
  const thisYear = today().slice(0, 4);
  const year = params.get("year") ?? thisYear;
  const propertyId = params.get("property");

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "year" && v === thisYear)) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/analytics/expenses${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const a = useMemo(() => getExpenseAnalytics(store, { propertyId: propertyId ?? undefined, year }), [store, propertyId, year]);
  const prev = a.yearOverYear.find((y) => y.year === String(Number(year) - 1));
  const years = a.yearOverYear.map((y) => y.year);
  const yearOptions = (years.includes(thisYear) ? years : [...years, thisYear]).sort().reverse().slice(0, 4);

  const categoryColumns: Column<ExpenseAnalytics["byCategory"][number]>[] = [
    { key: "category", header: "Category", cell: (r) => <span className="font-medium">{labelize(r.category)}</span>, value: (r) => r.category },
    { key: "amount", header: year, align: "right", cell: (r) => formatMoney(r.amount), value: (r) => r.amount },
    { key: "share", header: "Share", align: "right", cell: (r) => formatPercent(r.share), value: (r) => r.share },
    { key: "count", header: "Expenses", align: "right", cell: (r) => r.count, value: (r) => r.count },
    { key: "prev", header: String(Number(year) - 1), align: "right", cell: (r) => (r.prevYear > 0 ? formatMoney(r.prevYear) : "—"), value: (r) => r.prevYear },
    { key: "change", header: "Year over year", align: "right", cell: (r) => (r.change === null ? <span className="text-muted-foreground">new</span> : <span className={cn(r.change > 0.1 ? "text-critical" : r.change < 0 ? "text-success" : "")}>{r.change >= 0 ? "+" : ""}{formatPercent(r.change)}</span>), value: (r) => r.change ?? 0 },
  ];
  const buildingColumns: Column<ExpenseAnalytics["byBuilding"][number]>[] = [
    { key: "building", header: "Building", cell: (r) => <span className="font-medium">{r.property.name}</span>, value: (r) => r.property.name },
    { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount), value: (r) => r.amount },
    { key: "share", header: "Share", align: "right", cell: (r) => formatPercent(r.share), value: (r) => r.share },
    { key: "perUnit", header: "Per unit", align: "right", cell: (r) => formatMoney(Math.round(r.perUnit)), value: (r) => r.perUnit },
    { key: "count", header: "Expenses", align: "right", cell: (r) => r.count, value: (r) => r.count },
  ];
  const supplierColumns: Column<ExpenseAnalytics["bySupplier"][number]>[] = [
    { key: "name", header: "Supplier", cell: (r) => <span className={cn("font-medium", !r.supplier && "text-muted-foreground")}>{r.name}</span>, value: (r) => r.name },
    { key: "category", header: "Category", cell: (r) => (r.supplier ? labelize(r.supplier.category) : "—"), value: (r) => r.supplier?.category ?? "" },
    { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.amount), value: (r) => r.amount },
    { key: "share", header: "Share", align: "right", cell: (r) => formatPercent(r.share), value: (r) => r.share },
    { key: "count", header: "Invoices", align: "right", cell: (r) => r.count, value: (r) => r.count },
  ];

  function exportAll() {
    exportXlsx(stampedName(`expense-analytics-${year}`, today()), [
      { name: "By category", columns: ["Category", year, "Share %", "Expenses", String(Number(year) - 1), "Change %"], rows: a.byCategory.map((r) => [labelize(r.category), r.amount, Math.round(r.share * 1000) / 10, r.count, r.prevYear, r.change === null ? "" : Math.round(r.change * 1000) / 10]) },
      { name: "By building", columns: ["Building", "Amount", "Share %", "Per unit", "Expenses"], rows: a.byBuilding.map((r) => [r.property.name, r.amount, Math.round(r.share * 1000) / 10, Math.round(r.perUnit), r.count]) },
      { name: "By supplier", columns: ["Supplier", "Amount", "Share %", "Invoices"], rows: a.bySupplier.map((r) => [r.name, r.amount, Math.round(r.share * 1000) / 10, r.count]) },
      { name: "Monthly", columns: ["Month", "Operating", "CapEx", "Total", "Same month last year"], rows: a.monthly.map((m) => [m.period, m.operating, m.capex, m.total, m.prevYear ?? ""]) },
      { name: "Year over year", columns: ["Year", "Total", "Operating", "CapEx"], rows: a.yearOverYear.map((y) => [y.year, y.total, y.operating, y.capex]) },
    ]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expense analytics"
        description={`${a.count} expenses in ${year}${propertyId ? "" : " across the portfolio"} · ${formatMoney(a.operating)} operating · ${formatMoney(a.capex)} CapEx`}
        actions={
          <Button variant="outline" onClick={exportAll}>
            <Download className="size-4" /> Export Excel
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Total ${year}`} value={formatMoney(a.total)} sublabel={prev ? `${prev.total > 0 ? `${a.total >= prev.total ? "+" : ""}${formatPercent((a.total - prev.total) / prev.total)} vs ` : ""}${formatMoney(prev.total)} in ${prev.year}` : "No earlier year on record"} tone={prev && prev.total > 0 && a.total > prev.total * 1.1 ? "warning" : "default"} icon={Wallet} />
        <KpiCard label="Operating" value={formatMoney(a.operating)} sublabel={`${a.total > 0 ? formatPercent(a.operating / a.total) : "—"} of spend · drives NOI`} />
        <KpiCard label="CapEx" value={formatMoney(a.capex)} sublabel="Kept out of operating results" href="/renovations" />
        <KpiCard label="Largest category" value={a.byCategory[0] ? labelize(a.byCategory[0].category) : "—"} sublabel={a.byCategory[0] ? `${formatMoney(a.byCategory[0].amount)} · ${formatPercent(a.byCategory[0].share)} of spend` : ""} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips aria-label="Year" value={year} onChange={(v) => setParams({ year: v })} options={yearOptions.map((y) => ({ value: y, label: y }))} />
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="By category" description={`${year} against ${Number(year) - 1}`}>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.byCategory.slice(0, 10).map((r) => ({ ...r, label: labelize(r.category) }))} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} tick={tick} />
                <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} tick={tick} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} cursor={{ fill: "var(--accent)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="prevYear" name={String(Number(year) - 1)} fill="var(--chart-3)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="amount" name={year} fill="var(--chart-1)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard title="Month by month" description="Operating and CapEx per month, with the same month a year earlier">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={a.monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={tick} dy={6} />
                <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={52} tick={tick} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="operating" name="Operating" stackId="m" fill="var(--chart-1)" isAnimationActive={false} />
                <Bar dataKey="capex" name="CapEx" stackId="m" fill="var(--chart-4)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Line type="monotone" dataKey="prevYear" name="Last year" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Categories" flush>
          <div className="p-3">
            <DataTable rows={a.byCategory} columns={categoryColumns} rowKey={(r) => r.category} dense exportName={`expenses-by-category-${year}`} defaultSort={{ key: "amount", dir: "desc" }} />
          </div>
        </SectionCard>
        <SectionCard title="Buildings" flush>
          <div className="p-3">
            <DataTable rows={a.byBuilding} columns={buildingColumns} rowKey={(r) => r.property.id} onRowClick={(r) => openProperty(r.property.id)} dense exportName={`expenses-by-building-${year}`} />
          </div>
        </SectionCard>
        <SectionCard title="Suppliers" flush>
          <div className="p-3">
            <DataTable rows={a.bySupplier} columns={supplierColumns} rowKey={(r) => r.supplier?.id ?? "none"} onRowClick={(r) => r.supplier && openSupplier(r.supplier.id)} dense pageSize={15} exportName={`expenses-by-supplier-${year}`} />
          </div>
        </SectionCard>
        <SectionCard title="Largest expenses" description={`Top 10 in ${year}`} flush>
          <div className="p-3">
            <DataTable rows={a.largest} columns={expenseColumns} rowKey={(r) => r.expense.id} onRowClick={(r) => editExpense(r.expense.id)} dense />
          </div>
        </SectionCard>
      </div>
      {a.yearOverYear.length > 1 && (
        <SectionCard title="Year over year" description="Every year with expenses on record" flush>
          <div className="p-3">
            <DataTable rows={a.yearOverYear} columns={[{ key: "year", header: "Year", cell: (r) => <span className="font-medium">{r.year}</span>, value: (r) => r.year }, { key: "total", header: "Total", align: "right", cell: (r) => formatMoney(r.total), value: (r) => r.total }, { key: "operating", header: "Operating", align: "right", cell: (r) => formatMoney(r.operating), value: (r) => r.operating }, { key: "capex", header: "CapEx", align: "right", cell: (r) => formatMoney(r.capex), value: (r) => r.capex }]} rowKey={(r) => r.year} dense onRowClick={(r) => setParams({ year: r.year })} />
          </div>
        </SectionCard>
      )}
    </div>
  );
}
