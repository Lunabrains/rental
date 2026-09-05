"use client";

import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useActions } from "@/components/actions/action-provider";
import { KpiCard } from "@/components/common/kpi-card";
import { ScoreBadge } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { tenantReliability } from "@/lib/derived/metrics";
import { indexStore } from "@/lib/data/store";
import { formatMoney, formatMoneyCompact, formatMonth, formatMonthShort, formatPercent } from "@/lib/format";
import { getPaymentsDashboard, type CollectionPoint } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface TooltipPayload {
  payload?: CollectionPoint;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const m = payload?.[0]?.payload;
  if (!active || !m) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{formatMonth(m.period)}</div>
      <div className="tabular mt-1.5 space-y-1">
        <div className="flex gap-4"><span className="text-muted-foreground">Rent due</span><span className="ml-auto font-medium">{formatMoney(m.billed)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">Collected for month</span><span className="ml-auto font-medium">{formatMoney(m.collected)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">Cash received</span><span className="ml-auto font-medium">{formatMoney(m.cashIn)}</span></div>
        <div className="flex gap-4"><span className="text-muted-foreground">Collection rate</span><span className="ml-auto font-medium">{formatPercent(m.rate)}</span></div>
      </div>
    </div>
  );
}

/** Payments dashboard (plan §Phase 4): where the money is, how it ages, who to call. */
export function PaymentsDashboard({ propertyId }: { propertyId?: string }) {
  const store = useStore();
  const { recordPayment, openTenant, sendReminder } = useActions();
  const d = useMemo(() => getPaymentsDashboard(store, propertyId), [store, propertyId]);
  const idx = indexStore(store);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Expected · ${formatMonth(d.period)}`} value={formatMoney(d.expectedThisMonth)} sublabel={`${formatMoney(d.collectedForMonth)} collected · ${formatPercent(d.collectionRateThisMonth)} of what is due so far`} />
        <KpiCard label="Cash received this month" value={formatMoney(d.cashThisMonth)} sublabel="Any rent period" tone="success" />
        <KpiCard label="Outstanding" value={formatMoney(d.outstanding)} tone={d.outstanding > 0 ? "critical" : "success"} sublabel={`${d.outstandingCount} unpaid · ${d.overdueTenants} tenant${d.overdueTenants === 1 ? "" : "s"}`} />
        <KpiCard label="Partial payments" value={d.partialCount} tone={d.partialCount > 0 ? "warning" : "success"} sublabel={d.partialCount > 0 ? `${formatMoney(d.partialAmount)} still owed on them` : "None open"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <SectionCard title="Collection trend" description="Rent due vs collected for each month, with the collection rate">
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="period" tickFormatter={(p: string) => formatMonthShort(p)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} dy={6} />
                <YAxis yAxisId="money" tickFormatter={(v: number) => formatMoneyCompact(v)} tickLine={false} axisLine={false} width={52} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} tickLine={false} axisLine={false} width={40} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--accent)" }} />
                <Bar yAxisId="money" dataKey="billed" name="Rent due" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                <Bar yAxisId="money" dataKey="collected" name="Collected" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={20} isAnimationActive={false} />
                <Line yAxisId="rate" dataKey="rate" name="Collection rate" type="monotone" stroke="var(--chart-5)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">The current month counts only rent already due; the line is the collection rate on the right axis.</p>
        </SectionCard>

        <SectionCard title="Arrears aging" description={`${formatMoney(d.aging.total)} across ${d.aging.count} payments`}>
          {d.aging.total === 0 ? (
            <EmptyState compact title="No arrears" description="Every past-due payment is settled." />
          ) : (
            <ul className="space-y-3">
              {d.aging.buckets.map((b) => (
                <li key={b.key} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className={cn("font-medium", b.key === "90+" && b.amount > 0 && "text-critical", b.key === "61-90" && b.amount > 0 && "text-warning-foreground")}>{b.label}</span>
                    <span className="tabular text-muted-foreground">
                      {b.amount > 0 ? `${formatMoney(b.amount)} · ${b.count}` : "—"}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", b.key === "0-30" ? "bg-info" : b.key === "31-60" ? "bg-warning" : "bg-critical")} style={{ width: `${d.aging.total > 0 ? (b.amount / d.aging.total) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Due in the next 7 days: <strong>{formatMoney(d.dueNext7.amount)}</strong> across {d.dueNext7.count} payments.
          </p>
        </SectionCard>
      </div>

      <SectionCard title="Tenants requiring attention" description={d.attention.length === 0 ? "Nobody is behind" : `${d.attention.length} tenant${d.attention.length === 1 ? "" : "s"} · ranked by balance`} flush>
        {d.attention.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState compact title="Everyone is paid up" />
          </div>
        ) : (
          <ul className="divide-y">
            {d.attention.slice(0, 12).map((a) => {
              const reliability = tenantReliability(idx.paymentsByTenant.get(a.tenant.id) ?? []);
              return (
                <li key={a.tenant.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <button type="button" className="font-medium hover:underline" onClick={() => openTenant(a.tenant.id)}>
                        {a.tenant.fullName}
                      </button>
                      <ScoreBadge size="sm" score={a.reliabilityScore} label={`Payment reliability · ${reliability.label}`} components={reliability.components} scale={1} caption="Internal indicator from this ledger only." />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.property.name} · {a.unit.unitNumber} · {a.reasons.join(" · ")}
                    </span>
                  </span>
                  <span className={cn("tabular text-right font-semibold", a.outstanding > 0 ? "text-critical" : "text-foreground")}>
                    {a.outstanding > 0 ? formatMoney(a.outstanding) : "—"}
                    {a.maxDaysLate > 0 && <span className="block text-xs font-normal text-muted-foreground">{a.maxDaysLate} days late</span>}
                  </span>
                  <span className="flex gap-1">
                    {a.nextPaymentId && (
                      <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => recordPayment(a.nextPaymentId!)}>
                        Record
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => sendReminder(a.tenant.id)}>
                      Remind
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
