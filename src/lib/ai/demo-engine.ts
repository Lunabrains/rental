import { indexStore } from "@/lib/data/store";
import { addDaysISO, toISO, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/recompute";
import { formatMoney, formatMoneyCompact, formatPercent } from "@/lib/format";
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

import { arabicToEnglish, findTenantsArabic } from "./arabic";
import { BUILDING_WORDS, findProperty, normalizeQuestion } from "./entities";
import { detectLang, localizeAlert, strings, type Lang, type Strings } from "./i18n";
import { answerScripted, localizeActionLabel, matchScripted, suggestedQuestions } from "./scripted";
import type { AnswerAction, AssistantAnswer, PageContext } from "./types";

/**
 * The demo brain: a rule-based intent router over the query layer. It
 * understands the shapes of questions an owner asks about a portfolio —
 * buildings, units, tenants, money, contracts, vacancies, alerts, what
 * changed — in English or Arabic, and answers with the same numbers the
 * screens show. No model, no network, instant. Anything it cannot place
 * returns null so the caller can try the model or say so honestly.
 */

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "is", "are", "was", "were", "be", "how", "what", "who", "which",
  "when", "where", "why", "do", "does", "did", "me", "my", "our", "we", "i", "you", "about", "tell", "show", "give", "please", "can",
  "could", "would", "should", "with", "from", "this", "that", "these", "those", "any", "all", "some", "there", "it", "its", "his", "her",
  "their", "has", "have", "had", "much", "many", "still", "again", "now", "today", "list", "get", "find", "need", "want", "know", "like",
  "unit", "units", "apartment", "flat", "building", "buildings", "tenant", "tenants", "rent", "rents", "renting", "rented", "contract",
  "contracts", "lease", "leases", "payment", "payments", "paid", "pay", "pays", "up", "out", "over", "into", "so", "just", "also", "lives",
  "live", "living", "history", "status", "details", "info", "information", "profile", "record", "records", "overdue", "late", "owes", "owe",
]);

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };

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
  /** "since" windows look back; "next" windows look forward. */
  past: boolean;
  /** Ready to drop into a sentence, in the answer language. */
  windowLabel: string | null;
}

function findTenants(store: Store, q: string): Tenant[] {
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  if (words.length === 0) return [];
  // "karims contract" — a possessive without the apostrophe is still a name.
  const has = (name: string) => words.includes(name) || words.includes(`${name}s`);
  const scored: { t: Tenant; score: number }[] = [];
  for (const t of store.tenants) {
    const full = normalizeQuestion(t.fullName);
    const first = normalizeQuestion(t.firstName);
    const lastParts = normalizeQuestion(t.lastName).split(" ");
    let score = 0;
    if (q.includes(full)) score = 3;
    else {
      const hasFirst = has(first);
      const hasLast = lastParts.every((part) => part.length >= 3 && has(part));
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
  const kept = scored.filter((s) => s.score === top);
  // A first-name-only hit is too weak to act on unless it is unique.
  if (top === 1 && kept.length > 1) return kept.map((s) => s.t);
  return kept.sort((a, b) => Number(current(b.t)) - Number(current(a.t)) || a.t.fullName.localeCompare(b.t.fullName)).map((s) => s.t);
}

function findDays(q: string, s: Strings): { days: number | null; past: boolean; label: string | null } {
  const past = /\b(last|past|previous|ago|since|yesterday|came in|come in|received?)\b/.test(q);
  const m = /(?:next|within|in|coming|following|upcoming|last|past|previous)?\s*\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple(?: of)?|few|an?)\s*(days?|d|weeks?|wks?|w|months?|mos?|mon)\b/.exec(q);
  if (m) {
    const raw = m[1].replace(/ of$/, "");
    const count = /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1);
    const unit = m[2].startsWith("d") ? "day" : m[2].startsWith("w") ? "week" : "month";
    const days = unit === "day" ? count : unit === "week" ? count * 7 : count * 30;
    return { days, past, label: s.windowNextDays(days) };
  }
  if (/\btomorrow\b/.test(q)) return { days: 1, past: false, label: s.windowNextDays(1) };
  if (/\byesterday\b/.test(q)) return { days: 1, past: true, label: s.whenSince(s.date(addDaysISO(today(), -1))) };
  if (/\b(this|the) week\b/.test(q)) return { days: 7, past, label: s.windowThisWeek };
  if (/\blast week\b/.test(q)) return { days: 7, past: true, label: s.whenSince(s.date(addDaysISO(today(), -7))) };
  if (/\bnext week\b/.test(q)) return { days: 14, past: false, label: s.windowNextDays(14) };
  if (/\bfortnight\b/.test(q)) return { days: 14, past, label: s.windowNextDays(14) };
  if (/\bthis month\b/.test(q)) return { days: 30, past, label: s.windowNextDays(30) };
  if (/\blast month\b/.test(q)) return { days: 30, past: true, label: s.whenSince(s.date(addDaysISO(today(), -30))) };
  if (/\bnext month\b/.test(q)) return { days: 60, past: false, label: s.windowNextDays(60) };
  if (/\b(quarter|three months)\b/.test(q)) return { days: 90, past, label: s.windowNextDays(90) };
  return { days: null, past, label: null };
}

function extract(store: Store, q: string, context: PageContext, arabicTenants: Tenant[], s: Strings): Entities {
  const idx = indexStore(store);
  const named = findProperty(store, q);
  const property = named ?? (context.propertyId ? idx.propertyById.get(context.propertyId) ?? null : null);
  const unitMatch = /\b([a-z]?\d{3,4})\b/.exec(q);
  const candidates = arabicTenants.length > 0 ? arabicTenants : findTenants(store, q);
  const { days, past, label } = findDays(q, s);
  return {
    property,
    propertyNamed: named !== null,
    unitNumber: unitMatch ? unitMatch[1] : null,
    tenant: candidates.length === 1 ? candidates[0] : null,
    tenantCandidates: candidates,
    days,
    past,
    windowLabel: label,
  };
}

/* --------------------------------- Answers -------------------------------- */

function overviewAnswer(store: Store, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const o = getPortfolioOverview(store);
  const perf = getPropertyPerformance(store);
  const best = perf.rows[0];
  const worst = perf.rows[perf.rows.length - 1];
  const occDelta = (o.occupancy.delta * 100).toFixed(1);
  return {
    source: "local",
    lang,
    text: s.overviewText(o.buildings, o.units, formatPercent(o.occupancy.current), `${Number(occDelta) >= 0 ? "+" : ""}${occDelta}`, formatMoney(o.monthlyRevenue.current), formatMoney(o.outstanding.current), o.overdueCount, o.criticalAlerts.total),
    cards: [
      {
        title: s.cols.portfolio,
        subtitle: s.asOf(s.date(o.asOf)),
        fields: [
          [s.fields.occupancy, s.occupancyValue(formatPercent(o.occupancy.current, 1), o.occupied, o.units)],
          [s.fields.available, s.unitsValue(o.available)],
          [s.fields.monthlyRevenue, s.revenueDelta(formatMoney(o.monthlyRevenue.current), o.monthlyRevenue.delta >= 0 ? "+" : "−", formatMoney(Math.abs(o.monthlyRevenue.delta)))],
          [s.fields.outstanding, s.outstandingValue(formatMoney(o.outstanding.current), o.overdueCount)],
          [s.fields.contractsEnding, s.contractsEndingValue(o.expiring30, o.expiring60)],
          [s.fields.criticalAlerts, String(o.criticalAlerts.total)],
        ],
      },
    ],
    recommendation: worst && best && worst.id !== best.id ? s.leadsTrails(best.name, formatPercent(best.occupancy), worst.name, formatPercent(worst.occupancy)) : undefined,
    actions: worst ? [act("view_property", s.openName(worst.name), worst.id)] : [],
    suggestions: [s.suggestions.building, s.suggestions.unpaid, s.suggestions.vacant],
  };
}

function rentRollAnswer(store: Store, property: Property | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const perf = getPropertyPerformance(store);
  const row = property ? perf.rows.find((r) => r.id === property.id) : null;
  const amount = row ? row.monthlyRevenue : perf.total.monthlyRevenue;
  const units = row ? row.rented : perf.total.rented;
  return {
    source: "local",
    lang,
    text: s.rentRollText(s.scopeIn(property?.name), formatMoney(amount), units),
    table: property
      ? undefined
      : {
          columns: [s.cols.building, s.cols.units, s.cols.revenueMo],
          rows: [...perf.rows.map((r) => [r.name, `${r.rented}/${r.units}`, formatMoney(r.monthlyRevenue)]), [s.cols.portfolio, `${perf.total.rented}/${perf.total.units}`, formatMoney(perf.total.monthlyRevenue)]],
        },
    actions: property ? [act("view_property", s.openName(property.name), property.id)] : [],
    suggestions: [s.suggestions.portfolio, s.suggestions.unpaid],
  };
}

function buildingAnswer(store: Store, p: Property, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const row = getPropertyPerformance(store).rows.find((r) => r.id === p.id);
  if (!row) return { source: "local", lang, text: s.unknownBuilding(store.properties.map((x) => x.name).join(", ")) };
  const t = store.settings.thresholds;
  const vacant = getVacantUnits(store, 0, p.id);
  const overdue = getOverduePayments(store, p.id);
  const expiring = getExpiringContracts(store, 60, p.id);
  const alerts = getAlerts(store, { propertyId: p.id, severity: "critical" });
  const longest = vacant[0];
  const first = (name: string) => name.split(" ")[0];
  const sep = lang === "ar" ? "، " : ", ";
  return {
    source: "local",
    lang,
    text: s.buildingText(p.name, formatPercent(row.occupancy), row.rented, row.units, formatMoney(row.monthlyRevenue), row.outstanding > 0 ? s.outstandingAcross(formatMoney(row.outstanding), overdue.length) : s.nothingOutstanding, expiring.length, row.score),
    cards: [
      {
        title: p.name,
        subtitle: s.buildingSubtitleFull(p.address, p.district, p.floors, p.unitsPerFloor),
        fields: [
          [s.fields.occupancy, s.occupancyBelowTarget(formatPercent(row.occupancy), row.rented, row.units, row.occupancy < t.buildingOccupancyWarning)],
          [s.fields.vacant, vacant.length > 0 ? s.vacantValue(vacant.length, longest.unit.unitNumber, longest.daysVacant) : s.none],
          [s.fields.revenuePerMonth, formatMoney(row.monthlyRevenue)],
          [s.fields.outstanding, row.outstanding > 0 ? s.outstandingShareValue(formatMoney(row.outstanding), formatPercent(row.outstandingShare)) : s.dash],
          [s.fields.ending60, expiring.length > 0 ? expiring.slice(0, 3).map((r) => `${first(r.tenant.fullName)} (${r.daysRemaining}${lang === "ar" ? " يوم" : "d"})`).join(sep) + (expiring.length > 3 ? s.more(expiring.length - 3) : "") : s.none],
          [s.fields.criticalAlerts, alerts.length > 0 ? alerts.slice(0, 2).map((a) => localizeAlert(a, store, lang).title).join("; ") + (alerts.length > 2 ? s.more(alerts.length - 2) : "") : s.none],
        ],
      },
    ],
    recommendation:
      overdue.length > 0
        ? s.chaseFirst(overdue[0].tenant.fullName, formatMoney(overdue[0].outstanding), overdue[0].payment.daysLate)
        : vacant.length > 0
          ? s.fillUnit(longest.unit.unitNumber, longest.daysVacant, formatMoney(longest.askingRent))
          : undefined,
    actions: [act("view_property", s.openName(p.name), p.id), ...(overdue[0] ? [act("record_payment", s.recordPaymentOf(first(overdue[0].tenant.fullName)), overdue[0].payment.id)] : [])],
    suggestions: [s.whoHasntPaidIn(p.name), s.vacantIn(p.name), s.expireIn(p.name)],
  };
}

function unknownBuildingAnswer(store: Store, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  return {
    source: "local",
    lang,
    text: s.unknownBuilding(store.properties.map((p) => p.name).join(lang === "ar" ? "، " : ", ")),
    actions: store.properties.slice(0, 3).map((p) => act("view_property", p.name, p.id)),
    suggestions: [s.suggestions.rank, s.suggestions.building],
  };
}

function rankingAnswer(store: Store, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const perf = getPropertyPerformance(store);
  const first = perf.rows[0];
  const last = perf.rows[perf.rows.length - 1];
  return {
    source: "local",
    lang,
    text: first && last ? s.rankingText(perf.rows.length, first.name, formatPercent(first.occupancy), first.score, last.name, formatPercent(last.occupancy)) : s.buildingNone,
    table: {
      columns: [s.cols.building, s.cols.occupancy, s.cols.units, s.cols.revenueMo, s.cols.outstanding, s.cols.score],
      rows: [
        ...perf.rows.map((r) => [r.name, formatPercent(r.occupancy), `${r.rented}/${r.units}`, formatMoney(r.monthlyRevenue), r.outstanding > 0 ? formatMoney(r.outstanding) : s.dash, r.score]),
        [s.cols.portfolio, formatPercent(perf.total.occupancy), `${perf.total.rented}/${perf.total.units}`, formatMoney(perf.total.monthlyRevenue), formatMoney(perf.total.outstanding), perf.total.score],
      ],
    },
    actions: [...(first ? [act("view_property", s.openName(first.name), first.id)] : []), ...(last && last.id !== first?.id ? [act("view_property", s.openName(last.name), last.id)] : [])],
    suggestions: [s.suggestions.building, s.suggestions.portfolio],
  };
}

function tenantAnswer(store: Store, tenant: Tenant, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const d = getTenantDetails(store, tenant.id);
  if (!d) return { source: "local", lang, text: s.unknown };
  const overdue = d.payments.filter((p) => p.status === "overdue" || p.status === "partial");
  const cur = d.current;
  const reliable = d.totals.lateCount === 0 && d.payments.filter((p) => p.status === "paid").length >= 12;
  const text = cur
    ? s.tenantRents(tenant.fullName, cur.property.name, cur.unit.unitNumber, formatMoney(cur.contract.monthlyRent), cur.contract.contractNumber, s.date(cur.contract.endDate), cur.daysRemaining) +
      (overdue.length > 0 ? s.tenantOverdue(formatMoney(d.totals.outstanding), overdue[0].daysLate) : reliable ? s.tenantReliable : s.tenantLateCount(d.totals.lateCount))
    : s.tenantFormer(tenant.fullName, d.contracts[0] ? s.lastIn(d.contracts[0].property.name, d.contracts[0].unit.unitNumber, s.date(d.contracts[0].contract.moveOutDate ?? d.contracts[0].contract.endDate)) : null);
  return {
    source: "local",
    lang,
    text,
    cards: [
      {
        title: tenant.fullName,
        subtitle: s.tenantSubtitle(tenant.occupation, tenant.nationality, tenant.phone),
        fields: [
          [s.fields.unit, cur ? s.unitValueBr(cur.property.name, cur.unit.unitNumber, cur.unit.bedrooms) : s.dash],
          [s.fields.rent, cur ? s.rentValue(formatMoney(cur.contract.monthlyRent), cur.contract.paymentDay) : s.dash],
          [s.fields.contract, cur ? s.contractValue(s.date(cur.contract.startDate), s.date(cur.contract.endDate), cur.daysRemaining) : s.dash],
          [s.fields.payments, s.paymentsValue(formatMoney(d.totals.paid), d.totals.lateCount, formatPercent(d.totals.onTimeRate))],
          [s.fields.outstanding, d.totals.outstanding > 0 ? formatMoney(d.totals.outstanding) : s.none],
          [s.fields.documents, d.documents.length > 0 ? d.documents.map((x) => x.title).join(lang === "ar" ? "، " : ", ") : s.noneOnFile],
          [s.fields.withUs, s.withUsValue(d.tenureMonths, d.contracts.length)],
        ],
      },
    ],
    recommendation: cur && overdue.length > 0 && cur.daysRemaining <= 30 ? s.collectBeforeRenewal(cur.daysRemaining) : cur && cur.daysRemaining <= 30 ? s.renewalDue(cur.daysRemaining, reliable) : undefined,
    actions: [
      ...(overdue[0] ? [act("record_payment", s.recordPayment, overdue[0].id)] : []),
      ...(cur && cur.daysRemaining <= 90 ? [act("renew_contract", s.renewContract, cur.contract.id)] : []),
      act("view_tenant", s.openProfile, tenant.id),
    ],
    suggestions: cur ? [s.whoElseIn(cur.property.name), s.suggestions.latePayers] : [s.suggestions.unpaid],
  };
}

function disambiguate(tenants: Tenant[], store: Store, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const idx = indexStore(store);
  return {
    source: "local",
    lang,
    text: s.disambiguate(tenants.length),
    table: {
      columns: [s.cols.tenant, s.cols.buildingUnit, s.cols.phone],
      rows: tenants.slice(0, 8).map((t) => {
        const c = (idx.contractsByTenant.get(t.id) ?? []).find(isOccupying);
        const u = c ? idx.unitById.get(c.unitId) : undefined;
        const p = u ? idx.propertyById.get(u.propertyId) : undefined;
        return [t.fullName, u && p ? `${p.name} · ${u.unitNumber}` : s.formerTenant, t.phone];
      }),
    },
    actions: tenants.slice(0, 3).map((t) => act("view_tenant", t.fullName, t.id)),
  };
}

function vacancyAnswer(store: Store, property: Property | null, minDays: number, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const rows = getVacantUnits(store, minDays, property?.id);
  const opp = computeVacancyOpportunity(store);
  const potential = rows.reduce((n, r) => n + r.askingRent, 0);
  return {
    source: "local",
    lang,
    text: rows.length === 0 ? s.vacancyNone(s.scopeIn(property?.name), minDays) : s.vacancyIntro(rows.length, s.scopeIn(property?.name), minDays, formatMoney(potential)),
    table:
      rows.length > 0
        ? {
            columns: [s.cols.buildingUnit, s.cols.daysVacant, s.cols.asking, s.cols.previousTenant, s.cols.rentMissed],
            rows: rows.slice(0, 12).map((r) => [`${r.property.name} · ${r.unit.unitNumber}`, r.daysVacant, formatMoney(r.askingRent), r.previousTenant?.fullName ?? s.dash, formatMoney(r.lostRevenue)]),
          }
        : undefined,
    recommendation: rows[0] && rows[0].daysVacant > store.settings.thresholds.vacantWarningDays ? s.listFirst(rows[0].property.name, rows[0].unit.unitNumber, rows[0].daysVacant, formatMoney(rows[0].lostRevenue)) : !property && opp.worstProperty ? s.mostVacancies(opp.worstProperty.property.name, opp.worstProperty.vacant) : undefined,
    actions: rows.slice(0, 2).map((r) => act("view_unit", s.viewUnit(r.unit.unitNumber), r.unit.id)),
    suggestions: [s.suggestions.building, s.suggestions.portfolio],
  };
}

function revenueAnswer(store: Store, scope: Property | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const hist = getRevenueHistory(store, 12, today(), scope?.id);
  const past = hist.slice(0, -1);
  const last = past[past.length - 1];
  const prev = past[past.length - 2];
  // Biggest month-over-month fall in cash, explained only when the ledger supports it.
  let dip: { period: string; drop: number; sentence: string } | null = null;
  for (let i = 1; i < past.length; i++) {
    const before = past[i - 1];
    const p = past[i];
    const drop = before.collected > 0 ? (before.collected - p.collected) / before.collected : 0;
    if (drop <= 0.03 || (dip && drop <= dip.drop)) continue;
    const next = past[i + 1] ?? hist[i + 1];
    const shortfall = p.billed - p.collected;
    const billedFell = before.billed > 0 && (before.billed - p.billed) / before.billed >= 0.03;
    const occupancyFell = before.occupancy - p.occupancy >= 0.02;
    let sentence: string | null = null;
    if (billedFell && occupancyFell) sentence = s.revenueDipOccupancy(s.month(p.period), formatPercent(drop), formatPercent(before.occupancy), formatPercent(p.occupancy));
    else if (shortfall >= 0.03 * p.billed && next && next.collected - next.billed >= 0.5 * shortfall) sentence = s.revenueDip(s.month(p.period), formatPercent(drop));
    dip = { period: p.period, drop, sentence: sentence ?? "" };
  }
  const o = getPortfolioOverview(store);
  return {
    source: "local",
    lang,
    text: s.revenueText(
      scope?.name ?? null,
      formatMoney(last?.collected ?? 0),
      last ? s.month(last.period) : "",
      formatMoney(last?.billed ?? 0),
      prev && last ? s.revenueTrend(last.collected >= prev.collected, formatMoneyCompact(Math.abs(last.collected - prev.collected)), s.month(prev.period)) : "",
      scope ? null : formatMoney(o.monthlyRevenue.current),
      dip?.sentence || null,
    ),
    table: {
      columns: [s.cols.month, s.cols.billed, s.cols.collected, s.cols.occupancy],
      rows: hist.slice(-7).map((p) => [s.month(p.period), formatMoney(p.billed), formatMoney(p.collected), formatPercent(p.occupancy)]),
    },
    suggestions: [s.suggestions.unpaid, s.suggestions.vacant],
  };
}

function upcomingAnswer(store: Store, property: Property | null, days: number, label: string, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const rows = getUpcomingPayments(store, days, property?.id);
  const total = rows.reduce((n, r) => n + r.payment.amountDue, 0);
  return {
    source: "local",
    lang,
    text: rows.length === 0 ? s.upcomingNone(label, s.scopeIn(property?.name)) : s.upcomingIntro(rows.length, formatMoney(total), label, s.scopeIn(property?.name)),
    table:
      rows.length > 0
        ? { columns: [s.cols.due, s.cols.tenant, s.cols.buildingUnit, s.cols.amount], rows: rows.slice(0, 12).map((r) => [s.date(r.payment.dueDate), r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, formatMoney(r.payment.amountDue)]) }
        : undefined,
    actions: rows.slice(0, 2).map((r) => act("record_payment", s.recordRentOf(r.tenant.fullName.split(" ")[0]), r.payment.id)),
    suggestions: [s.suggestions.unpaid, s.suggestions.latePayers],
  };
}

function outstandingAnswer(store: Store, property: Property | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const ob = getOutstandingBalance(store);
  if (property) {
    const row = ob.byProperty.find((b) => b.property.id === property.id);
    const overdue = getOverduePayments(store, property.id);
    return {
      source: "local",
      lang,
      text: !row ? s.outstandingNoneIn(property.name) : s.outstandingIn(formatMoney(row.amount), property.name, row.count, formatPercent(row.share), formatMoney(ob.total)),
      table: overdue.length > 0 ? { columns: [s.cols.tenant, s.fields.unit, s.cols.period, s.cols.outstanding, s.cols.daysOverdue], rows: overdue.map((r) => [r.tenant.fullName, r.unit.unitNumber, s.month(r.payment.periodMonth), formatMoney(r.outstanding), r.payment.daysLate]) } : undefined,
      actions: overdue.slice(0, 2).map((r) => act("record_payment", s.recordPaymentOf(r.tenant.fullName.split(" ")[0]), r.payment.id)),
    };
  }
  return {
    source: "local",
    lang,
    text: ob.total === 0 ? s.outstandingNone : s.outstandingTotal(formatMoney(ob.total), ob.count, ob.byProperty[0]?.property.name ?? null, ob.byProperty[0] ? formatPercent(ob.byProperty[0].share) : null),
    table: ob.byProperty.length > 0 ? { columns: [s.cols.building, s.cols.outstanding, s.cols.payments, s.cols.share], rows: ob.byProperty.map((b) => [b.property.name, formatMoney(b.amount), b.count, formatPercent(b.share)]) } : undefined,
    actions: ob.byProperty.slice(0, 1).map((b) => act("view_property", s.openName(b.property.name), b.property.id)),
    suggestions: [s.suggestions.unpaid, s.suggestions.latePayers],
  };
}

function depositsAnswer(store: Store, property: Property | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const rows = getContracts(store).filter((r) => isOccupying(r.contract) && (!property || r.contract.propertyId === property.id));
  const total = rows.reduce((n, r) => n + r.contract.deposit, 0);
  const byBuilding = new Map<string, number>();
  for (const r of rows) byBuilding.set(r.property.name, (byBuilding.get(r.property.name) ?? 0) + r.contract.deposit);
  return {
    source: "local",
    lang,
    text: s.depositsText(formatMoney(total), rows.length, s.scopeIn(property?.name)),
    table: !property ? { columns: [s.cols.building, s.cols.depositsHeld], rows: [...byBuilding.entries()].sort((a, b) => b[1] - a[1]).map(([name, v]) => [name, formatMoney(v)]) } : undefined,
  };
}

function reliableAnswer(store: Store, property: Property | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const rows = getExpiringContracts(store, 90, property?.id).filter((r) => r.reliable && !r.hasOverdue);
  return {
    source: "local",
    lang,
    text: rows.length === 0 ? s.reliableNone(s.scopeIn(property?.name)) : s.reliableIntro(rows.length),
    table: rows.length > 0 ? { columns: [s.cols.tenant, s.cols.buildingUnit, s.cols.ends, s.cols.days, s.cols.rent], rows: rows.map((r) => [r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, s.date(r.contract.endDate), r.daysRemaining, formatMoney(r.contract.monthlyRent)]) } : undefined,
    actions: rows.slice(0, 2).map((r) => act("renew_contract", s.renewName(r.tenant.fullName.split(" ")[0]), r.contract.id)),
    suggestions: [s.suggestions.expiring, s.suggestions.latePayers],
  };
}

function alertsAnswer(store: Store, property: Property | null, severity: AlertSeverity | undefined, category: AlertCategory | undefined, labelKey: keyof Strings["alertsLabel"], lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const rows = getAlerts(store, { severity, category, propertyId: property?.id });
  const label = s.alertsLabel[labelKey];
  return {
    source: "local",
    lang,
    text: rows.length === 0 ? s.alertsNone(label, s.scopeIn(property?.name)) : s.alertsIntro(rows.length, label, s.scopeIn(property?.name)),
    table:
      rows.length > 0
        ? {
            columns: [s.cols.severity, s.cols.alert, s.cols.detail],
            rows: rows.slice(0, 12).map((a) => {
              const l = localizeAlert(a, store, lang);
              return [a.severity, l.title, l.message];
            }),
          }
        : undefined,
    actions: rows
      .slice(0, 3)
      .map((a) => a.actions[0])
      .filter((a): a is NonNullable<typeof a> => Boolean(a) && a.kind !== "upload_document")
      .map((a) => act(a.kind as AnswerAction["kind"], localizeActionLabel(a.kind as AnswerAction["kind"], a.label, lang), a.targetId)),
    suggestions: [s.suggestions.attention],
  };
}

function activityAnswer(store: Store, sinceDays: number | null, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const all = getActivity(store, undefined, undefined, 200);
  const cutoff = sinceDays !== null ? addDaysISO(today(), -sinceDays) : null;
  const localDate = (iso: string) => toISO(new Date(iso));
  const rows = cutoff ? all.filter((a) => localDate(a.at) >= cutoff) : all;
  const paidSince = cutoff ?? addDaysISO(today(), -2);
  const paid = store.payments.filter((p) => p.paidDate && p.paidDate >= paidSince);
  const paidAmount = formatMoney(paid.reduce((n, p) => n + p.amountPaid, 0));
  const recent = rows.slice(0, 10);
  const when = cutoff ? (sinceDays === 0 ? s.whenToday : s.whenSince(s.date(cutoff))) : s.whenRecently;
  return {
    source: "local",
    lang,
    text: recent.length === 0 ? s.activityNone(when, paid.length, paidAmount) : s.activityIntro(rows.length, when, paid.length, paidAmount),
    table: recent.length > 0 ? { columns: [s.cols.when, s.cols.what, s.cols.by], rows: recent.map((a) => [s.date(localDate(a.at)), a.message, a.actor]) } : undefined,
    suggestions: [s.suggestions.attention, s.suggestions.unpaid],
  };
}

function helpAnswer(lang: Lang): AssistantAnswer {
  const s = strings(lang);
  return {
    source: "local",
    lang,
    text: s.helpText,
    cards: [{ title: s.helpTitle, fields: s.help }],
    suggestions: suggestedQuestions(lang).map((q) => q.text),
  };
}

function tenantsCountAnswer(store: Store, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  const idx = indexStore(store);
  const n = store.tenants.filter((t) => (idx.contractsByTenant.get(t.id) ?? []).some(isOccupying)).length;
  return { source: "local", lang, text: s.tenantsCount(n, store.properties.length, store.tenants.length - n), suggestions: [s.suggestions.latePayers, s.suggestions.renewEarly] };
}

/* --------------------------------- Router --------------------------------- */

export function answerLocally(question: string, store: Store, context: PageContext, langArg?: Lang): AssistantAnswer | null {
  const lang = langArg ?? detectLang(question);
  const s = strings(lang);
  const english = lang === "ar" ? arabicToEnglish(question) : question;
  const q = normalizeQuestion(english);
  if (!q && lang === "en") return null;

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|salut|marhaba)\b/.test(q)) {
    const o = getPortfolioOverview(store);
    return { source: "local", lang, text: s.greeting(store.settings.ownerName, o.criticalAlerts.total, formatMoney(o.outstanding.current), formatPercent(o.occupancy.current)), suggestions: suggestedQuestions(lang).slice(0, 3).map((x) => x.text) };
  }
  if (/^(thanks|thank you|ok|okay|great|perfect|cool|nice|good job|well done)\b/.test(q) && q.split(" ").length <= 4) {
    return { source: "local", lang, text: s.thanks, suggestions: suggestedQuestions(lang).slice(3).map((x) => x.text) };
  }
  if (/what can you (do|answer|help)|^help\b|how do i use|what do you know|what are you/.test(q)) return helpAnswer(lang);

  const arabicTenants = lang === "ar" ? findTenantsArabic(store, question) : [];
  const e = extract(store, q, context, arabicTenants, s);
  const scoped: PageContext = e.propertyNamed && e.property ? { ...context, propertyId: e.property.id, propertyName: e.property.name } : context;
  const namedScope = e.propertyNamed ? e.property : null;
  const expiringQuestion = (days: number) => `contracts in the next ${days} days ${english}`;

  // Paperwork beats leases: "expired ID" is about documents, not contracts.
  if (/\b(documents?|identification|ids?|id cards?|passports?|paperwork|missing id|expir\w* (ids?|passports?|documents?))\b/.test(q)) {
    return alertsAnswer(store, e.property, undefined, "document", "document", lang);
  }

  // A person named explicitly scopes the whole question to them.
  if (e.tenantCandidates.length > 1 && !e.unitNumber) return disambiguate(e.tenantCandidates, store, lang);
  if (e.tenant) return tenantAnswer(store, e.tenant, lang);

  // Money totals come before ranking ("outstanding by building" is not a ranking).
  if (/\b(how much|total|balance|arrears|owed|sum|by building|per building)\b/.test(q) && /\b(outstanding|owed|unpaid|overdue|arrears|due to us|behind)\b/.test(q) && !/\bwho\b/.test(q)) {
    return outstandingAnswer(store, namedScope, lang);
  }
  if (/\brent roll\b/.test(q)) return rentRollAnswer(store, namedScope, lang);

  // Reliable tenants — positive phrasings only; negations go to the late/unpaid branch.
  if (
    /\b(renew\w* early|early renew\w*|prioriti[sz]e\w* .*renew\w*|reliable|never (\w+ ){0,2}late|never miss\w*|on time|punctual\w*|clean (payment )?record|good (tenants|payers)|best tenants|who (should|to) (i )?renew)\b/.test(q) &&
    !/\b(not|hasnt|havent|didnt|isnt|arent|dont|doesnt|fail\w*|never paid on time|never on time)\b/.test(q)
  ) {
    return reliableAnswer(store, e.property, lang);
  }

  if (/\b(rank|compare|comparison|leaderboard|all buildings|each building|every building|by building|per building)\b/.test(q) || /\b(best|top|highest|strongest|most (occupied|profitable))\b/.test(q)) {
    return rankingAnswer(store, lang);
  }

  // The six rehearsed questions — exact, instant — scoped to a named building.
  const scripted = matchScripted(english);
  if (scripted === "expiring") return answerScripted("expiring", expiringQuestion(e.days ?? 30), store, scoped, lang);
  if (scripted) return answerScripted(scripted, english, store, scoped, lang);

  if (e.unitNumber && !(e.days !== null && /\d+\s*(day|week|month)/.test(q))) return answerScripted("who_rents", english, store, scoped, lang);

  // Money
  if (/\bdeposits?\b/.test(q)) return depositsAnswer(store, namedScope, lang);
  const overviewAsk = /\b(occupan\w*|occupied)\b/.test(q) || /\b(overall|overview|summar\w*|state of|how (is|are) (the )?(portfolio|business|things|we))\b/.test(q);
  if (/\b(revenue|income|collect\w*|cash ?flow|earn\w*|turnover|dip|drop)\b/.test(q) && !/\b(due|upcoming|expected)\b/.test(q) && !overviewAsk) return revenueAnswer(store, namedScope, lang);
  if (/\b(due|upcoming|expected|coming (in|up)|will pay|falls? due|should (come|arrive))\b/.test(q) && !/\b(expir\w*|contract|lease)\b/.test(q) && !e.past) {
    const days = e.days ?? (/\bweek\b/.test(q) ? 7 : 30);
    return upcomingAnswer(store, e.property, days, e.windowLabel ?? (days === 7 ? s.windowThisWeek : s.windowNextDays(days)), lang);
  }
  if (/\b(late|overdue|unpaid|not paid|hasnt paid|havent paid|behind|missed|delinquent|owe\w*)\b/.test(q)) {
    return /\b(regular\w*|repeat\w*|often|always|habit\w*|chronic\w*|frequent\w*|recurr\w*)\b/.test(q)
      ? answerScripted("late_payers", english, store, scoped, lang)
      : answerScripted("unpaid", english, store, scoped, lang);
  }

  // Contracts (including people moving out)
  if (/\b(expir\w*|renew\w*|ending|ends|end of|up for|about to end|worry|mov(?:e|es|ing) ?outs?|leav\w*|vacat\w*|notice)\b/.test(q) || (/\b(contract|lease)s?\b/.test(q) && (e.days !== null || /\b(soon|next|coming|upcoming|month|week)\b/.test(q)))) {
    return answerScripted("expiring", expiringQuestion(e.days ?? (/\bnext month\b/.test(q) ? 60 : 30)), store, scoped, lang);
  }

  // Vacancies
  if (/\b(vacan\w*|empty|available|unoccupied|not rented|unrented|free)\b/.test(q)) {
    const min = e.days !== null && /\b(more than|over|longer than|at least|beyond)\b/.test(q) ? e.days : 0;
    return vacancyAnswer(store, e.property, min, lang);
  }

  // Alerts by flavour
  if (/\b(warnings?|info alerts?|all alerts|alerts?|issues|problems|risks?)\b/.test(q)) {
    const sev: AlertSeverity | undefined = /\b(critical|urgent)\b/.test(q) ? "critical" : /\bwarnings?\b/.test(q) ? "warning" : undefined;
    return alertsAnswer(store, e.property, sev, undefined, sev === "critical" ? "critical" : sev === "warning" ? "warning" : "open", lang);
  }

  // Activity, including money that came in over a past window
  if (/\b(happened|changed|changes?|activity|recent\w*|log|did (i|we) do|updates?|news|came in|come in|received?|got paid)\b/.test(q) || /\bsince\b/.test(q)) {
    const days = e.days ?? (/\btoday\b/.test(q) ? 0 : /\bweek\b/.test(q) ? 7 : null);
    return activityAnswer(store, days, lang);
  }

  // People counts before the general overview
  if (/\b(how many|number of|count of|total)\b.*\btenants?\b/.test(q)) return e.propertyNamed && e.property ? buildingAnswer(store, e.property, lang) : tenantsCountAnswer(store, lang);

  // Buildings
  if (e.propertyNamed && e.property) return buildingAnswer(store, e.property, lang);
  if (!e.propertyNamed && BUILDING_WORDS.test(q) && !e.tenant && !e.unitNumber) return unknownBuildingAnswer(store, lang);
  if (/\b(portfolio|overview|summary|overall|everything|how (are|is) (we|things|business|it going)|kpi\w*|occupancy|occupied|how many|total|numbers|stats|status|doing)\b/.test(q)) {
    return e.property && !e.propertyNamed && /\bhere\b|this building/.test(q) ? buildingAnswer(store, e.property, lang) : overviewAnswer(store, lang);
  }
  if (/\b(people|who lives|who is here|residents?)\b/.test(q) && e.property) return buildingAnswer(store, e.property, lang);
  if (/\b(pay\w*|paid|rent)\b/.test(q)) {
    const overdue = getOverduePayments(store, e.property?.id);
    return overdue.length > 0 ? answerScripted("unpaid", english, store, scoped, lang) : upcomingAnswer(store, e.property, 30, s.windowNextDays(30), lang);
  }
  if (/\b(contracts?|leases?)\b/.test(q)) return answerScripted("expiring", expiringQuestion(60), store, scoped, lang);
  if (/\btenants?\b/.test(q) && e.property) return buildingAnswer(store, e.property, lang);
  if (/\btenants?\b/.test(q)) return tenantsCountAnswer(store, lang);

  return null;
}

/** Honest answer when nothing fits and no model is available. */
export function unknownAnswer(question: string, lang: Lang = detectLang(question)): AssistantAnswer {
  const s = strings(lang);
  return { source: "fallback", lang, text: s.unknown, suggestions: suggestedQuestions(lang).map((q) => q.text) };
}
