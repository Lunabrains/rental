import { today } from "@/lib/date";
import { formatMoney, formatMoneyCompact, formatPercent } from "@/lib/format";
import {
  computeVacancyOpportunity,
  getExpiringContracts,
  getLatePayers,
  getOutstandingBalance,
  getPortfolioOverview,
  getPropertyPerformance,
} from "@/lib/queries";
import type { ISODate, Store } from "@/types";

export interface IntelligenceBrief {
  headline: string;
  paragraphs: string[];
  /** "Today" — up to three concrete moves. */
  actions: string[];
}

/**
 * Portfolio Intelligence: a plain-language brief generated from the same
 * queries the dashboard renders. Nothing here is stored — it changes the
 * moment the data does.
 */
export function generateIntelligence(store: Store, base: ISODate = today()): IntelligenceBrief {
  const t = store.settings.thresholds;
  const o = getPortfolioOverview(store, base);
  const perf = getPropertyPerformance(store, base);
  const ob = getOutstandingBalance(store);
  const exp30 = getExpiringContracts(store, 30, undefined, base);
  const exp60 = getExpiringContracts(store, 60, undefined, base);
  const late = getLatePayers(store, t.repeatLateWindowMonths, t.repeatLateMinCount);
  const vac = computeVacancyOpportunity(store, base);

  const paragraphs: string[] = [];
  const actions: string[] = [];

  /* Occupancy & revenue */
  const occPts = (o.occupancy.delta * 100).toFixed(1);
  const occTrend =
    Math.abs(o.occupancy.delta) < 0.005
      ? "flat vs last month"
      : `${o.occupancy.delta > 0 ? "up" : "down"} ${occPts.replace("-", "")} pts vs last month`;
  const revTrend =
    Math.abs(o.monthlyRevenue.delta) < 50
      ? ""
      : ` (${o.monthlyRevenue.delta > 0 ? "+" : "−"}${formatMoneyCompact(Math.abs(o.monthlyRevenue.delta))} vs last month)`;
  paragraphs.push(
    `Occupancy is ${formatPercent(o.occupancy.current)} across ${o.units} units in ${o.buildings} buildings, ${occTrend}, with a rent roll of ${formatMoneyCompact(o.monthlyRevenue.current)}/month${revTrend}.`,
  );

  /* Money at risk */
  if (ob.total > 0) {
    const top = ob.byProperty[0];
    let s = `${formatMoney(ob.total)} of rent is outstanding across ${ob.count} payments`;
    if (top && top.share >= 0.3) s += `, ${formatPercent(top.share)} of it in ${top.property.name}`;
    s += ".";
    if (late.length > 0) {
      const l = late[0];
      s += ` ${l.tenant.fullName} has paid late ${l.lateCount} of the last ${l.windowMonths} months${l.currentlyOverdue ? " and is overdue again" : ""}.`;
      actions.push(`Call ${l.tenant.fullName} (${l.property.name} ${l.unit.unitNumber}) — ${l.lateCount} late payments in ${l.windowMonths} months.`);
    }
    paragraphs.push(s);
  }

  /* Renewals */
  if (exp60.length > 0) {
    let s = `${exp60.length} contracts end within 60 days (${exp30.length} within 30).`;
    const risky = exp30.find((r) => r.hasOverdue);
    if (risky) {
      const overdueDays = store.payments
        .filter((p) => p.contractId === risky.contract.id && (p.status === "overdue" || p.status === "partial"))
        .reduce((m, p) => Math.max(m, p.daysLate), 0);
      s += ` ${risky.tenant.fullName} is both expiring in ${risky.daysRemaining} days and ${overdueDays} days overdue — settle the balance before renewing.`;
      actions.unshift(
        `Collect ${risky.tenant.fullName}'s ${formatMoney(risky.outstanding)} and decide the ${risky.property.name} ${risky.unit.unitNumber} renewal (${risky.daysRemaining} days left).`,
      );
    }
    // The most valuable reliable tenant is the one to lock in first.
    const reliable = exp60
      .filter((r) => r.reliable && !r.hasOverdue)
      .sort((a, b) => b.contract.monthlyRent - a.contract.monthlyRent)[0];
    if (reliable) {
      s += ` ${reliable.tenant.fullName} (never late) ends in ${reliable.daysRemaining} days — renew early.`;
    }
    paragraphs.push(s);
  }

  /* Buildings */
  const worst = perf.rows[perf.rows.length - 1];
  const best = perf.rows[0];
  if (worst && best && worst.id !== best.id) {
    let s = `${worst.name} is the weakest building at ${formatPercent(worst.occupancy)} occupancy with ${worst.available} vacant units`;
    const longest = vac.longest.find((x) => x.property.id === worst.id) ?? vac.longest[0];
    if (longest && longest.daysVacant > t.vacantWarningDays) {
      s += `; ${longest.property.id === worst.id ? "" : `${longest.property.name} `}${longest.unit.unitNumber} has been empty ${longest.daysVacant} days`;
    }
    s += `. ${best.name} leads at ${formatPercent(best.occupancy)}.`;
    paragraphs.push(s);
    if (worst.occupancy < t.buildingOccupancyWarning) {
      actions.push(`Push leasing at ${worst.name}: ${worst.available} units to fill, ${formatMoneyCompact(worst.available * (worst.monthlyRevenue / Math.max(1, worst.rented)))}/month at stake.`);
    }
    if (longest && longest.daysVacant > t.vacantCriticalDays) {
      actions.push(`List ${longest.property.name} ${longest.unit.unitNumber} — vacant ${longest.daysVacant} days at ${formatMoney(longest.askingRent)}.`);
    }
  }

  /* Vacancy */
  if (vac.vacantUnits > 0) {
    paragraphs.push(
      `${vac.vacantUnits} vacant units are leaving ${formatMoneyCompact(vac.monthlyPotential)}/month on the table — ${formatMoneyCompact(vac.annualPotential)} a year.`,
    );
  }

  const critical = o.criticalAlerts.total;
  const headline =
    critical === 0
      ? "Portfolio steady — nothing critical today"
      : `${critical} critical item${critical === 1 ? "" : "s"} need a decision today`;

  return { headline, paragraphs, actions: actions.slice(0, 3) };
}
