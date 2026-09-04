"use client";

import { useMemo } from "react";

import { AttentionList } from "@/components/dashboard/attention-list";
import { Greeting } from "@/components/dashboard/greeting";
import { HeroKpis } from "@/components/dashboard/hero-kpis";
import { IntelligenceCard } from "@/components/dashboard/intelligence-card";
import { Next30Days } from "@/components/dashboard/next-30-days";
import { PropertyRanking } from "@/components/dashboard/property-ranking";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { VacancyCard } from "@/components/dashboard/vacancy-card";
import { useStore } from "@/lib/data/store-context";
import { generateIntelligence } from "@/lib/derived/intelligence";
import {
  computeVacancyOpportunity,
  getAlerts,
  getExpiringContracts,
  getPortfolioOverview,
  getPropertyPerformance,
  getRevenueHistory,
  getSinceLastLogin,
  getUpcomingPayments,
} from "@/lib/queries";

/**
 * Executive dashboard — §5.1, in order. Every number on screen comes from a
 * query over the current store snapshot, so it changes the moment a command
 * runs anywhere in the app.
 */
export function DashboardPage() {
  const store = useStore();

  const overview = useMemo(() => getPortfolioOverview(store), [store]);
  const since = useMemo(() => getSinceLastLogin(store), [store]);
  const brief = useMemo(() => generateIntelligence(store), [store]);
  const critical = useMemo(() => getAlerts(store, { severity: "critical" }), [store]);
  const expiring = useMemo(() => getExpiringContracts(store, 30), [store]);
  const upcoming = useMemo(() => getUpcomingPayments(store, 30), [store]);
  const revenue = useMemo(() => getRevenueHistory(store, 12), [store]);
  const performance = useMemo(() => getPropertyPerformance(store), [store]);
  const vacancy = useMemo(() => computeVacancyOpportunity(store), [store]);

  const t = store.settings.thresholds;

  return (
    <div className="space-y-6">
      <Greeting ownerName={store.settings.ownerName} since={since} />
      <IntelligenceCard brief={brief} />
      <HeroKpis overview={overview} outstandingThreshold={t.outstandingWarning} />
      <AttentionList alerts={critical.slice(0, 5)} total={critical.length} />
      <Next30Days expiring={expiring} payments={upcoming} />
      <RevenueChart data={revenue} />
      <PropertyRanking performance={performance} lowOccupancyThreshold={t.buildingOccupancyWarning} />
      <VacancyCard opportunity={vacancy} criticalDays={t.vacantCriticalDays} />
    </div>
  );
}
