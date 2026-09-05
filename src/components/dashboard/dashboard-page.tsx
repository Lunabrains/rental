"use client";

import { useMemo } from "react";

import { AttentionList } from "@/components/dashboard/attention-list";
import { ATTENTION_ICONS, AttentionStrip, type AttentionTile } from "@/components/dashboard/attention-strip";
import { BuildingComparison } from "@/components/dashboard/building-comparison";
import { FinancialTrend } from "@/components/dashboard/financial-trend";
import { Greeting } from "@/components/dashboard/greeting";
import { HeroKpis } from "@/components/dashboard/hero-kpis";
import { InsightsCard } from "@/components/dashboard/insights-card";
import { Next30Days } from "@/components/dashboard/next-30-days";
import { VacancyCard } from "@/components/dashboard/vacancy-card";
import { useStore } from "@/lib/data/store-context";
import { currentPeriod, daysSince, previousPeriod } from "@/lib/date";
import { getInsights } from "@/lib/derived/insights";
import { generateIntelligence } from "@/lib/derived/intelligence";
import { noiFor } from "@/lib/derived/metrics";
import { formatMoney } from "@/lib/format";
import { computeVacancyOpportunity, getAlerts, getExpiringContracts, getOverduePayments, getPortfolioComparison, getPortfolioOverview, getPortfolioTrends, getPreventivePlans, getSinceLastLogin, getUpcomingPayments, getVacantUnits, getWorkOrders } from "@/lib/queries";

/**
 * Executive dashboard (plan §10): KPI row, attention area, insights, critical
 * alerts, the next 30 days, financial trend, building comparison, vacancies.
 * Every number comes from a query over the current store snapshot.
 */
export function DashboardPage() {
  const store = useStore();
  const t = store.settings.thresholds;

  const overview = useMemo(() => getPortfolioOverview(store), [store]);
  const since = useMemo(() => getSinceLastLogin(store), [store]);
  const thisMonth = useMemo(() => noiFor(store, currentPeriod()), [store]);
  const lastMonth = useMemo(() => noiFor(store, previousPeriod()), [store]);
  const brief = useMemo(() => generateIntelligence(store), [store]);
  const insights = useMemo(() => getInsights(store), [store]);
  const critical = useMemo(() => getAlerts(store, { severity: "critical" }), [store]);
  const expiring = useMemo(() => getExpiringContracts(store, 30), [store]);
  const upcoming = useMemo(() => getUpcomingPayments(store, 30), [store]);
  const trends = useMemo(() => getPortfolioTrends(store, 12), [store]);
  const comparison = useMemo(() => getPortfolioComparison(store, "ytd"), [store]);
  const vacancy = useMemo(() => computeVacancyOpportunity(store), [store]);

  const tiles = useMemo<AttentionTile[]>(() => {
    const overdue = getOverduePayments(store);
    const owed = overdue.reduce((n, p) => n + p.outstanding, 0);
    const open = getWorkOrders(store, { status: "open" });
    const urgent = open.filter((w) => w.workOrder.priority === "emergency" || w.overdue || w.workOrder.status === "awaiting_approval");
    const plans = getPreventivePlans(store).filter((p) => p.state === "overdue" || p.state === "due_soon");
    const vacant = getVacantUnits(store, 0);
    const longest = vacant[0];
    return [
      { key: "overdue", label: "Overdue tenants", count: new Set(overdue.map((p) => p.tenant.id)).size, headline: overdue[0] ? `${overdue[0].tenant.fullName} · ${formatMoney(overdue[0].outstanding)} · ${daysSince(overdue[0].payment.dueDate)}d` : "Everyone is paid up", href: "/payments?status=overdue", icon: ATTENTION_ICONS.overdue, tone: owed > t.outstandingWarning ? "critical" : overdue.length > 0 ? "warning" : "success" },
      { key: "expiring", label: "Expiring contracts", count: expiring.length, headline: expiring[0] ? `${expiring[0].tenant.fullName} · ${expiring[0].daysRemaining}d · ${formatMoney(expiring[0].contract.monthlyRent)}/mo` : "Nothing ends in 30 days", href: "/contracts?expiring=30", icon: ATTENTION_ICONS.expiring, tone: expiring.some((r) => r.daysRemaining <= 7) ? "critical" : expiring.length > 0 ? "warning" : "success" },
      { key: "maintenance", label: "Urgent maintenance", count: urgent.length, headline: urgent[0] ? `${urgent[0].workOrder.number} · ${urgent[0].workOrder.title}` : `${open.length} open, none urgent`, href: "/maintenance?status=open", icon: ATTENTION_ICONS.maintenance, tone: urgent.some((w) => w.workOrder.priority === "emergency") ? "critical" : urgent.length > 0 ? "warning" : "success" },
      { key: "preventive", label: "Services due", count: plans.length, headline: plans[0] ? `${plans[0].plan.maintenanceType} · ${plans[0].state === "overdue" ? `${Math.abs(plans[0].daysUntil)}d overdue` : `in ${plans[0].daysUntil}d`}` : "Nothing due soon", href: "/maintenance/preventive", icon: ATTENTION_ICONS.preventive, tone: plans.some((p) => p.state === "overdue") ? "warning" : "attention" },
      { key: "vacant", label: "Vacant units", count: vacant.length, headline: longest ? `${longest.property.name} ${longest.unit.unitNumber} · ${longest.daysVacant}d · ${formatMoney(longest.askingRent)}` : "Fully let", href: "/finance/rent-roll?occupancy=vacant", icon: ATTENTION_ICONS.vacant, tone: longest && longest.daysVacant >= t.vacantCriticalDays ? "critical" : vacant.length > 0 ? "warning" : "success" },
    ];
  }, [store, expiring, t.outstandingWarning, t.vacantCriticalDays]);

  return (
    <div className="space-y-6">
      <Greeting ownerName={store.settings.ownerName} since={since} />
      <HeroKpis overview={overview} thisMonth={thisMonth} lastMonth={lastMonth} outstandingThreshold={t.outstandingWarning} />
      <AttentionStrip tiles={tiles} />
      <InsightsCard insights={insights} headline={brief.headline} />
      <AttentionList alerts={critical.slice(0, 5)} total={critical.length} />
      <Next30Days expiring={expiring} payments={upcoming} />
      <FinancialTrend data={trends} />
      <BuildingComparison comparison={comparison} lowOccupancyThreshold={t.buildingOccupancyWarning} />
      <VacancyCard opportunity={vacancy} criticalDays={t.vacantCriticalDays} />
    </div>
  );
}
