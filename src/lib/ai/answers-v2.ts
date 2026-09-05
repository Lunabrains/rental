import { indexStore } from "@/lib/data/store";
import { addPeriods, currentPeriod, daysBetween, daysSince, periodOf, previousPeriod, today } from "@/lib/date";
import { getDailyBriefing } from "@/lib/derived/briefing";
import { isOccupying } from "@/lib/derived/occupancy";
import { collectionRate } from "@/lib/derived/metrics";
import { labelize } from "@/lib/format";
import { getCashFlowForecast, getExpenses, getOverduePayments, getPortfolioComparison, getPreventivePlans, getPropertyFinancials, getPropertyPerformance, getRenewals, getSuppliers, getUnitRankings, getVacantUnits, getWorkOrders } from "@/lib/queries";
import { EXPENSE_CATEGORIES, WORK_ORDER_CATEGORIES, type ExpenseCategory, type Property, type Store, type Supplier, type Tenant, type WorkOrderCategory } from "@/types";

import { strings, type Lang } from "./i18n";
import type { AnswerAction, AssistantAnswer, PageContext } from "./types";

export interface RouterEntities {
  property: Property | null;
  propertyNamed: boolean;
  tenant: Tenant | null;
  unitNumber: string | null;
  days: number | null;
}

const act = (kind: AnswerAction["kind"], label: string, targetId: string): AnswerAction => ({ kind, label, targetId });

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(elevator|lift)s?\b/, "elevator"],
  [/\bgenerators?\b/, "generator"],
  [/\b(plumb\w*|water leak\w*|pipes?|drains?)\b/, "plumbing"],
  [/\b(electric\w*|wiring|power)\b/, "electrical"],
  [/\b(hvac|air ?con\w*|ac units?|cooling|heating)\b/, "hvac"],
  [/\bclean\w*\b/, "cleaning"],
  [/\b(security|guards?|cctv|cameras?)\b/, "security"],
  [/\binsurance\b/, "insurance"],
  [/\b(municipal\w*|tax(es)?)\b/, "municipality"],
  [/\b(renovat\w*|capex|refit\w*)\b/, "renovation"],
  [/\b(paint\w*)\b/, "painting"],
  [/\b(pest\w*|termites?|cockroach\w*)\b/, "pest_control"],
  [/\b(utilit\w*|electricity bill|water bill)\b/, "utilities"],
  [/\bmaintenance\b/, "maintenance"],
];

function expenseCategoryIn(q: string): ExpenseCategory | null {
  for (const [re, c] of CATEGORY_WORDS) if (re.test(q) && (EXPENSE_CATEGORIES as readonly string[]).includes(c)) return c as ExpenseCategory;
  return null;
}
function workCategoryIn(q: string): WorkOrderCategory | null {
  for (const [re, c] of CATEGORY_WORDS) if (re.test(q) && (WORK_ORDER_CATEGORIES as readonly string[]).includes(c)) return c as WorkOrderCategory;
  return null;
}
function supplierIn(store: Store, q: string): Supplier | null {
  const tokens = q.split(/\s+/);
  let best: { s: Supplier; score: number } | null = null;
  for (const s of store.suppliers) {
    const parts = s.name.toLowerCase().split(/[^a-z0-9]+/).filter((p) => p.length > 2);
    const hits = parts.filter((p) => tokens.includes(p)).length;
    const score = parts.length > 0 ? hits / parts.length : 0;
    if (hits > 0 && (parts.length === 1 || hits >= 1) && (!best || score > best.score)) best = { s, score: score + (hits >= 2 ? 1 : 0) };
  }
  return best && (best.score >= 0.5 || best.s.name.toLowerCase().split(/\s+/)[0].length >= 5) ? best.s : null;
}
/** A tenant named by first or last name only, when that is unambiguous. */
function tenantsIn(store: Store, q: string): Tenant[] {
  const tokens = new Set(q.split(/\s+/));
  const hits = store.tenants.filter((t) => t.fullName.toLowerCase().split(/\s+/).some((part) => part.length >= 3 && tokens.has(part)));
  const full = hits.filter((t) => t.fullName.toLowerCase().split(/\s+/).every((part) => tokens.has(part)));
  if (full.length === 1) return full;
  // Current tenants first — a reminder is almost always about someone in the building today.
  const idx = indexStore(store);
  return hits.sort((a, b) => Number((idx.contractsByTenant.get(b.id) ?? []).some(isOccupying)) - Number((idx.contractsByTenant.get(a.id) ?? []).some(isOccupying)) || a.fullName.localeCompare(b.fullName));
}

const MAINTENANCE_CATEGORIES = new Set<string>(["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "appliance", "painting", "pest_control", "cleaning"]);

function yearIn(q: string, base: string): { year: string; label: (s: ReturnType<typeof strings>) => string } {
  const m = q.match(/\b(20\d{2})\b/);
  if (m) return { year: m[1], label: () => m[1] };
  if (/\blast year\b/.test(q)) return { year: String(Number(base.slice(0, 4)) - 1), label: (s) => s.v2.lastYear };
  return { year: base.slice(0, 4), label: (s) => s.v2.thisYear };
}

/**
 * Second-generation local answers (plan §Phase 16): collection, arrears by age,
 * renewals awaiting a decision, occupancy and vacancy rankings, building and
 * unit profitability, expense analysis, cash flow, maintenance backlog and
 * repeat issues, preventive services, supplier performance and spend, the daily
 * briefing, and two safe actions (reminder, draft work order). Every figure
 * comes from the same queries the screens use.
 */
export function answerV2(q: string, store: Store, context: PageContext, e: RouterEntities, lang: Lang): AssistantAnswer | null {
  const s = strings(lang);
  const v = s.v2;
  const base = today();
  const idx = indexStore(store);
  const scope = e.property;
  const scopeId = scope?.id;
  const scopeLabel = s.scopeIn(scope?.name);
  const local = (a: Omit<AssistantAnswer, "source" | "lang">): AssistantAnswer => ({ ...a, source: "local", lang });

  /* Briefing */
  if (/\b(briefing|brief me|my day|daily summary|morning summary|start my day)\b/.test(q)) {
    const b = getDailyBriefing(store, base);
    const decide = b.sections.find((x) => x.key === "decide")?.items ?? [];
    const money = b.sections.find((x) => x.key === "money")?.items ?? [];
    const rows = [...decide, ...money].slice(0, 8);
    return local({ text: v.briefing(b.headline), table: rows.length > 0 ? { columns: [v.cols.title, v.cols.status], rows: rows.map((i) => [i.title, i.detail]) } : undefined, recommendation: b.narrative[b.narrative.length - 1], actions: rows.slice(0, 3).flatMap((i) => i.actions.slice(0, 1)), suggestions: [s.suggestions.attention, s.suggestions.unpaid] });
  }

  /* Reminder */
  if (/\b(remind me|set (a )?reminder|reminder (to|for|about)|note to self|follow ?up (with|on))\b/.test(q)) {
    const people = e.tenant ? [e.tenant] : tenantsIn(store, q).slice(0, 4);
    if (people.length > 0) return local({ text: v.reminderOffer(people.map((t) => t.fullName).join(" / ")), actions: people.map((t) => act("create_reminder", people.length === 1 ? v.labels.remind : `${v.labels.remind} · ${t.fullName}`, t.id)) });
    const target = scope ? { id: scope.id, label: scope.name } : store.properties[0] ? { id: store.properties[0].id, label: lang === "ar" ? "المحفظة" : "the portfolio" } : null;
    return local({ text: v.reminderOffer(target?.label ?? (lang === "ar" ? "المحفظة" : "the portfolio")), actions: target ? [act("create_reminder", v.labels.remind, target.id)] : [] });
  }

  /* Draft work order */
  if (/\b(create|open|raise|log|new)\b.*\b(work order|ticket|maintenance (request|job)|repair job)\b/.test(q) || /\b(work order|ticket)\b.*\b(for|on|in)\b/.test(q)) {
    const unit = e.unitNumber ? store.units.find((u) => u.unitNumber.toUpperCase() === e.unitNumber!.toUpperCase() && (!scopeId || u.propertyId === scopeId)) : null;
    const target = unit ? { id: unit.id, label: `${idx.propertyById.get(unit.propertyId)?.name ?? ""} ${unit.unitNumber}` } : scope ? { id: scope.id, label: scope.name } : null;
    if (target) return local({ text: v.workOrderOffer(target.label), actions: [act("create_work_order", v.labels.createWo, target.id)] });
  }

  /* Collection rate */
  if (/\bcollection( rate)?\b/.test(q) || /\b(how much|what) (did|have|was) (i|we) collect\w*\b/.test(q) || /\bcollected (this|last) month\b/.test(q)) {
    const period = /\blast month\b/.test(q) ? previousPeriod(currentPeriod()) : currentPeriod();
    const payments = store.payments.filter((p) => !scopeId || p.propertyId === scopeId);
    const cr = collectionRate(payments, period, period === currentPeriod() ? base : undefined);
    const prev = collectionRate(payments, addPeriods(period, -1));
    const history = Array.from({ length: 6 }, (_, i) => addPeriods(period, -5 + i)).map((p) => {
      const r = collectionRate(payments, p, p === currentPeriod() ? base : undefined);
      return [s.month(p), s.money(r.due), s.money(r.collected), s.pct(r.rate)] as (string | number)[];
    });
    const overdue = getOverduePayments(store, scopeId);
    return local({ text: v.collection(s.month(period), scopeLabel, s.pct(cr.rate), s.money(cr.collected), s.money(cr.due)) + (prev.due > 0 ? v.collectionTrend(s.pct(prev.rate)) : ""), table: { columns: [v.cols.month, v.cols.dueAmount, v.cols.collected, v.cols.rate], rows: history }, recommendation: overdue[0] ? s.chaseFirst(overdue[0].tenant.fullName, s.money(overdue[0].outstanding), daysSince(overdue[0].payment.dueDate)) : undefined, actions: overdue[0] ? [act("record_payment", s.recordPaymentOf(overdue[0].tenant.fullName.split(" ")[0]), overdue[0].payment.id), act("view_property", v.labels.rentRoll, scopeId ?? store.properties[0]?.id ?? "")].filter((a) => a.targetId) : undefined });
  }

  /* Overdue beyond N days */
  if (/\b(overdue|late|behind|unpaid|owe\w*)\b/.test(q) && e.days !== null && /\b(more than|over|beyond|at least|longer than|\d+\+)\b/.test(q)) {
    const days = e.days;
    const rows = getOverduePayments(store, scopeId).filter((p) => daysSince(p.payment.dueDate) >= days);
    if (rows.length === 0) return local({ text: v.overdueBeyondNone(days, scopeLabel) });
    const total = rows.reduce((n, r) => n + r.outstanding, 0);
    return local({ text: v.overdueBeyond(rows.length, days, scopeLabel, s.money(total)), table: { columns: [v.cols.tenant, v.cols.where, v.cols.amount, v.cols.daysLate], rows: rows.slice(0, 12).map((r) => [r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, s.money(r.outstanding), daysSince(r.payment.dueDate)]) }, recommendation: s.chaseFirst(rows[0].tenant.fullName, s.money(rows[0].outstanding), daysSince(rows[0].payment.dueDate)), actions: [act("record_payment", s.recordPaymentOf(rows[0].tenant.fullName.split(" ")[0]), rows[0].payment.id), act("send_reminder", s.remindName(rows[0].tenant.fullName.split(" ")[0]), rows[0].tenant.id)] });
  }

  /* Renewal decisions pending */
  if (/\b(waiting|pending|awaiting|undecided|no decision|decide|decision)\b/.test(q) && /\b(renew\w*|decision|contract)\b/.test(q)) {
    const rows = getRenewals(store, 90, scopeId).filter((r) => r.contract.renewalStatus === "awaiting_decision" || (r.contract.renewalDecision === null && r.daysRemaining <= 60));
    if (rows.length === 0) return local({ text: v.renewalsNone(scopeLabel) });
    const rent = rows.reduce((n, r) => n + r.contract.monthlyRent, 0);
    return local({ text: v.renewals(rows.length, scopeLabel, s.money(rent)), table: { columns: [v.cols.tenant, v.cols.where, v.cols.ends, v.cols.rent, v.cols.decision], rows: rows.map((r) => [r.tenant.fullName, `${r.property.name} · ${r.unit.unitNumber}`, s.date(r.contract.endDate), s.money(r.contract.monthlyRent), r.reliable ? s.reliableNote : r.hasOverdue ? s.overdueNow(s.money(r.outstanding)) : s.dash]) }, recommendation: rows.find((r) => r.reliable) ? s.reliableRenew(rows.find((r) => r.reliable)!.tenant.fullName, rows.find((r) => r.reliable)!.daysRemaining, null) : undefined, actions: rows.slice(0, 2).map((r) => act("renew_contract", s.renewName(r.tenant.fullName.split(" ")[0]), r.contract.id)) });
  }

  /* Lowest occupancy building */
  if (/\b(lowest|worst|least|weakest)\b/.test(q) && /\b(occupan\w*|occupied|full)\b/.test(q)) {
    const rows = getPropertyPerformance(store, base).rows.map((r) => ({ id: r.id, name: r.name, units: r.units, rented: r.rented, occ: r.units > 0 ? r.rented / r.units : 0 })).sort((a, b) => a.occ - b.occ);
    if (rows.length === 0) return local({ text: s.buildingNone });
    const [w, n] = rows;
    return local({ text: v.lowestOccupancy(w.name, s.pct(w.occ), w.units - w.rented, w.units, n?.name ?? null, n ? s.pct(n.occ) : ""), table: { columns: [v.cols.building, v.cols.occupancy, v.cols.vacant], rows: rows.map((r) => [r.name, s.pct(r.occ), r.units - r.rented]) }, actions: [act("view_property", s.openName(w.name), w.id)] });
  }

  /* Longest vacant */
  if (/\b(vacant|empty|unoccupied)\b/.test(q) && /\b(longest|oldest|most days|how long)\b/.test(q)) {
    const rows = getVacantUnits(store, 0, scopeId);
    if (rows.length === 0) return local({ text: v.longestVacantNone(scopeLabel) });
    const top = rows[0];
    return local({ text: v.longestVacant(`${top.property.name} ${top.unit.unitNumber}`, top.daysVacant, rows.length, scopeLabel), table: { columns: [v.cols.unit, v.cols.days, v.cols.asking, v.cols.amount], rows: rows.slice(0, 10).map((r) => [`${r.property.name} · ${r.unit.unitNumber}`, r.daysVacant, s.money(r.askingRent), s.money(r.lostRevenue)]) }, recommendation: s.fillUnit(`${top.property.name} ${top.unit.unitNumber}`, top.daysVacant, s.money(top.askingRent)), actions: [act("view_unit", s.viewUnit(top.unit.unitNumber), top.unit.id)] });
  }

  /* Most profitable building */
  if (/\b(most|highest|best|least|lowest|worst)\b.*\b(profit\w*|noi|margin|net)\b|\b(profit\w*|noi)\b.*\b(rank|compare|which building)\b|\bwhich building (is|makes) (the )?most\b/.test(q)) {
    const cmp = getPortfolioComparison(store, /\b(12|twelve) months|last year|trailing\b/.test(q) ? "12m" : "ytd", base);
    if (!cmp.best || !cmp.worst) return local({ text: s.buildingNone });
    return local({ text: v.mostProfitable(cmp.best.property.name, s.money(cmp.best.noi), s.pct(cmp.best.margin), cmp.worst.property.name, s.money(cmp.worst.noi), cmp.window === "ytd" ? v.ytd : v.last12), table: { columns: [v.cols.building, v.cols.income, v.cols.expenses, v.cols.noi, v.cols.margin, v.cols.occupancy], rows: cmp.rows.map((r) => [r.property.name, s.money(r.revenue), s.money(r.operatingExpenses), s.money(r.noi), s.pct(r.margin), s.pct(r.occupancy)]) }, actions: [act("view_property", s.openName(cmp.best.property.name), cmp.best.property.id)] });
  }

  /* Building income this year */
  if (e.propertyNamed && e.property && /\b(make|made|earn\w*|income|revenue|noi|profit\w*|net)\b/.test(q)) {
    const fin = getPropertyFinancials(store, e.property.id, 12, base);
    const twelve = /\b(12|twelve) months|trailing\b/.test(q);
    const f = twelve ? fin.trailing12 : fin.ytd;
    return local({ text: v.buildingIncome(e.property.name, twelve ? v.last12 : v.ytd, s.money(f.income), s.money(f.operating), s.money(f.noi), s.pct(f.margin)), table: { columns: [v.cols.month, v.cols.income, v.cols.expenses, v.cols.noi], rows: fin.months.slice(-6).map((m) => [s.month(m.period), s.money(m.income), s.money(m.operatingExpenses), s.money(m.noi)]) }, actions: [act("view_property", s.openName(e.property.name), e.property.id)] });
  }

  /* Unit with the highest maintenance cost */
  if (/\b(unit|apartment|flat)s?\b/.test(q) && /\b(cost|expensive|maintenance|repairs?)\b/.test(q) && /\b(most|highest|top|biggest)\b/.test(q)) {
    const from = `${Number(base.slice(0, 4)) - 1}${base.slice(4)}`;
    const spend = new Map<string, { cost: number; jobs: number }>();
    const bump = (unitId: string, cost: number, job: boolean) => {
      const cur = spend.get(unitId) ?? { cost: 0, jobs: 0 };
      cur.cost += cost;
      if (job) cur.jobs += 1;
      spend.set(unitId, cur);
    };
    const linked = new Set(store.expenses.filter((x) => !x.deleted && x.workOrderId).map((x) => x.workOrderId));
    for (const x of store.expenses) if (!x.deleted && x.unitId && x.expenseDate >= from && (x.workOrderId || MAINTENANCE_CATEGORIES.has(x.category)) && (!scopeId || x.propertyId === scopeId)) bump(x.unitId, x.amount, false);
    for (const w of store.workOrders) {
      if (!w.unitId || w.status === "cancelled" || w.reportedAt < from || (scopeId && w.propertyId !== scopeId)) continue;
      bump(w.unitId, linked.has(w.id) ? 0 : w.actualCost ?? 0, true);
    }
    const rankings = getUnitRankings(store, "12m", scopeId, base);
    const rows = [...spend.entries()].filter(([, x]) => x.cost > 0).map(([unitId, x]) => ({ unit: idx.unitById.get(unitId)!, property: idx.propertyById.get(idx.unitById.get(unitId)!.propertyId)!, cost: x.cost, jobs: x.jobs, net: rankings.find((r) => r.unit.id === unitId)?.net ?? null, tenant: rankings.find((r) => r.unit.id === unitId)?.tenant ?? null })).filter((r) => r.unit && r.property).sort((a, b) => b.cost - a.cost);
    if (rows.length === 0) return local({ text: v.unitMaintenanceNone(scopeLabel) });
    const top = rows[0];
    return local({ text: v.unitMaintenance(`${top.property.name} ${top.unit.unitNumber}`, s.money(top.cost), top.jobs, v.last12, scopeLabel), table: { columns: [v.cols.unit, v.cols.tenant, v.cols.maintenance, v.cols.jobs, v.cols.net], rows: rows.slice(0, 8).map((r) => [`${r.property.name} · ${r.unit.unitNumber}`, r.tenant ?? s.dash, s.money(r.cost), r.jobs, r.net !== null ? s.money(r.net) : s.dash]) }, actions: [act("view_unit", s.viewUnit(top.unit.unitNumber), top.unit.id)] });
  }

  /* Expense categories that increased */
  if (/\b(categor\w*)\b/.test(q) && /\b(increas\w*|up|rose|grew|higher|jump\w*|more)\b/.test(q)) {
    const cur = currentPeriod();
    const prev = previousPeriod(cur);
    const sumBy = (period: string) => {
      const m = new Map<string, number>();
      for (const r of getExpenses(store, { period, propertyId: scopeId }, base)) m.set(r.expense.category, (m.get(r.expense.category) ?? 0) + r.expense.amount);
      return m;
    };
    const a = sumBy(cur);
    const b = sumBy(prev);
    const rows = [...new Set([...a.keys(), ...b.keys()])].map((c) => ({ c, now: a.get(c) ?? 0, before: b.get(c) ?? 0 })).filter((r) => r.now > r.before).sort((x, y) => y.now - y.before - (x.now - x.before));
    if (rows.length === 0) return local({ text: v.categoriesUpNone(s.month(cur), s.month(prev)) });
    return local({ text: v.categoriesUp(rows.length, s.month(cur), s.month(prev)), table: { columns: [v.cols.category, s.month(prev), s.month(cur), v.cols.change], rows: rows.map((r) => [labelize(r.c), s.money(r.before), s.money(r.now), `+${s.money(r.now - r.before)}`]) } });
  }

  /* Spend on a category */
  const cat = expenseCategoryIn(q);
  if (cat && /\b(spend|spent|paid|pay|cost\w*|how much)\b/.test(q) && !/\bsupplier|contractor|technician\b/.test(q)) {
    const { year, label } = yearIn(q, base);
    const rows = getExpenses(store, { category: cat, period: year, propertyId: scopeId }, base);
    const total = rows.reduce((n, r) => n + r.expense.amount, 0);
    const byBuilding = new Map<string, number>();
    for (const r of rows) byBuilding.set(r.property.name, (byBuilding.get(r.property.name) ?? 0) + r.expense.amount);
    const top = [...byBuilding.entries()].sort((x, y) => y[1] - x[1])[0];
    return local({ text: v.categorySpend(labelize(cat).toLowerCase(), label(s), s.money(total), rows.length, scopeLabel, top && byBuilding.size > 1 ? `${top[0]} (${s.money(top[1])})` : null), table: rows.length > 0 ? { columns: [v.cols.date, v.cols.building, v.cols.supplier, v.cols.amount], rows: rows.slice(0, 10).map((r) => [s.date(r.expense.expenseDate), r.property.name, r.supplier?.name ?? s.dash, s.money(r.expense.amount)]) } : undefined });
  }

  /* Cash flow */
  if (/\b(cash ?flow|forecast|projection|projected|expected (income|cash|money)|coming months?)\b/.test(q) && !/\b(contract|lease|expir)/.test(q)) {
    const days = e.days ?? (/\bmonths?\b/.test(q) && e.days === null ? 90 : 90);
    const months = Math.max(1, Math.min(12, Math.ceil(days / 30)));
    const f = getCashFlowForecast(store, { months, propertyId: scopeId }, base);
    return local({ text: v.cashflow(months * 30, s.money(f.totals.inflows), s.money(f.totals.outflows), `${f.totals.net >= 0 ? "+" : ""}${s.money(f.totals.net)}`, f.totals.rentAtRisk > 0 ? s.money(f.totals.rentAtRisk) : null), table: { columns: [v.cols.month, v.cols.inflow, v.cols.outflow, v.cols.net], rows: f.months.map((m) => [s.month(m.period), s.money(m.inflows), s.money(m.outflows), `${m.net >= 0 ? "+" : ""}${s.money(m.net)}`]) }, suggestions: [s.suggestions.unpaid, s.suggestions.expiring] });
  }

  /* Overdue maintenance */
  if (/\b(maintenance|work orders?|jobs?|repairs?|tickets?)\b/.test(q) && /\b(overdue|late|stuck|too long|old|open|outstanding|pending|backlog)\b/.test(q)) {
    const rows = getWorkOrders(store, { propertyId: scopeId, status: "open" }, base).filter((r) => r.overdue || /\b(open|outstanding|pending|backlog)\b/.test(q)).sort((a, b) => b.ageDays - a.ageDays);
    if (rows.length === 0) return local({ text: v.maintenanceOverdueNone(scopeLabel) });
    return local({ text: v.maintenanceOverdue(rows.length, scopeLabel, rows[0].workOrder.title, rows[0].ageDays), table: { columns: [v.cols.title, v.cols.where, v.cols.status, v.cols.age, v.cols.supplier], rows: rows.slice(0, 12).map((r) => [`${r.workOrder.number} ${r.workOrder.title}`, `${r.property.name}${r.unit ? ` · ${r.unit.unitNumber}` : ""}`, labelize(r.workOrder.status), r.ageDays, r.supplier?.name ?? s.dash]) }, actions: [act("view_work_order", v.labels.open, rows[0].workOrder.id), ...(rows.find((r) => r.workOrder.status === "awaiting_approval") ? [act("approve_work_order", v.labels.approve, rows.find((r) => r.workOrder.status === "awaiting_approval")!.workOrder.id)] : [])] });
  }

  /* Repeat issues */
  if (/\b(recurr\w*|repeat\w*|again and again|keeps? (breaking|failing|happening|coming back)|chronic|same problem)\b/.test(q) && /\b(unit|apartment|problem|issue|plumb|electric|hvac|elevator|generator|leak)/.test(q) && !/\b(supplier|contractor|technician|vendor)s?\b/.test(q)) {
    const windowDays = store.settings.thresholds.repeatIssueWindowDays;
    const category = workCategoryIn(q);
    const groups = new Map<string, { unit: string; property: string; unitId: string; category: string; count: number }>();
    for (const w of store.workOrders) {
      if (w.status === "cancelled" || !w.unitId || daysBetween(w.reportedAt, base) > windowDays || (scopeId && w.propertyId !== scopeId) || (category && w.category !== category)) continue;
      const key = `${w.unitId}|${w.category}`;
      const g = groups.get(key) ?? { unit: idx.unitById.get(w.unitId)?.unitNumber ?? "", property: idx.propertyById.get(w.propertyId)?.name ?? "", unitId: w.unitId, category: w.category, count: 0 };
      g.count += 1;
      groups.set(key, g);
    }
    const rows = [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
    const label = category ? labelize(category).toLowerCase() : lang === "ar" ? "الصيانة" : "maintenance";
    if (rows.length === 0) return local({ text: v.repeatIssuesNone(label, windowDays) });
    return local({ text: v.repeatIssues(rows.length, label, windowDays), table: { columns: [v.cols.unit, v.cols.category, v.cols.jobs], rows: rows.map((g) => [`${g.property} · ${g.unit}`, labelize(g.category), g.count]) }, actions: [act("view_unit", s.viewUnit(rows[0].unit), rows[0].unitId), act("create_work_order", v.labels.createWo, rows[0].unitId)] });
  }

  /* Assets needing service */
  if (/\b(assets?|equipment|service\w*|preventive|maintenance plan)\b/.test(q) && /\b(due|need\w*|schedul\w*|overdue|this month|soon|upcoming)\b/.test(q)) {
    const days = e.days ?? 30;
    const rows = getPreventivePlans(store, { propertyId: scopeId }, base).filter((r) => r.state !== "paused" && r.daysUntil <= days).sort((a, b) => a.daysUntil - b.daysUntil);
    if (rows.length === 0) return local({ text: v.assetsDueNone(days) });
    const cost = rows.reduce((n, r) => n + (r.plan.estimatedCost ?? 0), 0);
    return local({ text: v.assetsDue(rows.length, days, s.money(cost)), table: { columns: [v.cols.service, v.cols.asset, v.cols.building, v.cols.due, v.cols.cost], rows: rows.slice(0, 12).map((r) => [r.plan.maintenanceType, r.asset?.name ?? s.dash, r.property.name, `${s.date(r.plan.nextServiceDate)}${r.daysUntil < 0 ? ` (${Math.abs(r.daysUntil)}d late)` : ""}`, r.plan.estimatedCost ? s.money(r.plan.estimatedCost) : s.dash]) }, actions: [act("schedule_service", v.labels.logService, rows[0].plan.id), ...(rows[0].asset ? [act("view_asset", v.labels.open, rows[0].asset.id)] : [])] });
  }

  /* Supplier spend */
  const supplier = supplierIn(store, q);
  if (/\b(supplier|contractor|technician|vendor|paid|pay|spend|spent)\b/.test(q) && supplier && /\b(paid|pay|spend|spent|cost|how much|invoices?)\b/.test(q)) {
    const { year, label } = yearIn(q, base);
    const rows = getExpenses(store, { supplierId: supplier.id, period: year }, base);
    const total = rows.reduce((n, r) => n + r.expense.amount, 0);
    return local({ text: v.supplierPaid(supplier.name, label(s), s.money(total), rows.length), table: rows.length > 0 ? { columns: [v.cols.date, v.cols.building, v.cols.category, v.cols.amount], rows: rows.slice(0, 10).map((r) => [s.date(r.expense.expenseDate), r.property.name, labelize(r.expense.category), s.money(r.expense.amount)]) } : undefined, actions: [act("view_supplier", s.openName(supplier.name), supplier.id)] });
  }

  /* Supplier performance */
  if (/\b(supplier|contractor|technician|vendor)s?\b/.test(q) && /\b(repeat|worst|best|highest|lowest|rate|perform\w*|reliab\w*|score|rank|compare)\b/.test(q)) {
    const rows = getSuppliers(store).filter((r) => r.repeatIssueRate !== null || r.score !== null);
    if (rows.length === 0) return local({ text: v.suppliersNone });
    const byRepeat = [...rows].sort((a, b) => (b.repeatIssueRate ?? 0) - (a.repeatIssueRate ?? 0));
    const worst = byRepeat[0];
    const best = [...rows].filter((r) => r.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    return local({ text: v.suppliers(worst.supplier.name, s.pct(worst.repeatIssueRate ?? 0), worst.completedJobs, best && best.supplier.id !== worst.supplier.id ? `${best.supplier.name} (${best.score}/100)` : null), table: { columns: [v.cols.supplier, v.cols.score, v.cols.repeat, v.cols.jobs, v.cols.spend], rows: byRepeat.slice(0, 10).map((r) => [r.supplier.name, r.score ?? s.dash, r.repeatIssueRate !== null ? s.pct(r.repeatIssueRate) : s.dash, r.completedJobs, s.money(r.totalSpend)]) }, actions: [act("view_supplier", s.openName(worst.supplier.name), worst.supplier.id)] });
  }

  /* A supplier named on its own: their card */
  if (supplier && /\b(supplier|contractor|technician|about|who is|tell me)\b/.test(q)) {
    const row = getSuppliers(store).find((r) => r.supplier.id === supplier.id);
    if (row) return local({ text: `${supplier.name} · ${labelize(supplier.category)} · ${row.completedJobs} ${v.cols.jobs.toLowerCase()} · ${s.money(row.totalSpend)}`, cards: [{ title: supplier.name, subtitle: labelize(supplier.category), fields: [[v.cols.score, row.score !== null ? `${row.score}/100 · ${row.scoreLabel}` : s.dash], [v.cols.repeat, row.repeatIssueRate !== null ? s.pct(row.repeatIssueRate) : s.dash], [v.cols.jobs, `${row.completedJobs} / ${row.jobs}`], [v.cols.spend, s.money(row.totalSpend)]] }], actions: [act("view_supplier", s.openName(supplier.name), supplier.id)] });
  }

  void periodOf;
  void context;
  return null;
}
