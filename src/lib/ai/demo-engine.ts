import { indexStore } from "@/lib/data/store";
import { addDaysISO, toISO, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/recompute";
import { formatDate, formatMoney, formatMoneyCompact, formatMonth, formatPercent } from "@/lib/format";
import {
  computeVacancyOpportunity,
  getActivity,
  getAlerts,
  getContracts,
  getExpiringContracts,
  getOutstandingBalance,
  getOverduePayments,
  getPortfolioOverview,
  getPropertyPerformance,
  getRevenueHistory,
  getTenantDetails,
  getUpcomingPayments,
  getVacantUnits,
} from "@/lib/queries";
import type { AlertCategory, AlertSeverity, Property, Store, Tenant } from "@/types";

import { BUILDING_WORDS, findProperty, normalizeQuestion } from "./entities";
import { answerScripted, matchScripted, SUGGESTED_QUESTIONS } from "./scripted";
import type { AnswerAction, AssistantAnswer, PageContext } from "./types";

/**
 * The demo brain: a rule-based intent router over the query layer. It
 * understands the shapes of questions an owner asks about a portfolio —
 * buildings, units, tenants, money, contracts, vacancies, alerts, what
 * changed — and answers with the same numbers the screens show. No model,
 * no network, instant. Anything it cannot place returns null so the caller
 * can try the model or say so honestly.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "is", "are", "was", "were", "be", "how", "what", "who", "which",
  "when", "where", "why", "do", "does", "did", "me", "my", "our", "we", "i", "you", "about", "tell", "show", "give", "please", "can",
  "could", "would", "should", "with", "from", "this", "that", "these", "those", "any", "all", "some", "there", "it", "its", "his", "her",
  "their", "has", "have", "had", "much", "many", "still", "again", "now", "today", "list", "get", "find", "need", "want", "know", "like",
  "unit", "units", "apartment", "flat", "building", "buildings", "tenant", "tenants", "rent", "rents", "renting", "rented", "contract",
  "contracts", "lease", "leases", "payment", "payments", "paid", "pay", "pays", "up", "out", "over", "into", "so", "just", "also", "lives",
  "live", "living", "history", "status", "details", "info", "information", "profile", "record", "records",
]);

const act = (kind: AnswerAction["kind"], label: string, targetId: string): AnswerAction => ({ kind, label, targetId });

/* -------------------------------- Entities -------------------------------- */

interface Entities {
  property: Property | null;
  /** Explicitly named in the question (vs. inherited from the page). */
  propertyNamed: boolean;
  unitNumber: string | null;
  tenant: Tenant | null;
  tenantCandidates: Tenant[];
  days: number | null;
  /** Ready to drop into a sentence: "this week", "in the next 7 days". */
  windowLabel: string | null;
}

function findTenants(store: Store, q: string): Tenant[] {
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length === 0) return [];
  const scored: { t: Tenant; score: number }[] = [];
  for (const t of store.tenants) {
    const full = normalizeQuestion(t.fullName);
    const first = normalizeQuestion(t.firstName);
    const lastParts = normalizeQuestion(t.lastName).split(" ");
    let score = 0;
    if (q.includes(full)) score = 3;
    else {
      const hasFirst = words.includes(first);
      const hasLast = lastParts.every((part) => part.length >= 3 && words.includes(part));
      if (hasFirst && hasLast) score = 3;
      else if (hasLast && lastParts.join("").length >= 4) score = 2;
      else if (hasFirst && first.length >= 4) score = 1;
    }
    if (score > 0) scored.push({ t, score });
  }
  if (scored.length === 0) return [];
  const top = Math.max(...scored.map((s) => s.score));
  const idx = indexStore(store);
  const current = (t: Tenant) => (idx.contractsByTenant.get(t.id) ?? []).some(isOccupying);
  // A first-name-only hit is too weak to act on unless it is unique.
  const kept = scored.filter((s) => s.score === top);
  if (top === 1 && kept.length > 1) return kept.map((s) => s.t);
  return kept.sort((a, b) => Number(current(b.t)) - Number(current(a.t)) || a.t.fullName.localeCompare(b.t.fullName)).map((s) => s.t);
}

function findDays(q: string): { days: number | null; label: string | null } {
  const m = /(?:next|within|in|coming|following|upcoming|last|past)?\s*(\d+)\s*(day|week|month)s?/.exec(q);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const days = unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
    return { days, label: `in the next ${n} ${unit}${n === 1 ? "" : "s"}` };
  }
  if (/\b(this|the) week\b/.test(q)) return { days: 7, label: "this week" };
  if (/\bnext week\b/.test(q)) return { days: 14, label: "in the next two weeks" };
  if (/\b(two weeks|fortnight)\b/.test(q)) return { days: 14, label: "in the next two weeks" };
  if (/\bthis month\b/.test(q)) return { days: 30, label: "this month" };
  if (/\bnext month\b/.test(q)) return { days: 60, label: "in the next two months" };
  if (/\b(quarter|three months)\b/.test(q)) return { days: 90, label: "in the next quarter" };
  if (/\btomorrow\b/.test(q)) return { days: 1, label: "by tomorrow" };
  return { days: null, label: null };
}

function extract(store: Store, q: string, context: PageContext): Entities {
  const idx = indexStore(store);
  const named = findProperty(store, q);
  const property = named ?? (context.propertyId ? idx.propertyById.get(context.propertyId) ?? null : null);
  const unitMatch = /\b([a-z]?\d{3,4})\b/.exec(q);
  const candidates = findTenants(store, q);
  const { days, label } = findDays(q);
  return {
    property,
    propertyNamed: named !== null,
    unitNumber: unitMatch ? unitMatch[1] : null,
    tenant: candidates.length === 1 ? candidates[0] : null,
    tenantCandidates: candidates,
    days,
    windowLabel: label,
  };
}

/* --------------------------------- Answers -------------------------------- */

function overviewAnswer(store: Store): AssistantAnswer {
  const o = getPortfolioOverview(store);
  const perf = getPropertyPerformance(store);
  const best = perf.rows[0];
  const worst = perf.rows[perf.rows.length - 1];
  const occDelta = (o.occupancy.delta * 100).toFixed(1);
  return {
    source: "local",
    text: `${o.buildings} buildings, ${o.units} units, ${formatPercent(o.occupancy.current)} occupied (${Number(occDelta) >= 0 ? "+" : ""}${occDelta} pts vs last month). Rent roll ${formatMoney(o.monthlyRevenue.current)}/month, ${formatMoney(o.outstanding.current)} outstanding across ${o.overdueCount} payment${o.overdueCount === 1 ? "" : "s"}, ${o.criticalAlerts.total} critical alert${o.criticalAlerts.total === 1 ? "" : "s"}.`,
    cards: [
      {
        title: "Portfolio",
        subtitle: `as of ${formatDate(o.asOf)}`,
        fields: [
          ["Occupancy", `${formatPercent(o.occupancy.current, 1)} · ${o.occupied} of ${o.units} units`],
          ["Available", `${o.available} units`],
          ["Monthly revenue", `${formatMoney(o.monthlyRevenue.current)} (${o.monthlyRevenue.delta >= 0 ? "+" : "−"}${formatMoney(Math.abs(o.monthlyRevenue.delta))} vs last month)`],
          ["Outstanding", `${formatMoney(o.outstanding.current)} · ${o.overdueCount} payments`],
          ["Contracts ending", `${o.expiring30} within 30 days · ${o.expiring60} within 60`],
          ["Critical alerts", String(o.criticalAlerts.total)],
        ],
      },
    ],
    recommendation: worst && best && worst.id !== best.id ? `${best.name} leads at ${formatPercent(best.occupancy)}; ${worst.name} trails at ${formatPercent(worst.occupancy)} — that is where the upside is.` : undefined,
    actions: worst ? [act("view_property", `Open ${worst.name}`, worst.id)] : [],
    suggestions: ["Which building needs attention?", "Who hasn't paid this month?", "Which units are vacant?"],
  };
}

function buildingAnswer(store: Store, p: Property): AssistantAnswer {
  const s = getPropertyPerformance(store).rows.find((r) => r.id === p.id);
  if (!s) return { source: "local", text: `I don't have numbers for ${p.name}.` };
  const t = store.settings.thresholds;
  const vacant = getVacantUnits(store, 0, p.id);
  const overdue = getOverduePayments(store, p.id);
  const expiring = getExpiringContracts(store, 60, p.id);
  const alerts = getAlerts(store, { propertyId: p.id, severity: "critical" });
  const longest = vacant[0];
  return {
    source: "local",
    text: `${p.name}: ${formatPercent(s.occupancy)} occupied (${s.rented} of ${s.units}), ${formatMoney(s.monthlyRevenue)}/month rent roll, ${s.outstanding > 0 ? `${formatMoney(s.outstanding)} outstanding across ${overdue.length} payment${overdue.length === 1 ? "" : "s"}` : "nothing outstanding"}, ${expiring.length} contract${expiring.length === 1 ? "" : "s"} ending within 60 days. Score ${s.score}.`,
    cards: [
      {
        title: p.name,
        subtitle: `${p.address}, ${p.district} · ${p.floors} floors × ${p.unitsPerFloor}`,
        fields: [
          ["Occupancy", `${formatPercent(s.occupancy)} · ${s.rented}/${s.units}${s.occupancy < t.buildingOccupancyWarning ? " · below target" : ""}`],
          ["Vacant", vacant.length > 0 ? `${vacant.length} · longest ${longest.unit.unitNumber} (${longest.daysVacant} days)` : "none"],
          ["Revenue / month", formatMoney(s.monthlyRevenue)],
          ["Outstanding", s.outstanding > 0 ? `${formatMoney(s.outstanding)} (${formatPercent(s.outstandingShare)} of portfolio)` : "—"],
          ["Ending ≤ 60 days", expiring.length > 0 ? expiring.slice(0, 3).map((r) => `${r.tenant.fullName.split(" ")[0]} (${r.daysRemaining}d)`).join(", ") + (expiring.length > 3 ? ` +${expiring.length - 3}` : "") : "none"],
          ["Critical alerts", alerts.length > 0 ? alerts.slice(0, 2).map((a) => a.title).join("; ") + (alerts.length > 2 ? ` +${alerts.length - 2}` : "") : "none"],
        ],
      },
    ],
    recommendation:
      overdue.length > 0
        ? `Chase ${overdue[0].tenant.fullName} first (${formatMoney(overdue[0].outstanding)}, ${overdue[0].payment.daysLate} days).`
        : vacant.length > 0
          ? `Fill ${longest.unit.unitNumber} — ${longest.daysVacant} days empty at ${formatMoney(longest.askingRent)}.`
          : undefined,
    actions: [act("view_property", `Open ${p.name}`, p.id), ...(overdue[0] ? [act("record_payment", `Record ${overdue[0].tenant.fullName.split(" ")[0]}'s payment`, overdue[0].payment.id)] : [])],
    suggestions: [`Who hasn't paid in ${p.name}?`, `Which units are vacant in ${p.name}?`, `Which contracts expire in ${p.name}?`],
  };
}

function unknownBuildingAnswer(store: Store): AssistantAnswer {
  return {
    source: "local",
    text: `I don't know a building by that name. The portfolio has ${store.properties.map((p) => p.name).join(", ")}.`,
    actions: store.properties.slice(0, 3).map((p) => act("view_property", p.name, p.id)),
    suggestions: ["Rank the buildings", "Which building needs attention?"],
  };
}

function rankingAnswer(store: Store): AssistantAnswer {
  const perf = getPropertyPerformance(store);
  const first = perf.rows[0];
  const last = perf.rows[perf.rows.length - 1];
  return {
    source: "local",
    text: first && last ? `${perf.rows.length} buildings ranked by occupancy. ${first.name} leads at ${formatPercent(first.occupancy)} (score ${first.score}); ${last.name} is last at ${formatPercent(last.occupancy)}.` : "No buildings loaded yet.",
    table: {
      columns: ["Building", "Occupancy", "Units", "Revenue / mo", "Outstanding", "Score"],
      rows: [
        ...perf.rows.map((r) => [r.name, formatPercent(r.occupancy), `${r.rented}/${r.units}`, formatMoney(r.monthlyRevenue), r.outstanding > 0 ? formatMoney(r.outstanding) : "—", r.score]),
        ["Portfolio", formatPercent(perf.total.occupancy), `${perf.total.rented}/${perf.total.units}`, formatMoney(perf.total.monthlyRevenue), formatMoney(perf.total.outstanding), perf.total.score],
      ],
    },
    actions: [...(first ? [act("view_property", `Open ${first.name}`, first.id)] : []), ...(last && last.id !== first?.id ? [act("view_property", `Open ${last.name}`, last.id)] : [])],
    suggestions: ["Which building needs attention?", "How is the portfolio doing?"],
  };
}

function tenantAnswer(store: Store, tenant: Tenant): AssistantAnswer {
  const d = getTenantDetails(store, tenant.id);
  if (!d) return { source: "local", text: `I couldn't load ${tenant.fullName}.` };
  const overdue = d.payments.filter((p) => p.status === "overdue" || p.status === "partial");
  const cur = d.current;
  const reliable = d.totals.lateCount === 0 && d.payments.filter((p) => p.status === "paid").length >= 12;
  const text = cur
    ? `${tenant.fullName} rents ${cur.property.name} ${cur.unit.unitNumber} for ${formatMoney(cur.contract.monthlyRent)}/month; contract ${cur.contract.contractNumber} ends ${formatDate(cur.contract.endDate)} (${cur.daysRemaining} days). ${overdue.length > 0 ? `${formatMoney(d.totals.outstanding)} is overdue (${overdue[0].daysLate} days).` : reliable ? "Never late — a reliable tenant." : `${d.totals.lateCount} late payment${d.totals.lateCount === 1 ? "" : "s"} on record.`}`
    : `${tenant.fullName} is a former tenant${d.contracts[0] ? ` — last in ${d.contracts[0].property.name} ${d.contracts[0].unit.unitNumber} until ${formatDate(d.contracts[0].contract.moveOutDate ?? d.contracts[0].contract.endDate)}` : ""}.`;
  return {
    source: "local",
    text,
    cards: [
      {
        title: tenant.fullName,
        subtitle: `${tenant.occupation ?? "Tenant"} · ${tenant.nationality} · ${tenant.phone}`,
        fields: [
          ["Unit", cur ? `${cur.property.name} · ${cur.unit.unitNumber} · ${cur.unit.bedrooms} BR` : "—"],
          ["Rent", cur ? `${formatMoney(cur.contract.monthlyRent)}/month · due the ${cur.contract.paymentDay}th` : "—"],
          ["Contract", cur ? `${formatDate(cur.contract.startDate)} → ${formatDate(cur.contract.endDate)} (${cur.daysRemaining} days left)` : "—"],
          ["Payments", `${formatMoney(d.totals.paid)} paid · ${d.totals.lateCount} late · ${formatPercent(d.totals.onTimeRate)} on time`],
          ["Outstanding", d.totals.outstanding > 0 ? formatMoney(d.totals.outstanding) : "None"],
          ["Documents", d.documents.length > 0 ? d.documents.map((x) => x.title).join(", ") : "None on file"],
          ["With us", `${d.tenureMonths} months · ${d.contracts.length} contract${d.contracts.length === 1 ? "" : "s"}`],
        ],
      },
    ],
    recommendation: cur && overdue.length > 0 && cur.daysRemaining <= 30 ? `Collect the overdue rent before deciding the renewal (${cur.daysRemaining} days left).` : cur && cur.daysRemaining <= 30 ? `Renewal is due in ${cur.daysRemaining} days${reliable ? " — renew early, never late" : ""}.` : undefined,
    actions: [
      ...(overdue[0] ? [act("record_payment", "Record payment", overdue[0].id)] : []),
      ...(cur && cur.daysRemaining <= 90 ? [act("renew_contract", "Renew contract", cur.contract.id)] : []),
      act("view_tenant", "Open profile", tenant.id),
    ],
    suggestions: cur ? [`Who else is in ${cur.property.name}?`, "Which tenants regularly pay late?"] : ["Who hasn't paid this month?"],
  };
}

function disambiguate(tenants: Tenant[], store: Store): AssistantAnswer {
  const idx = indexStore(store);
  return {
    source: "local",
    text: `I found ${tenants.length} tenants with that name — which one?`,
    table: {
      columns: ["Tenant", "Building · Unit", "Phone"],
      rows: tenants.slice(0, 8).map((t) => {
        const c = (idx.contractsByTenant.get(t.id) ?? []).find(isOccupying);
        const u = c ? idx.unitById.get(c.unitId) : undefined;
        const p = u ? idx.propertyById.get(u.propertyId) : undefined;
        return [t.fullName, u && p ? `${p.name} · ${u.unitNumber}` : "former tenant", t.phone];
      }),
    },
    actions: tenants.slice(0, 3).map((t) => act("view_tenant", t.fullName, t.id)),
  };
}

function vacancyAnswer(store: Store, property: Property | null, minDays: number): AssistantAnswer {
  const rows = getVacantUnits(store, minDays, property?.id);
  const opp = computeVacancyOpportunity(store);
  const potential = rows.reduce((n, r) => n + r.askingRent, 0);
  return {
    source: "local",
    text:
      rows.length === 0
        ? `No vacant units${property ? ` in ${property.name}` : ""}${minDays > 0 ? ` empty for more than ${minDays} days` : ""}.`
        : `${rows.length} vacant unit${rows.length === 1 ? "" : "s"}${property ? ` in ${property.name}` : " across the portfolio"}${minDays > 0 ? ` empty for more than ${minDays} days` : ""}, worth ${formatMoney(potential)}/month at asking rents. Longest first:`,
    table:
      rows.length > 0
        ? {
            columns: ["Building · Unit", "Days vacant", "Asking", "Previous tenant", "Rent missed"],
            rows: rows.slice(0, 12).map((r) => [`${r.property.name} · ${r.unit.unitNumber}`, r.daysVacant, formatMoney(r.askingRent), r.previousTenant?.fullName ?? "—", formatMoney(r.lostRevenue)]),
          }
        : undefined,
    recommendation: rows[0] && rows[0].daysVacant > store.settings.thresholds.vacantWarningDays ? `List ${rows[0].property.name} ${rows[0].unit.unitNumber} first — ${rows[0].daysVacant} days empty is ${formatMoney(rows[0].lostRevenue)} of rent gone.` : !property && opp.worstProperty ? `${opp.worstProperty.property.name} has the most vacancies (${opp.worstProperty.vacant}).` : undefined,
    actions: rows.slice(0, 2).map((r) => act("view_unit", `View ${r.unit.unitNumber}`, r.unit.id)),
    suggestions: ["Which building needs attention?", "How is the portfolio doing?"],
  };
}

function revenueAnswer(store: Store, scope: Property | null): AssistantAnswer {
  const hist = getRevenueHistory(store, 12, today(), scope?.id);
  const past = hist.slice(0, -1);
  const last = past[past.length - 1];
  const prev = past[past.length - 2];
  let dip: { period: string; drop: number } | null = null;
  for (let i = 1; i < past.length; i++) {
    const before = past[i - 1];
    const p = past[i];
    const drop = before.collected > 0 ? (before.collected - p.collected) / before.collected : 0;
    if (drop > 0.03 && (!dip || drop > dip.drop)) dip = { period: p.period, drop };
  }
  const o = getPortfolioOverview(store);
  return {
    source: "local",
    text: `${scope ? `${scope.name} collected` : "Collected"} ${formatMoney(last?.collected ?? 0)} in ${last ? formatMonth(last.period) : "the last month"} against ${formatMoney(last?.billed ?? 0)} billed${prev && last ? ` (${last.collected >= prev.collected ? "up" : "down"} ${formatMoneyCompact(Math.abs(last.collected - prev.collected))} vs ${formatMonth(prev.period)})` : ""}.${scope ? "" : ` The rent roll today is ${formatMoney(o.monthlyRevenue.current)}/month.`}${dip ? ` The dip in ${formatMonth(dip.period)} (−${formatPercent(dip.drop)}) came from rent paid late that month, which landed the month after.` : ""}`,
    table: {
      columns: ["Month", "Billed", "Collected", "Occupancy"],
      rows: hist.slice(-7).map((p) => [formatMonth(p.period), formatMoney(p.billed), formatMoney(p.collected), formatPercent(p.occupancy)]),
    },
    suggestions: ["Who hasn't paid this month?", "Which units are vacant?"],
  };
}

function upcomingAnswer(store: Store, property: Property | null, days: number, label: string): AssistantAnswer {
  const rows = getUpcomingPayments(store, days, property?.id);
  const total = rows.reduce((n, r) => n + r.payment.amountDue, 0);
  return {
    source: "local",
    text: rows.length === 0 ? `Nothing falls due ${label}${property ? ` in ${property.name}` : ""}.` : `${rows.length} payment${rows.length === 1 ? "" : "s"} worth ${formatMoney(total)} fall due ${label}${property ? ` in ${property.name}` : ""}.`,
    table:
      rows.length > 0
        ? { columns: ["Due", "Tenant", "Building · Unit", "Amount"], rows: rows.slice(0, 12).map((r) => [formatDate(r.payment.dueDate), r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, formatMoney(r.payment.amountDue)]) }
        : undefined,
    actions: rows.slice(0, 2).map((r) => act("record_payment", `Record ${r.tenant.fullName.split(" ")[0]}'s rent`, r.payment.id)),
    suggestions: ["Who hasn't paid this month?", "Which tenants regularly pay late?"],
  };
}

function outstandingAnswer(store: Store, property: Property | null): AssistantAnswer {
  const ob = getOutstandingBalance(store);
  if (property) {
    const row = ob.byProperty.find((b) => b.property.id === property.id);
    const overdue = getOverduePayments(store, property.id);
    return {
      source: "local",
      text: !row ? `Nothing is outstanding in ${property.name}.` : `${formatMoney(row.amount)} is outstanding in ${property.name} across ${row.count} payment${row.count === 1 ? "" : "s"} — ${formatPercent(row.share)} of the portfolio total of ${formatMoney(ob.total)}.`,
      table: overdue.length > 0 ? { columns: ["Tenant", "Unit", "Period", "Outstanding", "Days overdue"], rows: overdue.map((r) => [r.tenant.fullName, r.unit.unitNumber, formatMonth(r.payment.periodMonth), formatMoney(r.outstanding), r.payment.daysLate]) } : undefined,
      actions: overdue.slice(0, 2).map((r) => act("record_payment", `Record ${r.tenant.fullName.split(" ")[0]}'s payment`, r.payment.id)),
    };
  }
  return {
    source: "local",
    text: ob.total === 0 ? "Nothing is outstanding — every past-due rent is settled." : `${formatMoney(ob.total)} is outstanding across ${ob.count} payment${ob.count === 1 ? "" : "s"}. ${ob.byProperty[0] ? `${ob.byProperty[0].property.name} holds ${formatPercent(ob.byProperty[0].share)} of it.` : ""}`,
    table: ob.byProperty.length > 0 ? { columns: ["Building", "Outstanding", "Payments", "Share"], rows: ob.byProperty.map((b) => [b.property.name, formatMoney(b.amount), b.count, formatPercent(b.share)]) } : undefined,
    actions: ob.byProperty.slice(0, 1).map((b) => act("view_property", `Open ${b.property.name}`, b.property.id)),
    suggestions: ["Who hasn't paid this month?", "Which tenants regularly pay late?"],
  };
}

function depositsAnswer(store: Store, property: Property | null): AssistantAnswer {
  const rows = getContracts(store).filter((r) => isOccupying(r.contract) && (!property || r.contract.propertyId === property.id));
  const total = rows.reduce((n, r) => n + r.contract.deposit, 0);
  const byBuilding = new Map<string, number>();
  for (const r of rows) byBuilding.set(r.property.name, (byBuilding.get(r.property.name) ?? 0) + r.contract.deposit);
  return {
    source: "local",
    text: `${formatMoney(total)} in deposits is held across ${rows.length} active contract${rows.length === 1 ? "" : "s"}${property ? ` in ${property.name}` : ""}.`,
    table: !property ? { columns: ["Building", "Deposits held"], rows: [...byBuilding.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => [n, formatMoney(v)]) } : undefined,
  };
}

function reliableAnswer(store: Store, property: Property | null): AssistantAnswer {
  const rows = getExpiringContracts(store, 90, property?.id).filter((r) => r.reliable && !r.hasOverdue);
  return {
    source: "local",
    text:
      rows.length === 0
        ? `No never-late tenant has a contract ending within 90 days${property ? ` in ${property.name}` : ""}.`
        : `${rows.length} reliable tenant${rows.length === 1 ? "" : "s"} (a full year, never late) ${rows.length === 1 ? "has" : "have"} contracts ending within 90 days — lock ${rows.length === 1 ? "them" : "these"} in early.`,
    table: rows.length > 0 ? { columns: ["Tenant", "Building · Unit", "Ends", "Days", "Rent"], rows: rows.map((r) => [r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, formatDate(r.contract.endDate), r.daysRemaining, formatMoney(r.contract.monthlyRent)]) } : undefined,
    actions: rows.slice(0, 2).map((r) => act("renew_contract", `Renew ${r.tenant.fullName.split(" ")[0]}`, r.contract.id)),
    suggestions: ["Which contracts expire in the next 30 days?", "Which tenants regularly pay late?"],
  };
}

function alertsAnswer(store: Store, property: Property | null, severity: AlertSeverity | undefined, category: AlertCategory | undefined, label: string): AssistantAnswer {
  const rows = getAlerts(store, { severity, category, propertyId: property?.id });
  return {
    source: "local",
    text: rows.length === 0 ? `No ${label}${property ? ` in ${property.name}` : ""}.` : `${rows.length} ${label}${property ? ` in ${property.name}` : ""}. Most important first:`,
    table: rows.length > 0 ? { columns: ["Severity", "Alert", "Detail"], rows: rows.slice(0, 12).map((a) => [a.severity, a.title, a.message]) } : undefined,
    actions: rows
      .slice(0, 3)
      .map((a) => a.actions[0])
      .filter((a): a is NonNullable<typeof a> => Boolean(a) && a.kind !== "upload_document")
      .map((a) => act(a.kind as AnswerAction["kind"], a.label, a.targetId)),
    suggestions: ["What needs my attention today?"],
  };
}

function activityAnswer(store: Store, sinceDays: number | null): AssistantAnswer {
  const all = getActivity(store, undefined, undefined, 200);
  const cutoff = sinceDays !== null ? addDaysISO(today(), -sinceDays) : null;
  const localDate = (iso: string) => toISO(new Date(iso));
  const rows = cutoff ? all.filter((a) => localDate(a.at) >= cutoff) : all;
  const paidSince = cutoff ?? addDaysISO(today(), -2);
  const paid = store.payments.filter((p) => p.paidDate && p.paidDate >= paidSince);
  const recent = rows.slice(0, 10);
  const when = cutoff ? (sinceDays === 0 ? "today" : `since ${formatDate(cutoff)}`) : "recently";
  return {
    source: "local",
    text:
      recent.length === 0
        ? `Nothing was changed ${when}. ${paid.length} payment${paid.length === 1 ? "" : "s"} came in (${formatMoney(paid.reduce((n, p) => n + p.amountPaid, 0))}).`
        : `${rows.length} thing${rows.length === 1 ? "" : "s"} happened ${when}, newest first. ${paid.length} payment${paid.length === 1 ? "" : "s"} came in (${formatMoney(paid.reduce((n, p) => n + p.amountPaid, 0))}).`,
    table: recent.length > 0 ? { columns: ["When", "What", "By"], rows: recent.map((a) => [formatDate(localDate(a.at)), a.message, a.actor]) } : undefined,
    suggestions: ["What needs my attention today?", "Who hasn't paid this month?"],
  };
}

function helpAnswer(): AssistantAnswer {
  return {
    source: "local",
    text: "Ask me about anything in the portfolio — I read the same data as the screens.",
    cards: [
      {
        title: "Things I can answer",
        fields: [
          ["Money", "who hasn't paid, what's outstanding, what's due this week, deposits held, revenue trend"],
          ["Contracts", "what expires in 30/60/90 days, who to renew early, repeat late payers"],
          ["Buildings", "how is Marina doing, rank the buildings, which building needs attention"],
          ["Units & tenants", "who rents 403 in Beirut Heights, tell me about Karim Daher, which units are vacant"],
          ["Alerts & activity", "what needs attention, any document issues, what changed today"],
        ],
      },
    ],
    suggestions: SUGGESTED_QUESTIONS.map((q) => q.text),
  };
}

/* --------------------------------- Router --------------------------------- */

export function answerLocally(question: string, store: Store, context: PageContext): AssistantAnswer | null {
  const q = normalizeQuestion(question);
  if (!q) return null;

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|salut|marhaba)\b/.test(q)) {
    const o = getPortfolioOverview(store);
    return {
      source: "local",
      text: `Hello ${store.settings.ownerName}. ${o.criticalAlerts.total} critical item${o.criticalAlerts.total === 1 ? "" : "s"} today, ${formatMoney(o.outstanding.current)} outstanding, ${formatPercent(o.occupancy.current)} occupied. What would you like to look at?`,
      suggestions: SUGGESTED_QUESTIONS.slice(0, 3).map((s) => s.text),
    };
  }
  if (/^(thanks|thank you|ok|okay|great|perfect|cool|nice|good job|well done)\b/.test(q) && q.split(" ").length <= 4) {
    return { source: "local", text: "Anytime. Tell me what to look at next.", suggestions: SUGGESTED_QUESTIONS.slice(3).map((s) => s.text) };
  }
  if (/what can you (do|answer|help)|^help\b|how do i use|what do you know|what are you/.test(q)) return helpAnswer();

  const e = extract(store, q, context);
  const scoped: PageContext = e.propertyNamed && e.property ? { ...context, propertyId: e.property.id, propertyName: e.property.name } : context;
  const idx = indexStore(store);

  // Intents the six-question matcher would otherwise swallow.
  if (/\b(rank|compare|comparison|leaderboard|all buildings|each building|every building|by building|per building)\b/.test(q) || /\b(best|top|highest|strongest|most (occupied|profitable))\b/.test(q)) {
    return rankingAnswer(store);
  }
  if (/\b(renew early|reliable|never late|good tenants|best tenants|who (should|to) (i )?renew)\b/.test(q)) return reliableAnswer(store, e.property);
  if (/\b(how much|total|balance|arrears|owed|sum)\b/.test(q) && /\b(outstanding|owed|unpaid|overdue|arrears|due to us|behind)\b/.test(q) && !/\bwho\b/.test(q)) {
    return outstandingAnswer(store, e.propertyNamed ? e.property : null);
  }

  // The six rehearsed questions — exact, instant — scoped to a named building.
  const scripted = matchScripted(question);
  if (scripted === "expiring") return answerScripted("expiring", `contracts in the next ${e.days ?? 30} days ${question}`, store, scoped);
  if (scripted === "who_rents") return answerScripted("who_rents", question, store, scoped);
  if (scripted) return answerScripted(scripted, question, store, scoped);

  // People and places named explicitly win over topic keywords.
  if (e.tenantCandidates.length > 1 && !e.unitNumber) return disambiguate(e.tenantCandidates, store);
  if (e.tenant && !/\b(late|overdue|expir\w*)\b/.test(q)) return tenantAnswer(store, e.tenant);
  if (e.unitNumber && !(e.days && /\d+\s*(day|week|month)/.test(q))) return answerScripted("who_rents", question, store, scoped);

  // Money
  if (/\bdeposits?\b/.test(q)) return depositsAnswer(store, e.propertyNamed ? e.property : null);
  if (/\b(revenue|income|collect\w*|cash ?flow|earn\w*|turnover|dip|drop)\b/.test(q) && !/\b(due|upcoming|expected)\b/.test(q)) return revenueAnswer(store, e.propertyNamed ? e.property : null);
  if (/\b(due|upcoming|expected|coming (in|up)|will pay|falls? due|should (come|arrive))\b/.test(q) && !/\b(expir\w*|contract|lease)\b/.test(q)) {
    const days = e.days ?? (/\bweek\b/.test(q) ? 7 : 30);
    return upcomingAnswer(store, e.property, days, e.windowLabel ?? (days === 7 ? "this week" : `in the next ${days} days`));
  }
  if (/\b(late|overdue|unpaid|not paid|hasnt paid|havent paid|behind|missed|delinquent|owe\w*)\b/.test(q)) {
    return /\b(regular\w*|repeat\w*|often|always|habit\w*|chronic\w*|frequent\w*)\b/.test(q)
      ? answerScripted("late_payers", question, store, scoped)
      : answerScripted("unpaid", question, store, scoped);
  }

  // Contracts
  if (/\b(expir\w*|renew\w*|ending|ends|end of|up for|about to end|worry)\b/.test(q) || (/\b(contract|lease)s?\b/.test(q) && (e.days !== null || /\b(soon|next|coming|upcoming|month|week)\b/.test(q)))) {
    return answerScripted("expiring", `contracts in the next ${e.days ?? 30} days ${question}`, store, scoped);
  }

  // Vacancies
  if (/\b(vacan\w*|empty|available|unoccupied|not rented|unrented|free)\b/.test(q)) {
    const min = e.days !== null && /\b(more than|over|longer than|at least|beyond)\b/.test(q) ? e.days : 0;
    return vacancyAnswer(store, e.property, min);
  }

  // Alerts by flavour
  if (/\b(documents?|id cards?|passports?|paperwork|missing id|expir\w* id)\b/.test(q)) return alertsAnswer(store, e.property, undefined, "document", "document alerts");
  if (/\b(warnings?|info alerts?|all alerts|alerts?|issues|problems|risks?)\b/.test(q)) {
    const sev: AlertSeverity | undefined = /\b(critical|urgent)\b/.test(q) ? "critical" : /\bwarnings?\b/.test(q) ? "warning" : undefined;
    return alertsAnswer(store, e.property, sev, undefined, sev ? `${sev} alerts` : "open alerts");
  }

  // Activity
  if (/\b(happened|changed|changes?|activity|recent\w*|log|did (i|we) do|updates?|news)\b/.test(q) || /\bsince\b/.test(q)) {
    const days = e.days ?? (/\btoday\b/.test(q) ? 0 : /\bweek\b/.test(q) ? 7 : null);
    return activityAnswer(store, days);
  }

  // Buildings
  if (e.propertyNamed && e.property) return buildingAnswer(store, e.property);
  if (!e.propertyNamed && BUILDING_WORDS.test(q) && !e.tenant && !e.unitNumber) return unknownBuildingAnswer(store);
  if (/\b(portfolio|overview|summary|overall|everything|how (are|is) (we|things|business|it going)|kpi\w*|occupancy|occupied|how many|total|numbers|stats|status|doing)\b/.test(q)) {
    return e.property && !e.propertyNamed && /\bhere\b|this building/.test(q) ? buildingAnswer(store, e.property) : overviewAnswer(store);
  }
  if (/\b(people|who lives|who is here|residents?)\b/.test(q) && e.property) return buildingAnswer(store, e.property);
  if (/\b(pay\w*|paid|rent)\b/.test(q)) {
    const overdue = getOverduePayments(store, e.property?.id);
    return overdue.length > 0 ? answerScripted("unpaid", question, store, scoped) : upcomingAnswer(store, e.property, 30, "in the next 30 days");
  }
  if (/\b(contracts?|leases?)\b/.test(q)) return answerScripted("expiring", `contracts in the next 60 days ${question}`, store, scoped);
  if (/\btenants?\b/.test(q) && e.property) return buildingAnswer(store, e.property);
  if (/\btenants?\b/.test(q)) {
    const n = store.tenants.filter((t) => (idx.contractsByTenant.get(t.id) ?? []).some(isOccupying)).length;
    return { source: "local", text: `${n} current tenants across ${store.properties.length} buildings (${store.tenants.length - n} former tenants on record).`, suggestions: ["Which tenants regularly pay late?", "Who should I renew early?"] };
  }

  return null;
}

/** Honest answer when nothing fits and no model is available. */
export function unknownAnswer(question: string): AssistantAnswer {
  void question;
  return {
    source: "fallback",
    text: "I can't answer that from the portfolio data. I can cover payments, contracts, buildings, units, tenants, vacancies, alerts and what changed — try one of these:",
    suggestions: SUGGESTED_QUESTIONS.map((q) => q.text),
  };
}
