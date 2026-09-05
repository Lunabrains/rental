"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, FileText, Wrench } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useActions } from "@/components/actions/action-provider";
import { AlertRow } from "@/components/alerts/alert-row";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { ScoreBreakdown } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { PriorityBadge, StatusBadge } from "@/components/common/status-badge";
import { Timeline } from "@/components/common/timeline";
import { DocumentPreview } from "@/components/documents/document-preview";
import { Button } from "@/components/ui/button";
import { DocumentRow } from "@/components/units/documents-tab";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent, labelize } from "@/lib/format";
import {
  getPortfolioComparison,
  getPropertyFinancials,
  getPropertyOverview,
  getPropertyTimeline,
  getAssets,
  getPreventivePlans,
  getWorkOrders,
  getMaintenanceSummary,
  type AssetRow,
  type BudgetRow,
  type ExpenseRow,
  type FinancialMonth,
  type PlanRow,
  type PropertySummary,
  type TimelineEvent,
  type WorkOrderRow,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

/* -------------------------------- Overview -------------------------------- */

export function BuildingOverview({ summary }: { summary: PropertySummary }) {
  const store = useStore();
  const { openUnit, openUnitPage } = useActions();
  const o = useMemo(() => getPropertyOverview(store, summary.id), [store, summary.id]);
  const t = store.settings.thresholds;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Occupancy" value={formatPercent(summary.occupancy)} sublabel={`${summary.rented} of ${summary.units} units · ${o.vacantUnits} vacant`} tone={summary.occupancy < t.buildingOccupancyWarning ? "warning" : "default"} />
        <KpiCard label="Expected rent / month" value={formatMoney(o.rentRoll)} sublabel={`${formatMoney(o.thisMonth.income)} billed ${formatMonth(o.thisMonth.period)}`} />
        <KpiCard label="Collected this month" value={formatMoney(o.collection.collected)} sublabel={`${formatPercent(o.collection.rate)} of ${formatMoney(o.collection.due)} due so far`} tone={o.collection.rate < 0.8 ? "warning" : "success"} />
        <KpiCard label="Outstanding rent" value={o.outstanding > 0 ? formatMoney(o.outstanding) : "—"} sublabel={o.overdueCount > 0 ? `${o.overdueCount} unpaid payment${o.overdueCount === 1 ? "" : "s"}` : "Nothing overdue"} tone={o.outstanding > 0 ? "critical" : "success"} />
        <KpiCard label="Expenses this month" value={formatMoney(o.thisMonth.operatingExpenses)} sublabel={`${formatMoney(o.lastMonth.operatingExpenses)} last month${o.thisMonth.capex > 0 ? ` · CapEx ${formatMoney(o.thisMonth.capex)}` : ""}`} />
        <KpiCard label="NOI this month" value={formatMoney(o.thisMonth.noi)} sublabel={`${formatPercent(o.thisMonth.margin)} margin · ${formatMoney(o.lastMonth.noi)} last month`} tone={o.thisMonth.noi < o.lastMonth.noi * 0.8 ? "warning" : "default"} />
        <KpiCard label="Open maintenance" value={o.openWorkOrders.length} sublabel={o.emergencies > 0 ? `${o.emergencies} emergency · ${o.awaitingApproval} awaiting approval` : o.awaitingApproval > 0 ? `${o.awaitingApproval} awaiting approval` : "No emergencies"} tone={o.emergencies > 0 ? "critical" : o.openWorkOrders.length > 0 ? "warning" : "success"} />
        <KpiCard label="Services due" value={o.upcomingServices.length} sublabel={o.upcomingServices.some((p) => p.state === "overdue") ? `${o.upcomingServices.filter((p) => p.state === "overdue").length} overdue` : "Preventive maintenance"} tone={o.upcomingServices.some((p) => p.state === "overdue") ? "critical" : o.upcomingServices.length > 0 ? "warning" : "success"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Needs attention" description={`${o.alerts.length} open alert${o.alerts.length === 1 ? "" : "s"} in this building`}>
            {o.alerts.length === 0 ? (
              <EmptyState compact icon={CheckCircle2} title="Nothing needs attention" />
            ) : (
              <div className="space-y-2">
                {o.alerts.slice(0, 6).map((a) => (
                  <AlertRow key={a.id} alert={a} maxActions={1} compact />
                ))}
                {o.alerts.length > 6 && <p className="text-xs text-muted-foreground">+{o.alerts.length - 6} more on the alerts page</p>}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Contracts ending within 30 days" description={`${o.expiring60} within 60 days`} flush>
            {o.expiring30.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState compact icon={CalendarClock} title="No contracts end this month" />
              </div>
            ) : (
              <ul className="divide-y">
                {o.expiring30.map((r) => (
                  <li key={r.contract.id} className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50" onClick={() => openUnit(r.unit.id, "contract")}>
                    <span className={cn("tabular w-12 shrink-0 font-semibold", r.daysRemaining <= 7 ? "text-critical" : "text-warning-foreground")}>{r.daysRemaining}d</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {r.tenant.fullName} · {r.unit.unitNumber}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatMoney(r.contract.monthlyRent)}/month · ends {formatDate(r.contract.endDate)}
                        {r.hasOverdue ? " · overdue rent" : r.reliable ? " · reliable payer" : ""}
                      </span>
                    </span>
                    <StatusBadge value={r.contract.renewalStatus} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Upcoming & overdue services" description="Preventive maintenance">
            {o.upcomingServices.length === 0 ? (
              <EmptyState compact icon={Wrench} title="Nothing due in the next 30 days" />
            ) : (
              <ul className="divide-y">
                {o.upcomingServices.map((p) => (
                  <li key={p.plan.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className={cn("tabular w-14 shrink-0 font-semibold", p.state === "overdue" ? "text-critical" : "text-warning-foreground")}>{p.daysUntil < 0 ? `${Math.abs(p.daysUntil)}d late` : `in ${p.daysUntil}d`}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.plan.maintenanceType}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.asset?.name ?? "Building"}
                        {p.supplier ? ` · ${p.supplier.name}` : ""}
                        {p.plan.estimatedCost ? ` · est. ${formatMoney(p.plan.estimatedCost)}` : ""}
                      </span>
                    </span>
                    <StatusBadge value={p.state} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard>
            <ScoreBreakdown score={o.health.score} label="Building health" components={o.health.components} caption="Weighted: collections 25 · occupancy 20 · profitability 20 · maintenance 15 · budget 10 · compliance 10." />
          </SectionCard>

          <SectionCard title="Vacancy" description={o.vacantUnits > 0 ? `${o.vacantUnits} vacant · est. ${formatMoney(o.vacancyLossEstimate)} lost so far` : "Fully let"}>
            {o.vacantUnits === 0 ? (
              <p className="text-sm text-muted-foreground">Every rentable unit is occupied.</p>
            ) : (
              <ul className="divide-y">
                {store.units
                  .filter((u) => u.propertyId === summary.id && u.status === "available")
                  .sort((a, b) => (a.availableSince ?? "") < (b.availableSince ?? "") ? -1 : 1)
                  .slice(0, 6)
                  .map((u) => (
                    <li key={u.id} className="flex cursor-pointer items-center justify-between gap-2 py-1.5 text-sm hover:bg-accent/40" onClick={() => openUnitPage(u.id)}>
                      <span>
                        <span className="font-medium">{u.unitNumber}</span> <span className="text-xs text-muted-foreground">· {u.bedrooms} BR · asking {formatMoney(u.askingRent)}</span>
                      </span>
                      <span className="tabular text-xs text-muted-foreground">{u.availableSince ? `since ${formatDate(u.availableSince)}` : ""}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Vacancy loss is an estimate from the last contracted, market or asking rent.</p>
          </SectionCard>

          <SectionCard title="Deposits" description={`${formatMoney(o.deposits.held)} held across ${o.deposits.heldCount} tenancies`}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Awaiting settlement</dt>
                <dd className={cn("tabular mt-0.5 font-semibold", o.deposits.awaitingSettlementCount > 0 && "text-warning-foreground")}>{o.deposits.awaitingSettlementCount > 0 ? `${formatMoney(o.deposits.awaitingSettlement)} · ${o.deposits.awaitingSettlementCount}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Not yet received</dt>
                <dd className={cn("tabular mt-0.5 font-semibold", o.deposits.pendingCount > 0 && "text-warning-foreground")}>{o.deposits.pendingCount > 0 ? `${formatMoney(o.deposits.pending)} · ${o.deposits.pendingCount}` : "—"}</dd>
              </div>
            </dl>
          </SectionCard>

          {o.liveRenovations.length > 0 && (
            <SectionCard title="Renovations in progress">
              <ul className="space-y-3">
                {o.liveRenovations.map((r) => (
                  <li key={r.renovation.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.renovation.title}</span>
                      <StatusBadge value={r.renovation.status} />
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", r.variance > 0 ? "bg-warning" : "bg-success")} style={{ width: `${r.renovation.progressPercent}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.renovation.progressPercent}% · {formatMoney(r.renovation.actualCost)} of {formatMoney(r.renovation.budget)}
                      {r.delayed ? ` · ${Math.abs(r.daysToTarget)} days behind` : ` · due ${formatDate(r.renovation.targetEndDate)}`}
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Financials ------------------------------- */

interface ChartTooltipPayload {
  payload?: FinancialMonth;
}

function FinTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipPayload[] }) {
  const m = payload?.[0]?.payload;
  if (!active || !m) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatMonth(m.period)}</div>
      <div className="tabular mt-1.5 space-y-1">
        {[
          ["Rent billed", m.income],
          ["Collected", m.collected],
          ["Operating expenses", m.operatingExpenses],
          ["CapEx", m.capex],
          ["NOI", m.noi],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex items-center gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="ml-auto font-medium">{formatMoney(Number(v))}</span>
          </div>
        ))}
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">Occupancy</span>
          <span className="ml-auto font-medium">{formatPercent(m.occupancy)}</span>
        </div>
      </div>
    </div>
  );
}

export function FinancialsChart({ months }: { months: FinancialMonth[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
          <YAxis tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <Tooltip content={<FinTooltip />} cursor={{ fill: "var(--accent)" }} />
          <Bar dataKey="income" name="Rent billed" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Bar dataKey="operatingExpenses" name="Operating expenses" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          <Line dataKey="noi" name="NOI" type="monotone" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const budgetColumns: Column<BudgetRow>[] = [
  { key: "category", header: "Category", cell: (r) => <span className="font-medium">{labelize(r.budget.category)}</span> },
  { key: "period", header: "Period", cell: (r) => (r.budget.periodType === "year" ? r.budget.period : formatMonth(r.budget.period)) },
  { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.budget.amount), value: (r) => r.budget.amount },
  { key: "actual", header: "Actual", align: "right", cell: (r) => formatMoney(r.actual), value: (r) => r.actual },
  { key: "variance", header: "Variance", align: "right", cell: (r) => <span className={cn(r.variance.over ? "font-medium text-critical" : r.variance.variance > 0 ? "text-warning-foreground" : "text-success")}>{r.variance.variance > 0 ? "+" : ""}{formatMoney(r.variance.variance)}</span>, value: (r) => r.variance.variance },
  { key: "pct", header: "%", align: "right", cell: (r) => (r.variance.variancePct === null ? "—" : `${r.variance.variancePct > 0 ? "+" : ""}${formatPercent(r.variance.variancePct)}`), value: (r) => r.variance.variancePct },
  { key: "flag", header: "", cell: (r) => (r.variance.over ? <StatusBadge value="over_budget" label="Over budget" tone="critical" /> : <StatusBadge value="ok" label="Within budget" tone="success" />), sortable: false, noExport: true },
];

export const expenseColumns: Column<ExpenseRow>[] = [
  { key: "date", header: "Date", cell: (r) => formatDate(r.expense.expenseDate), value: (r) => r.expense.expenseDate },
  { key: "description", header: "Description", cell: (r) => <span className="font-medium">{r.expense.description}</span> },
  { key: "category", header: "Category", cell: (r) => labelize(r.expense.category) },
  { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—" },
  { key: "class", header: "Type", cell: (r) => <StatusBadge value={r.expense.classification} /> },
  { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.expense.amount), value: (r) => r.expense.amount },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.expense.paymentStatus} label={r.overdueDays > 0 ? `Unpaid · ${r.overdueDays}d late` : undefined} /> },
];

export function BuildingFinancials({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const fin = useMemo(() => getPropertyFinancials(store, propertyId), [store, propertyId]);
  const cmp12 = useMemo(() => getPortfolioComparison(store, "12m").rows.find((r) => r.property.id === propertyId) ?? null, [store, propertyId]);
  const cmpYtd = useMemo(() => getPortfolioComparison(store, "ytd").rows.find((r) => r.property.id === propertyId) ?? null, [store, propertyId]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Rent billed YTD" value={formatMoney(fin.ytd.income)} sublabel={`${formatMoney(fin.ytd.collected)} collected`} />
        <KpiCard label="Operating expenses YTD" value={formatMoney(fin.ytd.operating)} sublabel={fin.ytd.capex > 0 ? `+ ${formatMoney(fin.ytd.capex)} CapEx (not in NOI)` : "No CapEx this year"} />
        <KpiCard label="NOI YTD" value={formatMoney(fin.ytd.noi)} sublabel={`${formatPercent(fin.ytd.margin)} margin`} tone={fin.ytd.margin < 0.5 ? "warning" : "success"} />
        <KpiCard label="NOI trailing 12 months" value={formatMoney(fin.trailing12.noi)} sublabel={`${formatPercent(fin.trailing12.margin)} margin`} />
      </div>

      <SectionCard title="Income, expenses and NOI" description="Rent billed (accrual) against operating expenses, last 12 months. CapEx is tracked separately.">
        <FinancialsChart months={fin.months} />
      </SectionCard>

      {cmp12 && cmpYtd && (
        <SectionCard title="Profitability" description="Where the money goes — year to date and trailing 12 months" flush>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium" />
                <th className="px-4 py-2 text-right font-medium">Year to date</th>
                <th className="px-4 py-2 text-right font-medium">Trailing 12 months</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {([
                ["Rent / income (billed)", cmpYtd.revenue, cmp12.revenue, "income"],
                ["Rent collected", cmpYtd.collected, cmp12.collected, "income"],
                ["Operating expenses", cmpYtd.operatingExpenses, cmp12.operatingExpenses, "cost"],
                ["— of which maintenance", cmpYtd.maintenance, cmp12.maintenance, "sub"],
                ["— of which utilities", cmpYtd.utilities, cmp12.utilities, "sub"],
                ["NOI", cmpYtd.noi, cmp12.noi, "total"],
                ["NOI margin", cmpYtd.margin, cmp12.margin, "pct"],
                ["CapEx (excluded from NOI)", cmpYtd.capex, cmp12.capex, "capex"],
                ["Vacancy loss estimate*", cmpYtd.vacancyLoss, cmp12.vacancyLoss, "estimate"],
              ] as [string, number, number, string][]).map(([label, a, b, tone]) => (
                <tr key={label} className={cn("border-t", tone === "total" && "bg-muted/30 font-semibold")}>
                  <td className={cn("px-4 py-1.5", tone === "sub" && "pl-8 text-muted-foreground", (tone === "estimate" || tone === "capex") && "text-muted-foreground")}>{label}</td>
                  <td className="px-4 py-1.5 text-right">{tone === "pct" ? formatPercent(a) : formatMoney(a)}</td>
                  <td className="px-4 py-1.5 text-right">{tone === "pct" ? formatPercent(b) : formatMoney(b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">*Vacancy loss uses the reference rent (last contracted → market → asking) × days vacant today; it is an estimate and not subtracted from NOI.</p>
        </SectionCard>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SectionCard title="Budget vs actual" description="Current month and year lines" flush>
          <div className="p-3">
            <DataTable rows={fin.budgets} columns={budgetColumns} rowKey={(r) => r.budget.id} dense emptyTitle="No budget lines yet" emptyDescription="Budgets are set per building and category on the Finance › Budgets page." defaultSort={{ key: "variance", dir: "desc" }} />
          </div>
        </SectionCard>
        <SectionCard title="Operating spend by category" description="Trailing 12 months">
          {fin.byCategory.length === 0 ? (
            <EmptyState compact title="No expenses recorded" />
          ) : (
            <ul className="space-y-2">
              {fin.byCategory.slice(0, 10).map((c) => (
                <li key={c.category} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span>{labelize(c.category)}</span>
                    <span className="tabular text-muted-foreground">
                      {formatMoney(c.amount)} · {formatPercent(c.share)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-4" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Recent expenses" description="Last three months" flush>
        <div className="p-3">
          <DataTable rows={fin.recentExpenses} columns={expenseColumns} rowKey={(r) => r.expense.id} dense pageSize={25} emptyTitle="No expenses in the last three months" exportName={`expenses-${propertyId}`} />
        </div>
      </SectionCard>
    </div>
  );
}

/* ------------------------------- Maintenance ------------------------------ */

export const workOrderColumns: Column<WorkOrderRow>[] = [
  { key: "number", header: "#", cell: (r) => <span className="font-mono text-xs">{r.workOrder.number}</span>, width: "6rem" },
  { key: "title", header: "Issue", cell: (r) => <span className="font-medium">{r.workOrder.title}</span> },
  { key: "where", header: "Where", cell: (r) => r.unit?.unitNumber ?? r.asset?.name ?? "Building" },
  { key: "category", header: "Category", cell: (r) => labelize(r.workOrder.category) },
  { key: "priority", header: "Priority", cell: (r) => <PriorityBadge priority={r.workOrder.priority} />, value: (r) => ({ emergency: 0, high: 1, normal: 2, low: 3 })[r.workOrder.priority] },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.workOrder.status} /> },
  { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? <span className="text-muted-foreground">Unassigned</span> },
  { key: "age", header: "Age", align: "right", cell: (r) => <span className={cn(r.overdue && "font-medium text-critical")}>{r.ageDays}d</span>, value: (r) => r.ageDays },
  { key: "cost", header: "Cost", align: "right", cell: (r) => (r.cost > 0 ? formatMoney(r.cost) : "—"), value: (r) => r.cost },
];

const planColumns: Column<PlanRow>[] = [
  { key: "type", header: "Service", cell: (r) => <span className="font-medium">{r.plan.maintenanceType}</span> },
  { key: "asset", header: "Asset", cell: (r) => r.asset?.name ?? "Building" },
  { key: "every", header: "Every", cell: (r) => `${r.plan.recurrenceMonths} mo`, value: (r) => r.plan.recurrenceMonths },
  { key: "last", header: "Last done", cell: (r) => formatDate(r.plan.lastServiceDate), value: (r) => r.plan.lastServiceDate },
  { key: "next", header: "Next due", cell: (r) => <span className={cn(r.state === "overdue" && "font-medium text-critical", r.state === "due_soon" && "text-warning-foreground")}>{formatDate(r.plan.nextServiceDate)}</span>, value: (r) => r.plan.nextServiceDate },
  { key: "state", header: "State", cell: (r) => <StatusBadge value={r.state} /> },
  { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—" },
  { key: "cost", header: "Est. cost", align: "right", cell: (r) => (r.plan.estimatedCost ? formatMoney(r.plan.estimatedCost) : "—"), value: (r) => r.plan.estimatedCost },
];

export function BuildingMaintenance({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const { openWorkOrder, createWorkOrder } = useActions();
  const summary = useMemo(() => getMaintenanceSummary(store, propertyId), [store, propertyId]);
  const open = useMemo(() => getWorkOrders(store, { propertyId, status: "open" }), [store, propertyId]);
  const history = useMemo(() => getWorkOrders(store, { propertyId, status: "closed_all" }), [store, propertyId]);
  const plans = useMemo(() => getPreventivePlans(store, { propertyId }), [store, propertyId]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open work orders" value={summary.open} sublabel={summary.emergencies > 0 ? `${summary.emergencies} emergency` : summary.overdue > 0 ? `${summary.overdue} open too long` : "Under control"} tone={summary.emergencies > 0 ? "critical" : summary.overdue > 0 ? "warning" : "success"} />
        <KpiCard label="Awaiting your approval" value={summary.awaitingApproval} sublabel="Quotes to approve" tone={summary.awaitingApproval > 0 ? "warning" : "default"} />
        <KpiCard label="Spend this month" value={formatMoney(summary.spendThisMonth)} sublabel={`${formatMoney(summary.spendLast30)} in the last 30 days`} />
        <KpiCard label="Avg resolution" value={summary.avgResolutionDays === null ? "—" : `${summary.avgResolutionDays}d`} sublabel={`${summary.completedLast30} completed in 30 days${summary.repeatIssues > 0 ? ` · ${summary.repeatIssues} repeat issue${summary.repeatIssues === 1 ? "" : "s"}` : ""}`} tone={summary.repeatIssues > 0 ? "warning" : "default"} />
      </div>

      <SectionCard title="Open work orders" description={`${open.length} open`} action={<Button size="sm" variant="outline" onClick={() => createWorkOrder({ propertyId })}>New work order</Button>} flush>
        <div className="p-3">
          <DataTable rows={open} columns={workOrderColumns} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense emptyTitle="No open work orders" emptyIcon={Wrench} rowClassName={(r) => (r.workOrder.priority === "emergency" ? "bg-critical-muted/30" : undefined)} />
        </div>
      </SectionCard>

      <SectionCard title="Preventive maintenance" description={`${plans.filter((p) => p.state === "overdue").length} overdue · ${plans.filter((p) => p.state === "due_soon").length} due soon`} flush>
        <div className="p-3">
          <DataTable rows={plans} columns={planColumns} rowKey={(r) => r.plan.id} dense emptyTitle="No preventive plans" defaultSort={{ key: "next", dir: "asc" }} rowClassName={(r) => (r.state === "overdue" ? "bg-critical-muted/30" : undefined)} />
        </div>
      </SectionCard>

      <SectionCard title="History" description={`${history.length} completed or closed`} flush>
        <div className="p-3">
          <DataTable rows={history} columns={workOrderColumns} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense pageSize={20} emptyTitle="No maintenance history" searchable={(r) => `${r.workOrder.title} ${r.workOrder.number} ${r.unit?.unitNumber ?? ""} ${r.supplier?.name ?? ""}`} exportName={`maintenance-${propertyId}`} />
        </div>
      </SectionCard>
    </div>
  );
}

/* --------------------------------- Assets --------------------------------- */

const assetColumns: Column<AssetRow>[] = [
  { key: "name", header: "Asset", cell: (r) => <span className="font-medium">{r.asset.name}</span> },
  { key: "type", header: "Type", cell: (r) => labelize(r.asset.assetType) },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.asset.status} dot /> },
  { key: "service", header: "Next service", cell: (r) => (r.asset.nextServiceDate ? <span className={cn(r.serviceState === "overdue" && "font-medium text-critical", r.serviceState === "due_soon" && "text-warning-foreground")}>{formatDate(r.asset.nextServiceDate)}</span> : "—"), value: (r) => r.asset.nextServiceDate },
  { key: "last", header: "Last service", cell: (r) => formatDate(r.asset.lastServiceDate), value: (r) => r.asset.lastServiceDate },
  { key: "warranty", header: "Warranty", cell: (r) => (r.asset.warrantyExpiry ? <span className={cn(r.warrantyDays !== null && r.warrantyDays < 0 && "text-muted-foreground line-through", r.warrantyDays !== null && r.warrantyDays >= 0 && r.warrantyDays <= 60 && "text-warning-foreground")}>{formatDate(r.asset.warrantyExpiry)}</span> : "—"), value: (r) => r.asset.warrantyExpiry },
  { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—" },
  { key: "open", header: "Open WOs", align: "right", cell: (r) => (r.openOrders > 0 ? <span className="font-medium text-warning-foreground">{r.openOrders}</span> : "0"), value: (r) => r.openOrders },
  { key: "spend", header: "Total spend", align: "right", cell: (r) => (r.totalSpend > 0 ? formatMoney(r.totalSpend) : "—"), value: (r) => r.totalSpend },
];

export function BuildingAssets({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const assets = useMemo(() => getAssets(store, { propertyId }), [store, propertyId]);
  const outOfService = assets.filter((a) => a.asset.status === "out_of_service").length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Assets" value={assets.length} sublabel={`${assets.filter((a) => a.asset.status === "operational").length} operational`} />
        <KpiCard label="Out of service" value={outOfService} tone={outOfService > 0 ? "critical" : "success"} sublabel={assets.filter((a) => a.asset.status === "degraded").length > 0 ? `${assets.filter((a) => a.asset.status === "degraded").length} degraded` : "None degraded"} />
        <KpiCard label="Service overdue" value={assets.filter((a) => a.serviceState === "overdue").length} tone={assets.some((a) => a.serviceState === "overdue") ? "critical" : "success"} sublabel={`${assets.filter((a) => a.serviceState === "due_soon").length} due soon`} />
        <KpiCard label="Maintenance spend" value={formatMoney(assets.reduce((n, a) => n + a.totalSpend, 0))} sublabel="All time, across assets" />
      </div>
      <DataTable rows={assets} columns={assetColumns} rowKey={(r) => r.asset.id} emptyTitle="No assets registered" emptyIcon={ClipboardList} exportName={`assets-${propertyId}`} searchable={(r) => `${r.asset.name} ${r.asset.assetType} ${r.asset.manufacturer ?? ""} ${r.asset.serialNumber ?? ""}`} />
    </div>
  );
}

/* -------------------------------- Documents ------------------------------- */

export function BuildingDocuments({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const [preview, setPreview] = useState<StoredDocument | null>(null);
  const docs = useMemo(() => store.documents.filter((d) => !d.deleted && d.propertyId === propertyId && !d.tenantId).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)), [store.documents, propertyId]);
  const tenantDocs = useMemo(() => store.documents.filter((d) => !d.deleted && d.propertyId === propertyId && d.tenantId).length, [store.documents, propertyId]);
  const [category, setCategory] = useState<string>("all");
  const categories = useMemo(() => [...new Set(docs.map((d) => d.category))], [docs]);
  const shown = category === "all" ? docs : docs.filter((d) => d.category === category);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <SectionCard title="Building documents" description={`${docs.length} on file · ${tenantDocs} tenant documents live on the tenant profiles`} flush>
        <div className="px-4 pb-3">
          <Chips value={category} onChange={setCategory} options={[{ value: "all", label: "All", count: docs.length }, ...categories.map((c) => ({ value: c, label: labelize(c), count: docs.filter((d) => d.category === c).length }))]} />
        </div>
        {shown.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState compact icon={FileText} title="No documents yet" description="Insurance policies, certificates, title deeds and invoices belong here." />
          </div>
        ) : (
          <ul className="divide-y border-t">
            {shown.map((d) => (
              <DocumentRow key={d.id} doc={d} onPreview={setPreview} />
            ))}
          </ul>
        )}
      </SectionCard>
      <div className="space-y-4">
        <AttachmentUploader links={{ propertyId }} category="other" label="Add a building document" />
        <p className="text-xs text-muted-foreground">Files stay in this browser session; certificates and policies with an expiry date raise alerts before they lapse.</p>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/* -------------------------------- Timeline -------------------------------- */

const KIND_LABELS: Record<string, string> = { all: "Everything", contract: "Tenancies", payment: "Payments", maintenance: "Maintenance", asset: "Services", inspection: "Inspections", renovation: "Renovations", expense: "Expenses", deposit: "Deposits", document: "Documents", activity: "Activity" };

export function BuildingTimeline({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const events = useMemo(() => getPropertyTimeline(store, propertyId, 200), [store, propertyId]);
  const [kind, setKind] = useState<string>("all");
  const kinds = useMemo(() => ["all", ...new Set(events.map((e) => e.kind))], [events]);
  const shown: TimelineEvent[] = kind === "all" ? events : events.filter((e) => e.kind === kind);

  return (
    <SectionCard title="Timeline" description={`${events.length} events · newest first`} action={<AlertTriangle className="hidden" />}>
      <Chips value={kind} onChange={setKind} className="mb-4" options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] ?? labelize(k), count: k === "all" ? events.length : events.filter((e) => e.kind === k).length }))} />
      <Timeline events={shown} limit={80} />
    </SectionCard>
  );
}
