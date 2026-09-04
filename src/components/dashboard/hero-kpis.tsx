import { AlertTriangle, Building2, CircleDollarSign, Percent } from "lucide-react";

import { KpiCard, type KpiTrend } from "@/components/common/kpi-card";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
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

export function HeroKpis({ overview, outstandingThreshold }: { overview: PortfolioOverview; outstandingThreshold: number }) {
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Occupancy"
          value={formatPercent(overview.occupancy.current, 1)}
          trend={pointsTrend(overview.occupancy.delta)}
          icon={Percent}
          href="/properties"
        />
        <KpiCard
          label="Monthly revenue"
          value={formatMoney(overview.monthlyRevenue.current)}
          trend={moneyTrend(overview.monthlyRevenue.delta, true)}
          icon={CircleDollarSign}
          href="/reports"
        />
        <KpiCard
          label="Outstanding"
          value={formatMoney(overview.outstanding.current)}
          trend={moneyTrend(overview.outstanding.delta, false)}
          icon={AlertTriangle}
          tone={overview.outstanding.current > outstandingThreshold ? "critical" : overview.outstanding.current > 0 ? "warning" : "success"}
          href="/payments?status=overdue"
        />
        <KpiCard
          label="Critical alerts"
          value={formatNumber(overview.criticalAlerts.total)}
          sublabel={overview.criticalAlerts.unread > 0 ? `${overview.criticalAlerts.unread} unread` : "All read"}
          icon={Building2}
          tone={overview.criticalAlerts.total > 0 ? "critical" : "success"}
          href="/alerts"
        />
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
      </div>
    </div>
  );
}
