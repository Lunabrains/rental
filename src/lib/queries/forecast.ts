import { indexStore } from "@/lib/data/store";
import { addMonthsISO, addPeriods, daysUntil, periodEnd, periodOf, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import { vacancyLoss } from "@/lib/derived/metrics";
import { FREQUENCY_MONTHS, type Contract, type ID, type ISODate, type PeriodMonth, type Property, type Store, type Tenant, type Unit } from "@/types";

export type ForecastKind = "rent" | "rent_at_risk" | "other_income" | "expense_due" | "expense_recurring" | "service" | "capex" | "deposit_refund";

export interface ForecastItem {
  kind: ForecastKind;
  label: string;
  detail: string;
  date: ISODate;
  amount: number;
  /** Positive = money in, negative = money out. */
  direction: "in" | "out";
  propertyId: ID | null;
  unitId: ID | null;
  tenantId: ID | null;
  /** Entity behind the line, for drill-down. */
  ref: { type: "payment" | "expense" | "plan" | "renovation" | "deposit" | "contract"; id: ID } | null;
  /** Projected from a pattern rather than a booked record. */
  projected: boolean;
}

export interface ForecastMonth {
  period: PeriodMonth;
  rentExpected: number;
  rentAtRisk: number;
  otherIncome: number;
  expensesDue: number;
  expensesRecurring: number;
  services: number;
  capex: number;
  depositRefunds: number;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
  items: ForecastItem[];
}

export interface CashFlowForecast {
  from: ISODate;
  to: ISODate;
  months: ForecastMonth[];
  totals: { inflows: number; rentAtRisk: number; outflows: number; capex: number; net: number };
  /** Trailing collection rate used to size the "likely collected" figure. */
  collectionRate: number;
  likelyCollected: number;
  /** Rent the vacant units would bring in per month at their reference rent. */
  vacancyRunRate: number;
}

const OTHER_INCOME_CATEGORIES = new Set<string>([]);

/** Latest booked occurrence for each recurring pattern (property + category + description). */
function recurringPatterns(store: Store, propertyId?: ID) {
  const latest = new Map<string, Store["expenses"][number]>();
  for (const e of store.expenses) {
    if (e.deleted || !e.recurring || (propertyId && e.propertyId !== propertyId)) continue;
    const key = `${e.propertyId}|${e.category}|${e.description.replace(/ — .*$/, "").toLowerCase()}`;
    const cur = latest.get(key);
    if (!cur || e.expenseDate > cur.expenseDate) latest.set(key, e);
  }
  return [...latest.values()];
}

/**
 * Month-by-month cash view for the coming horizon (plan §Phase 13): scheduled rent,
 * rent whose contract ends without a renewal, unpaid and projected expenses,
 * preventive services, remaining CapEx and deposits due back. Everything is an
 * estimate built from the records — nothing is invented.
 */
export function getCashFlowForecast(store: Store, opts: { months?: number; propertyId?: ID } = {}, base: ISODate = today()): CashFlowForecast {
  const idx = indexStore(store);
  const monthsAhead = Math.max(1, Math.min(12, opts.months ?? Math.ceil(store.settings.thresholds.forecastHorizonDays / 30)));
  const propertyId = opts.propertyId;
  const first = periodOf(base);
  const periods: PeriodMonth[] = Array.from({ length: monthsAhead }, (_, i) => addPeriods(first, i));
  const to = periodEnd(periods[periods.length - 1]);
  const inScope = (pid: ID) => !propertyId || pid === propertyId;
  const byPeriod = new Map<PeriodMonth, ForecastItem[]>(periods.map((p) => [p, []]));
  const push = (item: ForecastItem) => {
    const p = periodOf(item.date);
    const bucket = byPeriod.get(p < first ? first : p);
    if (bucket) bucket.push(item);
  };
  const name = (id: ID | null) => (id ? idx.tenantById.get(id)?.fullName ?? "Tenant" : "—");
  const place = (pid: ID, uid: ID | null) => `${idx.propertyById.get(pid)?.name ?? ""}${uid ? ` ${idx.unitById.get(uid)?.unitNumber ?? ""}` : ""}`.trim();

  /* Rent: every open instalment falling due in the horizon, overdue ones land in the first month. */
  for (const p of store.payments) {
    if (!inScope(p.propertyId)) continue;
    if (p.status === "paid" || p.status === "waived") continue;
    const open = p.amountDue - p.amountPaid;
    if (open <= 0 || p.dueDate > to) continue;
    const c = idx.contractById.get(p.contractId);
    const ending = c ? (c.moveOutDate ?? c.endDate) : null;
    const atRisk = !!c && c.renewalDecision !== "renew" && ending !== null && ending <= to && p.dueDate > base && daysUntil(ending) <= 60 && p.status === "scheduled" && c.status !== "renewed";
    push({ kind: atRisk ? "rent_at_risk" : "rent", label: `${name(p.tenantId)} · ${place(p.propertyId, p.unitId)}`, detail: p.dueDate < base ? `Overdue since ${p.dueDate}` : `Due ${p.dueDate}${atRisk ? ` · contract ends ${ending}` : ""}`, date: p.dueDate < base ? base : p.dueDate, amount: open, direction: "in", propertyId: p.propertyId, unitId: p.unitId, tenantId: p.tenantId, ref: { type: "payment", id: p.id }, projected: false });
  }

  /* Rent beyond the schedule: renewed / long contracts always have payments; nothing to project. */

  /* Expenses: unpaid invoices by due date; recurring patterns projected forward. */
  const booked = new Set<string>();
  for (const e of store.expenses) {
    if (e.deleted || !inScope(e.propertyId)) continue;
    booked.add(`${e.propertyId}|${e.category}|${e.description.replace(/ — .*$/, "").toLowerCase()}|${periodOf(e.expenseDate)}`);
    if (e.paymentStatus === "paid") continue;
    const due = e.dueDate ?? e.expenseDate;
    if (due > to) continue;
    push({ kind: e.classification === "capex" ? "capex" : "expense_due", label: e.description, detail: `${place(e.propertyId, e.unitId)} · ${e.category.replace(/_/g, " ")}${due < base ? ` · overdue since ${due}` : ` · due ${due}`}`, date: due < base ? base : due, amount: e.amount, direction: "out", propertyId: e.propertyId, unitId: e.unitId, tenantId: null, ref: { type: "expense", id: e.id }, projected: false });
  }
  for (const e of recurringPatterns(store, propertyId)) {
    const step = FREQUENCY_MONTHS[e.recurrence ?? "monthly"] ?? 1;
    let next = addMonthsISO(e.expenseDate, step);
    let guard = 0;
    while (next <= to && guard++ < 24) {
      if (next >= base) {
        const key = `${e.propertyId}|${e.category}|${e.description.replace(/ — .*$/, "").toLowerCase()}|${periodOf(next)}`;
        if (!booked.has(key)) push({ kind: "expense_recurring", label: e.description.replace(/ — .*$/, ""), detail: `${place(e.propertyId, e.unitId)} · ${e.recurrence ?? "monthly"} · projected from ${e.expenseDate}`, date: next, amount: e.amount, direction: "out", propertyId: e.propertyId, unitId: e.unitId, tenantId: null, ref: { type: "expense", id: e.id }, projected: true });
      }
      next = addMonthsISO(next, step);
    }
  }

  /* Preventive services falling due. */
  for (const plan of store.preventivePlans) {
    if (plan.status !== "active" || !inScope(plan.propertyId) || !plan.estimatedCost) continue;
    const step = Math.max(1, plan.recurrenceMonths);
    let due = plan.nextServiceDate;
    let guard = 0;
    // An overdue service is one catch-up visit, not one per missed interval.
    if (due < base) {
      push({ kind: "service", label: plan.maintenanceType, detail: `${place(plan.propertyId, null)}${plan.assetId ? ` · ${idx.assetById.get(plan.assetId)?.name ?? ""}` : ""} · overdue since ${due}`, date: base, amount: plan.estimatedCost, direction: "out", propertyId: plan.propertyId, unitId: null, tenantId: null, ref: { type: "plan", id: plan.id }, projected: true });
      while (due <= base && guard++ < 120) due = addMonthsISO(due, step);
    }
    while (due <= to && guard++ < 24) {
      push({ kind: "service", label: plan.maintenanceType, detail: `${place(plan.propertyId, null)}${plan.assetId ? ` · ${idx.assetById.get(plan.assetId)?.name ?? ""}` : ""} · due ${due}`, date: due, amount: plan.estimatedCost, direction: "out", propertyId: plan.propertyId, unitId: null, tenantId: null, ref: { type: "plan", id: plan.id }, projected: true });
      due = addMonthsISO(due, step);
    }
  }

  /* Live projects: remaining budget spread evenly until the target end. */
  for (const r of store.renovations) {
    if (!inScope(r.propertyId) || (r.status !== "in_progress" && r.status !== "planned")) continue;
    const remaining = r.budget - r.actualCost;
    if (remaining <= 0) continue;
    const start = r.startDate > base ? r.startDate : base;
    const end = r.targetEndDate > start ? r.targetEndDate : start;
    // Spread evenly over the project's own remaining months; only the months inside the horizon are booked.
    const startP = periodOf(start);
    const endP = periodOf(end);
    const projectMonths = (Number(endP.slice(0, 4)) - Number(startP.slice(0, 4))) * 12 + (Number(endP.slice(5, 7)) - Number(startP.slice(5, 7))) + 1;
    const per = remaining / Math.max(1, projectMonths);
    for (const p of periods) {
      if (p < startP || p > endP) continue;
      push({ kind: "capex", label: r.title, detail: `${place(r.propertyId, r.unitId)} · remaining budget spread evenly to ${end}`, date: p === first ? base : `${p}-01`, amount: Math.round(per), direction: "out", propertyId: r.propertyId, unitId: r.unitId, tenantId: null, ref: { type: "renovation", id: r.id }, projected: true });
    }
  }

  /* Deposits due back when tenancies end. */
  for (const d of store.deposits) {
    if (!inScope(d.propertyId) || d.status === "settled" || d.amountHeld <= 0) continue;
    const c = idx.contractById.get(d.contractId);
    if (!c) continue;
    const ending = c.moveOutDate ?? c.endDate;
    if (!isOccupying(c) && ending < base) {
      push({ kind: "deposit_refund", label: `Deposit refund · ${name(d.tenantId)}`, detail: `${place(d.propertyId, d.unitId)} · tenancy ended ${ending}`, date: base, amount: d.amountHeld, direction: "out", propertyId: d.propertyId, unitId: d.unitId, tenantId: d.tenantId, ref: { type: "deposit", id: d.id }, projected: false });
    } else if (isOccupying(c) && c.renewalDecision !== "renew" && ending >= base && ending <= to && (c.status === "notice_given" || c.renewalDecision === "do_not_renew" || daysUntil(ending) <= 30)) {
      push({ kind: "deposit_refund", label: `Deposit refund · ${name(d.tenantId)}`, detail: `${place(d.propertyId, d.unitId)} · contract ends ${ending}`, date: ending, amount: d.amountHeld, direction: "out", propertyId: d.propertyId, unitId: d.unitId, tenantId: d.tenantId, ref: { type: "deposit", id: d.id }, projected: true });
    }
  }

  /* Roll up. */
  let cumulative = 0;
  const months: ForecastMonth[] = periods.map((period) => {
    const items = (byPeriod.get(period) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
    const sumKind = (k: ForecastKind) => items.filter((i) => i.kind === k).reduce((n, i) => n + i.amount, 0);
    const rentExpected = sumKind("rent");
    const rentAtRisk = sumKind("rent_at_risk");
    const otherIncome = sumKind("other_income");
    const expensesDue = sumKind("expense_due");
    const expensesRecurring = sumKind("expense_recurring");
    const services = sumKind("service");
    const capex = sumKind("capex");
    const depositRefunds = sumKind("deposit_refund");
    const inflows = rentExpected + rentAtRisk + otherIncome;
    const outflows = expensesDue + expensesRecurring + services + capex + depositRefunds;
    const net = inflows - outflows;
    cumulative += net;
    return { period, rentExpected, rentAtRisk, otherIncome, expensesDue, expensesRecurring, services, capex, depositRefunds, inflows, outflows, net, cumulative, items };
  });

  /* Collection rate over the last six closed months, for the "likely" figure. */
  let due = 0;
  let got = 0;
  const from6 = addPeriods(first, -6);
  for (const p of store.payments) {
    if (!inScope(p.propertyId) || p.periodMonth < from6 || p.periodMonth >= first || p.status === "waived") continue;
    due += p.amountDue;
    got += p.amountPaid;
  }
  const collectionRate = due > 0 ? Math.min(1, got / due) : 1;
  const inflows = months.reduce((n, m) => n + m.inflows, 0);
  const vacancyRunRate = store.units.filter((u) => inScope(u.propertyId) && u.status === "available").reduce((n, u) => n + vacancyLoss(u, base).referenceRent, 0);

  return {
    from: base,
    to,
    months,
    totals: { inflows, rentAtRisk: months.reduce((n, m) => n + m.rentAtRisk, 0), outflows: months.reduce((n, m) => n + m.outflows, 0), capex: months.reduce((n, m) => n + m.capex, 0), net: months.reduce((n, m) => n + m.net, 0) },
    collectionRate,
    likelyCollected: Math.round(inflows * collectionRate),
    vacancyRunRate,
  };
}

void OTHER_INCOME_CATEGORIES;

export interface VacancyCostRow {
  unit: Unit;
  property: Property;
  daysVacant: number;
  referenceRent: number;
  source: string;
  lostSoFar: number;
  /** What another 30 days empty would cost. */
  monthlyCost: number;
  /** Something is already planned for the unit (renovation, reserved). */
  note: string | null;
}

export interface VacancyCost {
  rows: VacancyCostRow[];
  totalLost: number;
  monthlyRunRate: number;
  /** Rent per month on contracts ending within 60 days with no renewal agreed. */
  atRiskMonthly: number;
  atRisk: { contract: Contract; tenant: Tenant | null; unit: Unit | null; property: Property | null; daysLeft: number }[];
}

/** What empty units cost, and what might empty next (plan §Phase 13 vacancy cost). */
export function getVacancyCost(store: Store, propertyId?: ID, base: ISODate = today()): VacancyCost {
  const idx = indexStore(store);
  const rows: VacancyCostRow[] = [];
  for (const u of store.units) {
    if (propertyId && u.propertyId !== propertyId) continue;
    if (u.status !== "available" && u.status !== "renovation" && u.status !== "maintenance") continue;
    const property = idx.propertyById.get(u.propertyId);
    if (!property) continue;
    const v = vacancyLoss(u, base);
    const project = store.renovations.find((r) => r.unitId === u.id && (r.status === "in_progress" || r.status === "planned"));
    rows.push({ unit: u, property, daysVacant: v.daysVacant, referenceRent: v.referenceRent, source: v.source, lostSoFar: v.loss, monthlyCost: v.referenceRent, note: project ? `${project.title} · target ${project.targetEndDate}` : u.status === "maintenance" ? "Under maintenance" : null });
  }
  rows.sort((a, b) => b.lostSoFar - a.lostSoFar);
  const atRisk = store.contracts
    .filter((c) => isOccupying(c) && (!propertyId || c.propertyId === propertyId) && c.renewalDecision !== "renew" && c.status !== "renewed")
    .map((c) => ({ contract: c, daysLeft: daysUntil(c.moveOutDate ?? c.endDate) }))
    .filter((x) => x.daysLeft <= 60)
    .map((x) => ({ ...x, tenant: idx.tenantById.get(x.contract.tenantId) ?? null, unit: idx.unitById.get(x.contract.unitId) ?? null, property: idx.propertyById.get(x.contract.propertyId) ?? null }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    rows,
    totalLost: rows.reduce((n, r) => n + r.lostSoFar, 0),
    monthlyRunRate: rows.reduce((n, r) => n + r.monthlyCost, 0),
    atRiskMonthly: atRisk.reduce((n, r) => n + r.contract.monthlyRent, 0),
    atRisk,
  };
}
