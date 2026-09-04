import { indexStore } from "@/lib/data/store";
import { today } from "@/lib/date";
import { generateIntelligence } from "@/lib/derived/intelligence";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import {
  getAlerts,
  getExpiringContracts,
  getLatePayers,
  getOutstandingBalance,
  getOverduePayments,
  getPropertyPerformance,
  getUnitDetails,
  getVacantUnits,
  searchAll,
} from "@/lib/queries";
import type { Store } from "@/types";

import type { AnswerAction, AssistantAnswer, PageContext } from "./types";

/**
 * The six rehearsed questions answer instantly and exactly from the query
 * layer — no model round-trip, no network, same numbers as the screens.
 * Anything else goes to the model with the same tools.
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

function norm(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchScripted(question: string): ScriptedId | null {
  const q = norm(question);
  if (/(regularly|repeat|often|always|habitual|frequent|chronic|keep|tend to).*(late)|late payers?|pays? late|paying late/.test(q)) return "late_payers";
  if (/who (is )?(rent|liv|occup|stay|in) |whos in |who has |tenant (in|of) /.test(q) && /\b[a-z]?\d{3,4}\b/.test(q)) return "who_rents";
  if (/(which|what) building|building (needs|should|requires)|worst building|weakest|problem building|building.*attention/.test(q)) return "building";
  if (/(contract|lease|renewal)s?.*(expir|end|worry|due|up)|(expir|ending).*(contract|lease)|next (30|thirty) days|this month.*(contract|lease)/.test(q)) return "expiring";
  if (/(hasnt|has not|havent|have not|didnt|did not|not) paid|unpaid|owe|overdue|behind on rent|who paid|missing (rent|payment)|outstanding/.test(q)) return "unpaid";
  if (/attention|priorit|what should i|to do today|focus|urgent|worry about today|whats important/.test(q)) return "attention";
  return null;
}

const actionOf = (kind: AnswerAction["kind"], label: string, targetId: string): AnswerAction => ({ kind, label, targetId });

export function answerScripted(id: ScriptedId, question: string, store: Store, context: PageContext): AssistantAnswer {
  const base = today();
  const idx = indexStore(store);
  const scopeId = context.propertyId;
  const scopeName = scopeId ? idx.propertyById.get(scopeId)?.name : undefined;

  switch (id) {
    case "attention": {
      const critical = getAlerts(store, { severity: "critical", propertyId: scopeId });
      const brief = generateIntelligence(store, base);
      const top = critical.slice(0, 6);
      return {
        source: "scripted",
        text:
          critical.length === 0
            ? `Nothing critical${scopeName ? ` in ${scopeName}` : ""} right now.`
            : `${critical.length} critical item${critical.length === 1 ? "" : "s"}${scopeName ? ` in ${scopeName}` : ""} need a decision today. Ranked by money and time at stake:`,
        table:
          top.length > 0
            ? {
                columns: ["#", "Item", "Detail"],
                rows: top.map((a, i) => [i + 1, a.title, a.message]),
              }
            : undefined,
        recommendation: brief.actions[0],
        actions: top
          .slice(0, 3)
          .map((a) => a.actions[0])
          .filter((a): a is NonNullable<typeof a> => Boolean(a))
          .map((a) => actionOf(a.kind, a.label, a.targetId)),
      };
    }
    case "unpaid": {
      const overdue = getOverduePayments(store, scopeId);
      const total = overdue.reduce((n, r) => n + r.outstanding, 0);
      const tenants = new Set(overdue.map((r) => r.tenant.id)).size;
      return {
        source: "scripted",
        text:
          overdue.length === 0
            ? `Everyone${scopeName ? ` in ${scopeName}` : ""} is paid up.`
            : `${tenants} tenant${tenants === 1 ? "" : "s"}${scopeName ? ` in ${scopeName}` : ""} owe ${formatMoney(total)} across ${overdue.length} payment${overdue.length === 1 ? "" : "s"}. Most overdue first:`,
        table:
          overdue.length > 0
            ? {
                columns: ["Tenant", "Building · Unit", "Period", "Outstanding", "Days overdue"],
                rows: overdue.map((r) => [
                  r.tenant.fullName,
                  `${r.property.name} · ${r.unit.unitNumber}`,
                  formatMonth(r.payment.periodMonth),
                  formatMoney(r.outstanding) + (r.payment.status === "partial" ? " (partial)" : ""),
                  r.payment.daysLate,
                ]),
              }
            : undefined,
        recommendation:
          overdue.length > 0
            ? `Start with ${overdue[0].tenant.fullName} (${overdue[0].payment.daysLate} days) — then anyone whose contract is also ending soon.`
            : undefined,
        actions: overdue.slice(0, 3).map((r) => actionOf("record_payment", `Record ${r.tenant.fullName.split(" ")[0]}'s payment`, r.payment.id)),
      };
    }
    case "expiring": {
      const m = /next (\d+)|within (\d+)|(\d+) days/.exec(norm(question));
      const days = Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? 30) || 30;
      const rows = getExpiringContracts(store, days, scopeId, base);
      return {
        source: "scripted",
        text:
          rows.length === 0
            ? `No contracts end within ${days} days${scopeName ? ` in ${scopeName}` : ""}.`
            : `${rows.length} contract${rows.length === 1 ? "" : "s"} end within ${days} days${scopeName ? ` in ${scopeName}` : ""}, worth ${formatMoney(rows.reduce((n, r) => n + r.contract.monthlyRent, 0))}/month.`,
        table: {
          columns: ["Tenant", "Building · Unit", "Ends", "Days", "Rent", "Note"],
          rows: rows.map((r) => [
            r.tenant.fullName,
            `${r.property.name} · ${r.unit.unitNumber}`,
            formatDate(r.contract.endDate),
            r.daysRemaining,
            formatMoney(r.contract.monthlyRent),
            r.hasOverdue ? `also overdue (${formatMoney(r.outstanding)})` : r.reliable ? "reliable — renew early" : "",
          ]),
        },
        recommendation: (() => {
          const risky = rows.find((r) => r.hasOverdue);
          // Look one window further for the reliable tenant worth locking in early.
          const wider = getExpiringContracts(store, Math.max(days, 60), scopeId, base);
          const reliable = wider.filter((r) => r.reliable && !r.hasOverdue).sort((a, b) => b.contract.monthlyRent - a.contract.monthlyRent)[0];
          const parts: string[] = [];
          if (risky) parts.push(`Settle ${risky.tenant.fullName}'s ${formatMoney(risky.outstanding)} before renewing.`);
          if (reliable) {
            const inWindow = rows.some((r) => r.contract.id === reliable.contract.id);
            parts.push(`${inWindow ? "" : `Just beyond ${days} days: `}${reliable.tenant.fullName} (never late) ends in ${reliable.daysRemaining} days — renew early.`);
          }
          return parts.join(" ") || undefined;
        })(),
        actions: (() => {
          const wider = getExpiringContracts(store, Math.max(days, 60), scopeId, base);
          const reliable = wider.filter((r) => r.reliable && !r.hasOverdue).sort((a, b) => b.contract.monthlyRent - a.contract.monthlyRent)[0];
          const picks = rows.filter((r) => r.hasOverdue).slice(0, 1);
          if (reliable && !picks.some((r) => r.contract.id === reliable.contract.id)) picks.push(reliable);
          return picks
            .map((r) => actionOf("renew_contract", `Renew ${r.tenant.fullName.split(" ")[0]}`, r.contract.id))
            .concat(rows.length > 0 ? [actionOf("view_contract", "Review contracts", rows[0].contract.id)] : []);
        })(),
      };
    }
    case "building": {
      const perf = getPropertyPerformance(store, base);
      const worst = perf.rows[perf.rows.length - 1];
      if (!worst) return { source: "scripted", text: "No buildings loaded yet." };
      const ob = getOutstandingBalance(store);
      const share = ob.byProperty.find((b) => b.property.id === worst.id);
      const longest = getVacantUnits(store, 0, worst.id)[0];
      const t = store.settings.thresholds;
      return {
        source: "scripted",
        text: `${worst.name}. It is the lowest-occupancy building at ${formatPercent(worst.occupancy)} (${worst.available} of ${worst.units} units vacant${worst.occupancy < t.buildingOccupancyWarning ? `, below the ${formatPercent(t.buildingOccupancyWarning)} target` : ""}) and holds ${share ? formatPercent(share.share) : "0%"} of all outstanding rent.`,
        cards: [
          {
            title: worst.name,
            subtitle: `${worst.property.district}, ${worst.property.city} · score ${worst.score}`,
            fields: [
              ["Occupancy", `${formatPercent(worst.occupancy)} · ${worst.rented}/${worst.units}`],
              ["Vacant units", String(worst.available)],
              ["Outstanding", `${formatMoney(worst.outstanding)}${share ? ` (${formatPercent(share.share)} of portfolio)` : ""}`],
              ["Revenue / month", formatMoney(worst.monthlyRevenue)],
              ["Longest vacancy", longest ? `${longest.unit.unitNumber} · ${longest.daysVacant} days · asking ${formatMoney(longest.askingRent)}` : "—"],
              ["Contracts ending in 30d", String(worst.expiring30)],
            ],
          },
        ],
        recommendation: `Push leasing on ${worst.name}'s ${worst.available} vacant units and chase its ${formatMoney(worst.outstanding)} outstanding — that is where the portfolio is leaking.`,
        actions: [actionOf("view_property", `Open ${worst.name}`, worst.id), ...(longest ? [actionOf("view_unit", `View ${longest.unit.unitNumber}`, longest.unit.id)] : [])],
      };
    }
    case "who_rents": {
      const q = norm(question);
      const unitMatch = /\b([a-z]?\d{3,4})\b/.exec(q);
      const unitNumber = unitMatch?.[1] ?? "";
      const named = store.properties.find((p) => q.includes(p.name.toLowerCase()));
      const property = named ?? (scopeId ? idx.propertyById.get(scopeId) : undefined);
      const candidates = store.units.filter((u) => u.unitNumber.toLowerCase() === unitNumber && (!property || u.propertyId === property.id));
      if (candidates.length !== 1) {
        const hint = candidates.length > 1 ? `Unit ${unitNumber.toUpperCase()} exists in ${candidates.map((u) => idx.propertyById.get(u.propertyId)?.name).join(", ")} — which building?` : `I couldn't find unit ${unitNumber.toUpperCase()}${property ? ` in ${property.name}` : ""}.`;
        const s = searchAll(store, unitNumber, 5);
        return {
          source: "scripted",
          text: hint,
          actions: s.units.slice(0, 3).map((x) => actionOf("view_unit", `${x.property.name} ${x.unit.unitNumber}`, x.unit.id)),
        };
      }
      const d = getUnitDetails(store, candidates[0].id);
      if (!d) return { source: "scripted", text: "Unit not found." };
      if (!d.tenant || !d.contract) {
        return {
          source: "scripted",
          text: `${d.property.name} ${d.unit.unitNumber} is available${d.daysVacant !== null ? ` — vacant ${d.daysVacant} days` : ""}${d.previousTenant ? `; the previous tenant was ${d.previousTenant.fullName}` : ""}. Asking ${formatMoney(d.unit.askingRent)}/month.`,
          actions: [actionOf("view_unit", "Open unit", d.unit.id)],
        };
      }
      const overdue = d.payments.filter((p) => p.status === "overdue" || p.status === "partial");
      const days = Math.max(0, Math.round((new Date(d.contract.endDate).getTime() - new Date(base).getTime()) / 86_400_000));
      return {
        source: "scripted",
        text: `${d.tenant.fullName} rents ${d.property.name} ${d.unit.unitNumber} (${d.unit.bedrooms} BR) for ${formatMoney(d.contract.monthlyRent)}/month. Contract ${d.contract.contractNumber} ends ${formatDate(d.contract.endDate)} — ${days} days away.${overdue.length > 0 ? ` ${formatMoney(overdue.reduce((n, p) => n + p.amountDue - p.amountPaid, 0))} is overdue (${overdue[0].daysLate} days).` : " Rent is up to date."}`,
        cards: [
          {
            title: d.tenant.fullName,
            subtitle: `${d.tenant.occupation ?? "Tenant"} · ${d.tenant.nationality} · ${d.tenant.phone}`,
            fields: [
              ["Unit", `${d.property.name} · ${d.unit.unitNumber} · ${d.unit.sizeSqm} m²`],
              ["Rent", `${formatMoney(d.contract.monthlyRent)}/month · due the ${d.contract.paymentDay}th`],
              ["Contract", `${formatDate(d.contract.startDate)} → ${formatDate(d.contract.endDate)} (${days} days left)`],
              ["Payments", `${formatMoney(d.totals.paid)} paid · ${d.totals.lateCount} late · ${formatPercent(d.totals.onTimeRate)} on time`],
              ["Outstanding", d.totals.outstanding > 0 ? formatMoney(d.totals.outstanding) : "None"],
              ["Documents", d.documents.length > 0 ? d.documents.map((x) => x.title).join(", ") : "None on file"],
            ],
          },
        ],
        recommendation: overdue.length > 0 && days <= 30 ? `Collect the overdue rent before deciding the renewal (${days} days left).` : days <= 30 ? `Renewal is due in ${days} days.` : undefined,
        actions: [
          ...(overdue.length > 0 ? [actionOf("record_payment", "Record payment", overdue[0].id)] : []),
          ...(days <= 60 ? [actionOf("renew_contract", "Renew contract", d.contract.id)] : []),
          actionOf("view_unit", "Open unit", d.unit.id),
        ],
      };
    }
    case "late_payers": {
      const t = store.settings.thresholds;
      const late = getLatePayers(store, t.repeatLateWindowMonths, t.repeatLateMinCount, scopeId);
      return {
        source: "scripted",
        text:
          late.length === 0
            ? `No tenant${scopeName ? ` in ${scopeName}` : ""} has been late ${t.repeatLateMinCount} or more times in the last ${t.repeatLateWindowMonths} months.`
            : `${late.length} tenant${late.length === 1 ? "" : "s"} ${late.length === 1 ? "is" : "are"} a repeat late payer (late in ${t.repeatLateMinCount}+ of the last ${t.repeatLateWindowMonths} months)${scopeName ? ` in ${scopeName}` : ""}.`,
        table:
          late.length > 0
            ? {
                columns: ["Tenant", "Building · Unit", "Late", "Avg days late", "Now"],
                rows: late.map((l) => [
                  l.tenant.fullName,
                  `${l.property.name} · ${l.unit.unitNumber}`,
                  `${l.lateCount} of ${l.windowMonths}`,
                  l.avgDaysLate,
                  l.currentlyOverdue ? `overdue · ${formatMoney(l.outstanding)}` : "paid up",
                ]),
              }
            : undefined,
        recommendation: late[0] ? `Call ${late[0].tenant.fullName} and move them to a fixed payment date; consider not renewing without a deposit top-up.` : undefined,
        actions: late.slice(0, 2).flatMap((l) => [actionOf("send_reminder", `Remind ${l.tenant.fullName.split(" ")[0]}`, l.tenant.id), actionOf("view_tenant", `View ${l.tenant.fullName.split(" ")[0]}`, l.tenant.id)]),
      };
    }
  }
}
