"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, DoorOpen, LineChart } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent, labelize } from "@/lib/format";
import { getCashFlowForecast, getVacancyCost, type ForecastItem, type ForecastKind, type ForecastMonth, type VacancyCostRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Horizon = "3" | "6" | "12";

const KIND_LABEL: Record<ForecastKind, string> = { rent: "Rent due", rent_at_risk: "Rent at risk", other_income: "Other income", expense_due: "Invoices due", expense_recurring: "Recurring costs", service: "Preventive services", capex: "CapEx", deposit_refund: "Deposit refunds" };
const KIND_ORDER: ForecastKind[] = ["rent", "rent_at_risk", "other_income", "expense_due", "expense_recurring", "service", "capex", "deposit_refund"];

/** Cash flow & forecast (plan §Phase 13): what comes in, what goes out, month by month — all from the records. */
export function CashFlowPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openPayment, editExpense, openDeposit, openRenovation, openUnitPage, renewContract, renewalDecision, logService } = useActions();
  const propertyId = params.get("property");
  const horizon = (params.get("months") as Horizon | null) ?? "3";
  const [opening, setOpening] = useState(0);
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "months" && v === "3")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/cash-flow${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const forecast = useMemo(() => getCashFlowForecast(store, { months: Number(horizon), propertyId: propertyId ?? undefined }), [store, horizon, propertyId]);
  const vacancy = useMemo(() => getVacancyCost(store, propertyId ?? undefined), [store, propertyId]);
  const chart = forecast.months.map((m) => ({ period: m.period, in: m.rentExpected + m.otherIncome, risk: m.rentAtRisk, out: -(m.outflows - m.capex - m.depositRefunds), capex: -m.capex, refunds: -m.depositRefunds, balance: opening + m.cumulative }));
  const firstNegative = forecast.months.find((m) => opening + m.cumulative < 0);

  function openItem(i: ForecastItem) {
    if (!i.ref) return;
    if (i.ref.type === "payment") openPayment(i.ref.id);
    else if (i.ref.type === "expense") editExpense(i.ref.id);
    else if (i.ref.type === "deposit") openDeposit(i.ref.id);
    else if (i.ref.type === "renovation") openRenovation(i.ref.id);
    else if (i.ref.type === "plan") logService(i.ref.id);
  }

  const vacancyColumns: Column<VacancyCostRow>[] = [
    { key: "unit", header: "Unit", cell: (r) => <span className="font-medium">{r.property.name} · {r.unit.unitNumber}</span>, value: (r) => `${r.property.name} ${r.unit.unitNumber}` },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.unit.status} dot />, value: (r) => r.unit.status },
    { key: "days", header: "Days empty", align: "right", cell: (r) => (r.daysVacant > 0 ? r.daysVacant : "—"), value: (r) => r.daysVacant },
    { key: "ref", header: "Reference rent", align: "right", cell: (r) => (r.referenceRent > 0 ? <span>{formatMoney(r.referenceRent)}<span className="ml-1 text-[10px] text-muted-foreground">{labelize(r.source)}</span></span> : "—"), value: (r) => r.referenceRent },
    { key: "lost", header: "Lost so far (est.)", align: "right", cell: (r) => (r.lostSoFar > 0 ? <span className="font-medium text-critical">{formatMoney(r.lostSoFar)}</span> : "—"), value: (r) => r.lostSoFar },
    { key: "monthly", header: "Per month", align: "right", cell: (r) => (r.monthlyCost > 0 ? formatMoney(r.monthlyCost) : "—"), value: (r) => r.monthlyCost },
    { key: "note", header: "Plan", cell: (r) => <span className="text-xs text-muted-foreground">{r.note ?? (r.daysVacant > 60 ? "No project — consider pricing or works" : "")}</span>, value: (r) => r.note ?? "" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash flow & forecast"
        description={`${formatDate(forecast.from)} → ${formatDate(forecast.to)} · built from the schedule, open invoices, recurring patterns, services, projects and deposits — an estimate, not a promise`}
        actions={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Opening balance
            <Input type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value) || 0)} className="h-8 w-32 tabular" aria-label="Opening balance" />
          </label>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Expected in" value={formatMoney(forecast.totals.inflows)} sublabel={`Likely ${formatMoney(forecast.likelyCollected)} at ${formatPercent(forecast.collectionRate)} trailing collection`} tone="success" />
        <KpiCard label="Going out" value={formatMoney(forecast.totals.outflows)} sublabel={`${formatMoney(forecast.totals.capex)} of it CapEx`} tone={forecast.totals.outflows > forecast.totals.inflows ? "critical" : "default"} />
        <KpiCard label="Net" value={`${forecast.totals.net >= 0 ? "+" : ""}${formatMoney(forecast.totals.net)}`} sublabel={firstNegative ? `Balance dips below zero in ${formatMonth(firstNegative.period)}` : "Balance stays positive"} tone={forecast.totals.net >= 0 ? "success" : "critical"} icon={LineChart} />
        <KpiCard label="Rent at risk" value={formatMoney(forecast.totals.rentAtRisk)} sublabel={`${vacancy.atRisk.length} contract${vacancy.atRisk.length === 1 ? "" : "s"} ending soon without a renewal · vacancy costs ${formatMoney(vacancy.monthlyRunRate)}/month`} tone={forecast.totals.rentAtRisk > 0 ? "warning" : "default"} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<Horizon> aria-label="Horizon" value={horizon} onChange={(v) => setParams({ months: v })} options={[{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }]} />
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <SectionCard title="Month by month" description="Bars: money in and out · line: running balance from the opening figure">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} stackOffset="sign" barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
              <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <Tooltip formatter={(v, n) => [formatMoney(Math.abs(Number(v))), String(n)]} labelFormatter={(l) => formatMonth(String(l))} cursor={{ fill: "var(--accent)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="in" name="Rent & income" stackId="a" fill="var(--chart-2)" isAnimationActive={false} />
              <Bar dataKey="risk" name="Rent at risk" stackId="a" fill="var(--chart-4)" isAnimationActive={false} />
              <Bar dataKey="out" name="Operating out" stackId="a" fill="var(--chart-1)" isAnimationActive={false} />
              <Bar dataKey="capex" name="CapEx" stackId="a" fill="var(--chart-5)" isAnimationActive={false} />
              <Bar dataKey="refunds" name="Deposit refunds" stackId="a" fill="var(--chart-3)" isAnimationActive={false} />
              <Line type="monotone" dataKey="balance" name="Balance" stroke="var(--foreground)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="Breakdown" description="Open a month to see every line behind the number" flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-right">Rent due</th>
                <th className="px-3 py-2 text-right">At risk</th>
                <th className="px-3 py-2 text-right">Invoices</th>
                <th className="px-3 py-2 text-right">Recurring</th>
                <th className="px-3 py-2 text-right">Services</th>
                <th className="px-3 py-2 text-right">CapEx</th>
                <th className="px-3 py-2 text-right">Refunds</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {forecast.months.map((m) => (
                <MonthRows key={m.period} m={m} open={openMonth === m.period} onToggle={() => setOpenMonth(openMonth === m.period ? null : m.period)} balance={opening + m.cumulative} onItem={openItem} />
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Vacancy cost" description={`${vacancy.rows.length} unit${vacancy.rows.length === 1 ? "" : "s"} not earning · ${formatMoney(vacancy.totalLost)} lost so far (est.) · ${formatMoney(vacancy.monthlyRunRate)} per month`} flush>
          <div className="p-3">
            <DataTable rows={vacancy.rows} columns={vacancyColumns} rowKey={(r) => r.unit.id} onRowClick={(r) => openUnitPage(r.unit.id)} dense emptyTitle="Every unit is earning" emptyIcon={DoorOpen} />
          </div>
        </SectionCard>
        <SectionCard title="Rent at risk" description={`${formatMoney(vacancy.atRiskMonthly)}/month on contracts ending within 60 days with no renewal agreed`} flush>
          {vacancy.atRisk.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing ending in the next 60 days without a renewal.</p>
          ) : (
            <ul className="divide-y">
              {vacancy.atRisk.map((r) => (
                <li key={r.contract.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.tenant?.fullName ?? "Tenant"} <span className="font-normal text-muted-foreground">· {r.property?.name} {r.unit?.unitNumber}</span></p>
                    <p className="text-xs text-muted-foreground">{formatMoney(r.contract.monthlyRent)}/month · ends {formatDate(r.contract.moveOutDate ?? r.contract.endDate)} ({r.daysLeft < 0 ? `${-r.daysLeft} days ago` : `in ${r.daysLeft} days`}) · {labelize(r.contract.renewalStatus)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => renewalDecision(r.contract.id)}>Decide</Button>
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={() => renewContract(r.contract.id)}>Renew</Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function MonthRows({ m, open, onToggle, balance, onItem }: { m: ForecastMonth; open: boolean; onToggle: () => void; balance: number; onItem: (i: ForecastItem) => void }) {
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: m.items.filter((i) => i.kind === k) })).filter((g) => g.items.length > 0);
  return (
    <>
      <tr className={cn("cursor-pointer hover:bg-accent/40", open && "bg-accent/30")} onClick={onToggle}>
        <td className="px-4 py-2 font-medium">
          <span className="inline-flex items-center gap-1">{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{formatMonth(m.period)}</span>
        </td>
        <td className="px-3 py-2 text-right tabular text-success">{formatMoney(m.rentExpected)}</td>
        <td className={cn("px-3 py-2 text-right tabular", m.rentAtRisk > 0 && "text-warning-foreground")}>{m.rentAtRisk > 0 ? formatMoney(m.rentAtRisk) : "—"}</td>
        <td className="px-3 py-2 text-right tabular">{m.expensesDue > 0 ? formatMoney(m.expensesDue) : "—"}</td>
        <td className="px-3 py-2 text-right tabular">{m.expensesRecurring > 0 ? formatMoney(m.expensesRecurring) : "—"}</td>
        <td className="px-3 py-2 text-right tabular">{m.services > 0 ? formatMoney(m.services) : "—"}</td>
        <td className="px-3 py-2 text-right tabular">{m.capex > 0 ? formatMoney(m.capex) : "—"}</td>
        <td className="px-3 py-2 text-right tabular">{m.depositRefunds > 0 ? formatMoney(m.depositRefunds) : "—"}</td>
        <td className={cn("px-3 py-2 text-right tabular font-medium", m.net >= 0 ? "text-success" : "text-critical")}>{m.net >= 0 ? "+" : ""}{formatMoney(m.net)}</td>
        <td className={cn("px-4 py-2 text-right tabular font-medium", balance < 0 && "text-critical")}>{formatMoney(balance)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="bg-muted/20 px-4 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              {groups.map((g) => (
                <div key={g.kind}>
                  <p className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span>{KIND_LABEL[g.kind]} · {g.items.length}</span>
                    <span className="tabular">{formatMoney(g.items.reduce((n, i) => n + i.amount, 0))}</span>
                  </p>
                  <ul className="divide-y rounded-md border bg-card">
                    {g.items.slice(0, 12).map((i, idx) => (
                      <li key={`${i.ref?.id ?? i.label}-${idx}`} className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-xs hover:bg-accent/40" onClick={() => onItem(i)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{i.label}{i.projected && <span className="ml-1 font-normal text-muted-foreground">(projected)</span>}</span>
                          <span className="block truncate text-muted-foreground">{i.detail}</span>
                        </span>
                        <span className={cn("tabular", i.direction === "in" ? "text-success" : "text-foreground")}>{i.direction === "in" ? "+" : "−"}{formatMoney(i.amount)}</span>
                      </li>
                    ))}
                    {g.items.length > 12 && <li className="px-3 py-1.5 text-xs text-muted-foreground">+{g.items.length - 12} more</li>}
                  </ul>
                </div>
              ))}
              {groups.length === 0 && <p className="text-xs text-muted-foreground">Nothing scheduled for this month.</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
