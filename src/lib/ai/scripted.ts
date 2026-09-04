import { indexStore } from "@/lib/data/store";
import { daysUntil, today } from "@/lib/date";
import { generateIntelligence } from "@/lib/derived/intelligence";
import { formatMoney, formatPercent } from "@/lib/format";
import { getAlerts, getExpiringContracts, getLatePayers, getOutstandingBalance, getOverduePayments, getPropertyPerformance, getUnitDetails, getVacantUnits, searchAll } from "@/lib/queries";
import type { Store } from "@/types";

import { findProperty, findUnits, normalizeQuestion } from "./entities";
import { localizeAlert, strings, type Lang } from "./i18n";
import type { AnswerAction, AssistantAnswer, PageContext } from "./types";

/**
 * The six rehearsed questions answer instantly and exactly from the query
 * layer — no model round-trip, no network, same numbers as the screens —
 * in English or Arabic. Anything else goes through the demo brain.
 */

export type ScriptedId = "attention" | "unpaid" | "expiring" | "building" | "who_rents" | "late_payers";

export const SUGGESTED_QUESTIONS: { id: ScriptedId; text: string }[] = [
  { id: "attention", text: "What needs my attention today?" },
  { id: "unpaid", text: "Who hasn't paid this month?" },
  { id: "expiring", text: "Which contracts expire in the next 30 days?" },
  { id: "building", text: "Which building needs attention?" },
  { id: "who_rents", text: "Who is renting 403 in Beirut Heights?" },
  { id: "late_payers", text: "Which tenants regularly pay late?" },
];

export function suggestedQuestions(lang: Lang): { id: ScriptedId; text: string }[] {
  const s = strings(lang).suggestions;
  return [
    { id: "attention", text: s.attention },
    { id: "unpaid", text: s.unpaid },
    { id: "expiring", text: s.expiring },
    { id: "building", text: s.building },
    { id: "who_rents", text: s.whoRents },
    { id: "late_payers", text: s.latePayers },
  ];
}

/** Match against the English (or translated) question. */
export function matchScripted(question: string): ScriptedId | null {
  const q = normalizeQuestion(question);
  if (/(regularly|repeat|often|always|habitual|frequent|chronic|recurr\w*|keep|tend to).*(late)|late payers?|pays? late|paying late/.test(q)) return "late_payers";
  if (/who (is )?(rent|liv|occup|stay|in) |who is in |who has |tenant (in|of) /.test(q) && /\b[a-z]?\d{3,4}\b/.test(q)) return "who_rents";
  if (/(which|what) building|building (needs|should|requires)|worst building|weakest|problem building|building.*attention/.test(q) && !/\b(best|top|highest|strongest|rank|compare)\b/.test(q)) return "building";
  if (/(contract|lease|renewal)s?.*(expir|end|worry|due|up)|(expir|ending).*(contract|lease)|this month.*(contract|lease)/.test(q)) return "expiring";
  if (/(hasnt|has not|havent|have not|didnt|did not|not) paid|unpaid|\bowe\w*\b|overdue|behind on rent|who paid|missing (rent|payment)|outstanding/.test(q)) return "unpaid";
  if (/attention|priorit|what should i|to do today|focus|urgent|worry about today|what is important/.test(q)) return "attention";
  return null;
}

const actionOf = (kind: AnswerAction["kind"], label: string, targetId: string): AnswerAction => ({ kind, label, targetId });

export function answerScripted(id: ScriptedId, question: string, store: Store, context: PageContext, lang: Lang = "en"): AssistantAnswer {
  const s = strings(lang);
  const base = today();
  const idx = indexStore(store);
  const scopeId = context.propertyId;
  const scopeName = scopeId ? idx.propertyById.get(scopeId)?.name : undefined;
  const scope = s.scopeIn(scopeName);
  const first = (name: string) => name.split(" ")[0];

  switch (id) {
    case "attention": {
      const critical = getAlerts(store, { severity: "critical", propertyId: scopeId });
      const top = critical.slice(0, 6);
      const recommendation = lang === "en" ? generateIntelligence(store, base).actions[0] : top[0] ? s.startWith(localizeAlert(top[0], store, lang).title) : undefined;
      return {
        source: "scripted",
        lang,
        text: critical.length === 0 ? s.attentionNone(scope) : s.attentionIntro(critical.length, scope),
        table:
          top.length > 0
            ? {
                columns: [s.cols.num, s.cols.item, s.cols.detail],
                rows: top.map((a, i) => {
                  const l = localizeAlert(a, store, lang);
                  return [i + 1, l.title, l.message];
                }),
              }
            : undefined,
        recommendation,
        actions: top
          .slice(0, 3)
          .map((a) => a.actions[0])
          .filter((a): a is NonNullable<typeof a> => Boolean(a))
          .map((a) => actionOf(a.kind, localizeActionLabel(a.kind, a.label, lang), a.targetId)),
      };
    }
    case "unpaid": {
      const overdue = getOverduePayments(store, scopeId);
      const total = overdue.reduce((n, r) => n + r.outstanding, 0);
      const tenants = new Set(overdue.map((r) => r.tenant.id)).size;
      return {
        source: "scripted",
        lang,
        text: overdue.length === 0 ? s.unpaidNone(scope) : s.unpaidIntro(tenants, scope, formatMoney(total), overdue.length),
        table:
          overdue.length > 0
            ? {
                columns: [s.cols.tenant, s.cols.buildingUnit, s.cols.period, s.cols.outstanding, s.cols.daysOverdue],
                rows: overdue.map((r) => [
                  r.tenant.fullName,
                  `${r.property.name} · ${r.unit.unitNumber}`,
                  s.month(r.payment.periodMonth),
                  formatMoney(r.outstanding) + (r.payment.status === "partial" ? ` (${s.partial})` : ""),
                  r.payment.daysLate,
                ]),
              }
            : undefined,
        recommendation: overdue.length > 0 ? s.unpaidRecommendation(overdue[0].tenant.fullName, overdue[0].payment.daysLate) : undefined,
        actions: overdue.slice(0, 3).map((r) => actionOf("record_payment", s.recordPaymentOf(first(r.tenant.fullName)), r.payment.id)),
      };
    }
    case "expiring": {
      const m = /next (\d+)|within (\d+)|(\d+) days?/.exec(normalizeQuestion(question));
      const days = Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? 30) || 30;
      const rows = getExpiringContracts(store, days, scopeId, base);
      const wider = getExpiringContracts(store, Math.max(days, 60), scopeId, base);
      const reliable = wider.filter((r) => r.reliable && !r.hasOverdue).sort((a, b) => b.contract.monthlyRent - a.contract.monthlyRent)[0];
      const risky = rows.find((r) => r.hasOverdue);
      const recommendation = (() => {
        const parts: string[] = [];
        if (risky) parts.push(s.settleFirst(risky.tenant.fullName, formatMoney(risky.outstanding)));
        if (reliable) {
          const inWindow = rows.some((r) => r.contract.id === reliable.contract.id);
          parts.push(s.reliableRenew(reliable.tenant.fullName, reliable.daysRemaining, inWindow ? null : days));
        }
        return parts.join(" ") || undefined;
      })();
      const picks = rows.filter((r) => r.hasOverdue).slice(0, 1);
      if (reliable && !picks.some((r) => r.contract.id === reliable.contract.id)) picks.push(reliable);
      return {
        source: "scripted",
        lang,
        text: rows.length === 0 ? s.expiringNone(days, scope) : s.expiringIntro(rows.length, days, scope, formatMoney(rows.reduce((n, r) => n + r.contract.monthlyRent, 0))),
        table: {
          columns: [s.cols.tenant, s.cols.buildingUnit, s.cols.ends, s.cols.days, s.cols.rent, s.cols.note],
          rows: rows.map((r) => [
            r.tenant.fullName,
            `${r.property.name} · ${r.unit.unitNumber}`,
            s.date(r.contract.endDate),
            r.daysRemaining,
            formatMoney(r.contract.monthlyRent),
            r.hasOverdue ? s.alsoOverdue(formatMoney(r.outstanding)) : r.reliable ? s.reliableNote : "",
          ]),
        },
        recommendation,
        actions: picks
          .map((r) => actionOf("renew_contract", s.renewName(first(r.tenant.fullName)), r.contract.id))
          .concat(rows.length > 0 ? [actionOf("view_contract", s.reviewContracts, rows[0].contract.id)] : []),
      };
    }
    case "building": {
      const perf = getPropertyPerformance(store, base);
      const worst = perf.rows[perf.rows.length - 1];
      if (!worst) return { source: "scripted", lang, text: s.buildingNone };
      const ob = getOutstandingBalance(store);
      const share = ob.byProperty.find((b) => b.property.id === worst.id);
      const longest = getVacantUnits(store, 0, worst.id)[0];
      const t = store.settings.thresholds;
      return {
        source: "scripted",
        lang,
        text: s.buildingWeakest(worst.name, formatPercent(worst.occupancy), worst.available, worst.units, worst.occupancy < t.buildingOccupancyWarning ? formatPercent(t.buildingOccupancyWarning) : null, share ? formatPercent(share.share) : "0%"),
        cards: [
          {
            title: worst.name,
            subtitle: s.buildingSubtitle(worst.property.district, worst.property.city, worst.score),
            fields: [
              [s.fields.occupancy, `${formatPercent(worst.occupancy)} · ${worst.rented}/${worst.units}`],
              [s.fields.vacantUnits, String(worst.available)],
              [s.fields.outstanding, share ? s.outstandingShareValue(formatMoney(worst.outstanding), formatPercent(share.share)) : formatMoney(worst.outstanding)],
              [s.fields.revenuePerMonth, formatMoney(worst.monthlyRevenue)],
              [s.fields.longestVacancy, longest ? s.longestVacancyValue(longest.unit.unitNumber, longest.daysVacant, formatMoney(longest.askingRent)) : s.dash],
              [s.fields.contractsEnding30, String(worst.expiring30)],
            ],
          },
        ],
        recommendation: s.buildingRecommendation(worst.name, worst.available, formatMoney(worst.outstanding)),
        actions: [actionOf("view_property", s.openName(worst.name), worst.id), ...(longest ? [actionOf("view_unit", s.viewUnit(longest.unit.unitNumber), longest.unit.id)] : [])],
      };
    }
    case "who_rents": {
      const q = normalizeQuestion(question);
      const unitMatch = /\b([a-z]?\d{3,4})\b/.exec(q);
      const unitNumber = unitMatch?.[1] ?? "";
      const named = findProperty(store, q);
      const property = named ?? (scopeId ? idx.propertyById.get(scopeId) ?? null : null);
      let candidates = findUnits(store, unitNumber, property);
      // Asked from another building's page: look across the portfolio before giving up.
      if (candidates.length === 0 && property && !named) candidates = findUnits(store, unitNumber, null);
      if (candidates.length !== 1) {
        const hint =
          candidates.length > 1
            ? s.unitAmbiguous(unitNumber.toUpperCase(), candidates.map((u) => idx.propertyById.get(u.propertyId)?.name).join(lang === "ar" ? "، " : ", "))
            : s.unitNotFound(unitNumber.toUpperCase(), s.scopeIn(property?.name));
        const options = candidates.length > 1 ? candidates.map((u) => ({ unit: u, property: idx.propertyById.get(u.propertyId)! })) : searchAll(store, unitNumber, 5).units;
        return {
          source: "scripted",
          lang,
          text: hint,
          actions: options.slice(0, 3).map((x) => actionOf("view_unit", `${x.property.name} ${x.unit.unitNumber}`, x.unit.id)),
        };
      }
      const d = getUnitDetails(store, candidates[0].id);
      if (!d) return { source: "scripted", lang, text: s.unitNotFound(unitNumber.toUpperCase(), "") };
      if (!d.tenant || !d.contract) {
        return {
          source: "scripted",
          lang,
          text: s.unitAvailable(d.property.name, d.unit.unitNumber, d.daysVacant, d.previousTenant?.fullName ?? null, formatMoney(d.unit.askingRent)),
          actions: [actionOf("view_unit", s.openUnit, d.unit.id)],
        };
      }
      const overdue = d.payments.filter((p) => p.status === "overdue" || p.status === "partial");
      const days = Math.max(0, daysUntil(d.contract.endDate));
      const overdueTotal = overdue.reduce((n, p) => n + p.amountDue - p.amountPaid, 0);
      return {
        source: "scripted",
        lang,
        text: s.unitRented(d.tenant.fullName, d.property.name, d.unit.unitNumber, d.unit.bedrooms, formatMoney(d.contract.monthlyRent), d.contract.contractNumber, s.date(d.contract.endDate), days, overdue.length > 0 ? s.overdueClause(formatMoney(overdueTotal), overdue[0].daysLate) : null),
        cards: [
          {
            title: d.tenant.fullName,
            subtitle: s.tenantSubtitle(d.tenant.occupation, d.tenant.nationality, d.tenant.phone),
            fields: [
              [s.fields.unit, s.unitValue(d.property.name, d.unit.unitNumber, d.unit.sizeSqm)],
              [s.fields.rent, s.rentValue(formatMoney(d.contract.monthlyRent), d.contract.paymentDay)],
              [s.fields.contract, s.contractValue(s.date(d.contract.startDate), s.date(d.contract.endDate), days)],
              [s.fields.payments, s.paymentsValue(formatMoney(d.totals.paid), d.totals.lateCount, formatPercent(d.totals.onTimeRate))],
              [s.fields.outstanding, d.totals.outstanding > 0 ? formatMoney(d.totals.outstanding) : s.none],
              [s.fields.documents, d.documents.length > 0 ? d.documents.map((x) => x.title).join(lang === "ar" ? "، " : ", ") : s.noneOnFile],
            ],
          },
        ],
        recommendation: overdue.length > 0 && days <= 30 ? s.collectBeforeRenewal(days) : days <= 30 ? s.renewalDue(days, false) : undefined,
        actions: [
          ...(overdue.length > 0 ? [actionOf("record_payment", s.recordPayment, overdue[0].id)] : []),
          ...(days <= 60 ? [actionOf("renew_contract", s.renewContract, d.contract.id)] : []),
          actionOf("view_unit", s.openUnit, d.unit.id),
        ],
      };
    }
    case "late_payers": {
      const t = store.settings.thresholds;
      const late = getLatePayers(store, t.repeatLateWindowMonths, t.repeatLateMinCount, scopeId);
      return {
        source: "scripted",
        lang,
        text: late.length === 0 ? s.latePayersNone(t.repeatLateMinCount, t.repeatLateWindowMonths, scope) : s.latePayersIntro(late.length, t.repeatLateMinCount, t.repeatLateWindowMonths, scope),
        table:
          late.length > 0
            ? {
                columns: [s.cols.tenant, s.cols.buildingUnit, s.cols.late, s.cols.avgDaysLate, s.cols.now],
                rows: late.map((l) => [l.tenant.fullName, `${l.property.name} · ${l.unit.unitNumber}`, s.lateOf(l.lateCount, l.windowMonths), l.avgDaysLate, l.currentlyOverdue ? s.overdueNow(formatMoney(l.outstanding)) : s.paidUp]),
              }
            : undefined,
        recommendation: late[0] ? s.latePayersRecommendation(late[0].tenant.fullName) : undefined,
        actions: late.slice(0, 2).flatMap((l) => [actionOf("send_reminder", s.remindName(first(l.tenant.fullName)), l.tenant.id), actionOf("view_tenant", s.viewName(first(l.tenant.fullName)), l.tenant.id)]),
      };
    }
  }
}

/** Alert action labels are English in the engine; give the buttons the answer's language. */
export function localizeActionLabel(kind: AnswerAction["kind"], label: string, lang: Lang): string {
  if (lang === "en") return label;
  switch (kind) {
    case "record_payment":
      return "تسجيل دفعة";
    case "send_reminder":
      return "إرسال تذكير";
    case "renew_contract":
      return "تجديد";
    case "mark_as_leaving":
      return "تسجيل مغادرة";
    case "view_unit":
      return "عرض الشقة";
    case "view_tenant":
      return "عرض المستأجر";
    case "view_property":
      return "عرض المبنى";
    case "view_contract":
      return "عرض العقد";
    default:
      return label;
  }
}
