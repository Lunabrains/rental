import { AlertTriangle, CircleDollarSign, Percent, PiggyBank, TrendingUp, Wallet } from "lucide-react";

import { KpiCard, type KpiTrend } from "@/components/common/kpi-card";
import { formatMoney, formatPercent } from "@/lib/format";
import type { NoiResult } from "@/lib/derived/metrics";
import type { PortfolioOverview } from "@/lib/queries";

function moneyTrend(delta: number, upIsGood: boolean): KpiTrend {
  const direction = Math.abs(delta) < 1 ? "flat" : delta > 0 ? "up" : "down";
  return {
    label: direction === "flat" ? "No change" : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))}`,
    direction,
    good: direction === "flat" ? true : upIsGood ? delta > 0 : delta < 0,
    caption: "vs last month",
  };
}

function pointsTrend(delta: number): KpiTrend {
  const pts = delta * 100;
  const direction = Math.abs(pts) < 0.05 ? "flat" : pts > 0 ? "up" : "down";
  return {
    label: direction === "flat" ? "No change" : `${pts > 0 ? "+" : "−"}${Math.abs(pts).toFixed(1)} pts`,
    direction,
    good: direction === "flat" ? true : pts > 0,
    caption: "vs last month",
  };
}

/** Top KPI row (plan §10): occupancy, expected rent, collected, outstanding, monthly expenses, NOI — this month against last. */
export function HeroKpis({ overview, thisMonth, lastMonth, outstandingThreshold }: { overview: PortfolioOverview; thisMonth: NoiResult; lastMonth: NoiResult; outstandingThreshold: number }) {
  const collectionRate = thisMonth.income > 0 ? Math.min(1, thisMonth.collected / thisMonth.income) : 0;
  const lastRate = lastMonth.income > 0 ? Math.min(1, lastMonth.collected / lastMonth.income) : 0;
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Occupancy" value={formatPercent(overview.occupancy.current, 1)} trend={pointsTrend(overview.occupancy.delta)} icon={Percent} href="/properties" />
        <KpiCard label="Expected rent" value={formatMoney(thisMonth.income)} trend={moneyTrend(thisMonth.income - lastMonth.income, true)} icon={CircleDollarSign} href="/finance/rent-roll" />
        <KpiCard label="Collected" value={formatMoney(thisMonth.collected)} sublabel={`${formatPercent(collectionRate)} of due${lastMonth.income > 0 ? ` · ${formatPercent(lastRate)} last month` : ""}`} icon={PiggyBank} tone={collectionRate >= 0.9 ? "success" : collectionRate >= 0.7 ? "warning" : "critical"} href="/payments" />
        <KpiCard label="Outstanding" value={formatMoney(overview.outstanding.current)} trend={moneyTrend(overview.outstanding.delta, false)} icon={AlertTriangle} tone={overview.outstanding.current > outstandingThreshold ? "critical" : overview.outstanding.current > 0 ? "warning" : "success"} href="/payments?status=overdue" />
        <KpiCard label="Monthly expenses" value={formatMoney(thisMonth.operatingExpenses)} trend={moneyTrend(thisMonth.operatingExpenses - lastMonth.operatingExpenses, false)} icon={Wallet} href="/finance/expenses" />
        <KpiCard label="NOI" value={formatMoney(thisMonth.noi)} trend={moneyTrend(thisMonth.noi - lastMonth.noi, true)} sublabel={thisMonth.capex > 0 ? `${formatMoney(thisMonth.capex)} CapEx kept out` : undefined} icon={TrendingUp} tone={thisMonth.noi < 0 ? "critical" : "default"} href="/analytics/performance" />
      </div>
      <div className="tabular mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>
          <strong className="font-medium text-foreground">{overview.buildings}</strong> buildings
        </span>
        <span>
          <strong className="font-medium text-foreground">{overview.units}</strong> units
        </span>
        <span>
          <strong className="font-medium text-foreground">{overview.occupied}</strong> occupied
        </span>
        <span>
          <strong className="font-medium text-foreground">{overview.available}</strong> available
        </span>
        {overview.maintenance > 0 && (
          <span>
            <strong className="font-medium text-foreground">{overview.maintenance}</strong> maintenance / reserved
          </span>
        )}
        <span>
          <strong className="font-medium text-foreground">{overview.criticalAlerts.total}</strong> critical alert{overview.criticalAlerts.total === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
