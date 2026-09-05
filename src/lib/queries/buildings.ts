import { indexStore } from "@/lib/data/store";
import { daysSince, daysUntil, lastPeriods, periodOf, today } from "@/lib/date";
import { buildingHealth, collectionRate, isUnpaid, noiFor, sum, vacancyLoss, type CollectionRate, type HealthScore, type NoiResult } from "@/lib/derived/metrics";
import { isOccupying, occupyingAt } from "@/lib/derived/occupancy";
import { formatMoney } from "@/lib/format";
import type { Alert, ID, ISODate, Store } from "@/types";

import { contractRow, type ContractRow, type TimelineEvent } from "./entities";
import { getAlerts } from "./lists";
import {
  getBudgets,
  getDeposits,
  getExpenses,
  getPreventivePlans,
  getRenovations,
  getWorkOrders,
  summarizeDeposits,
  type BudgetRow,
  type DepositSummary,
  type ExpenseRow,
  type PlanRow,
  type RenovationRow,
  type WorkOrderRow,
} from "./operations";

/* ------------------------------ Overview ---------------------------------- */

export interface PropertyOverview {
  health: HealthScore;
  thisMonth: NoiResult;
  lastMonth: NoiResult;
  collection: CollectionRate;
  rentRoll: number;
  outstanding: number;
  overdueCount: number;
  openWorkOrders: WorkOrderRow[];
  emergencies: number;
  awaitingApproval: number;
  upcomingServices: PlanRow[];
  expiring30: ContractRow[];
  expiring60: number;
  vacantUnits: number;
  vacancyLossEstimate: number;
  alerts: Alert[];
  liveRenovations: RenovationRow[];
  deposits: DepositSummary;
  unpaidExpenses: ExpenseRow[];
}

export function getPropertyOverview(store: Store, propertyId: ID, base: ISODate = today()): PropertyOverview {
  const idx = indexStore(store);
  const period = periodOf(base);
  const units = idx.unitsByProperty.get(propertyId) ?? [];
  const payments = store.payments.filter((p) => p.propertyId === propertyId);
  const contracts = store.contracts.filter((c) => c.propertyId === propertyId);

  const seen = new Set<ID>();
  let rentRoll = 0;
  for (const c of contracts) {
    if (seen.has(c.unitId) || !occupyingAt(c, base)) continue;
    seen.add(c.unitId);
    rentRoll += c.monthlyRent;
  }
  const unpaid = payments.filter(isUnpaid);
  const openWorkOrders = getWorkOrders(store, { propertyId, status: "open" }, base);
  const expiring = contracts
    .filter((c) => isOccupying(c) && c.endDate >= base)
    .map((c) => ({ c, d: daysUntil(c.endDate) }));
  const vacant = units.filter((u) => u.status === "available");

  return {
    health: buildingHealth(store, propertyId, base),
    thisMonth: noiFor(store, period, propertyId),
    lastMonth: noiFor(store, lastPeriods(2, period)[0], propertyId),
    collection: collectionRate(payments, period, base),
    rentRoll,
    outstanding: sum(unpaid.map((p) => p.amountDue - p.amountPaid)),
    overdueCount: unpaid.length,
    openWorkOrders,
    emergencies: openWorkOrders.filter((w) => w.workOrder.priority === "emergency").length,
    awaitingApproval: openWorkOrders.filter((w) => w.workOrder.status === "awaiting_approval").length,
    upcomingServices: getPreventivePlans(store, { propertyId }, base).filter((p) => p.state === "overdue" || p.state === "due_soon"),
    expiring30: expiring
      .filter((x) => x.d <= 30)
      .map((x) => contractRow(store, x.c))
      .filter((x): x is ContractRow => x !== null)
      .sort((a, b) => a.daysRemaining - b.daysRemaining),
    expiring60: expiring.filter((x) => x.d <= 60).length,
    vacantUnits: vacant.length,
    vacancyLossEstimate: sum(vacant.map((u) => vacancyLoss(u, base).loss)),
    alerts: getAlerts(store, { propertyId }).filter((a) => !a.resolved),
    liveRenovations: getRenovations(store, { propertyId, status: "live" }, base),
    deposits: summarizeDeposits(getDeposits(store, { propertyId })),
    unpaidExpenses: getExpenses(store, { propertyId, status: "unpaid" }, base),
  };
}

/* ------------------------------ Financials -------------------------------- */

export interface FinancialMonth extends NoiResult {
  occupancy: number;
}

export interface PropertyFinancials {
  months: FinancialMonth[];
  ytd: { income: number; collected: number; operating: number; capex: number; noi: number; margin: number };
  trailing12: { income: number; operating: number; capex: number; noi: number; margin: number };
  thisMonth: NoiResult;
  lastMonth: NoiResult;
  budgets: BudgetRow[];
  byCategory: { category: string; amount: number; share: number }[];
  recentExpenses: ExpenseRow[];
}

function occupancyOn(store: Store, propertyId: ID, d: ISODate): number {
  const idx = indexStore(store);
  const units = (idx.unitsByProperty.get(propertyId) ?? []).filter((u) => u.status !== "unavailable");
  if (units.length === 0) return 0;
  const ids = new Set(units.map((u) => u.id));
  const occupied = new Set<ID>();
  for (const c of store.contracts) if (ids.has(c.unitId) && occupyingAt(c, d)) occupied.add(c.unitId);
  return occupied.size / units.length;
}

export function getPropertyFinancials(store: Store, propertyId: ID | undefined, monthCount = 12, base: ISODate = today()): PropertyFinancials {
  const period = periodOf(base);
  const periods = lastPeriods(monthCount, period);
  const months: FinancialMonth[] = periods.map((p) => {
    const noi = noiFor(store, p, propertyId);
    const end = p === period ? base : `${p}-28`;
    const occupancy = propertyId ? occupancyOn(store, propertyId, end) : (() => {
      const all = store.properties.map((x) => occupancyOn(store, x.id, end));
      return all.length > 0 ? sum(all) / all.length : 0;
    })();
    return { ...noi, occupancy };
  });
  const year = base.slice(0, 4);
  const ytdMonths = months.filter((m) => m.period.startsWith(year));
  const total = (rows: FinancialMonth[], key: keyof NoiResult) => sum(rows.map((m) => Number(m[key])));
  const ytdIncome = total(ytdMonths, "income");
  const ytdOperating = total(ytdMonths, "operating" as keyof NoiResult) || total(ytdMonths, "operatingExpenses");
  const t12Income = total(months, "income");
  const t12Operating = total(months, "operatingExpenses");
  const byCategory = new Map<string, number>();
  const trailing = getExpenses(store, { propertyId, classification: "operating", from: `${periods[0]}-01`, to: base }, base);
  for (const r of trailing) byCategory.set(r.expense.category, (byCategory.get(r.expense.category) ?? 0) + r.expense.amount);
  const categoryTotal = sum([...byCategory.values()]);

  return {
    months,
    ytd: {
      income: ytdIncome,
      collected: total(ytdMonths, "collected"),
      operating: ytdOperating,
      capex: total(ytdMonths, "capex"),
      noi: ytdIncome - ytdOperating,
      margin: ytdIncome > 0 ? (ytdIncome - ytdOperating) / ytdIncome : 0,
    },
    trailing12: { income: t12Income, operating: t12Operating, capex: total(months, "capex"), noi: t12Income - t12Operating, margin: t12Income > 0 ? (t12Income - t12Operating) / t12Income : 0 },
    thisMonth: months[months.length - 1],
    lastMonth: months[months.length - 2] ?? months[months.length - 1],
    budgets: getBudgets(store, { propertyId }).filter((b) => b.budget.period === period || b.budget.period === year),
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount, share: categoryTotal > 0 ? amount / categoryTotal : 0 })).sort((a, b) => b.amount - a.amount),
    recentExpenses: getExpenses(store, { propertyId, from: lastPeriods(3, period)[0] + "-01" }, base).slice(0, 25),
  };
}

/* ------------------------------- Timeline --------------------------------- */

/**
 * Everything notable that happened in a building — tenants in and out,
 * money overdue, maintenance opened and closed, services, inspections,
 * renovations, documents, settlements — newest first.
 */
export function getPropertyTimeline(store: Store, propertyId: ID, limit = 120, base: ISODate = today()): TimelineEvent[] {
  const idx = indexStore(store);
  const events: TimelineEvent[] = [];
  const name = (tenantId: ID) => idx.tenantById.get(tenantId)?.fullName ?? "Tenant";
  const unitNo = (unitId: ID | null) => (unitId ? idx.unitById.get(unitId)?.unitNumber ?? "" : "");
  const money = (n: number) => formatMoney(n);

  for (const c of store.contracts) {
    if (c.propertyId !== propertyId) continue;
    const renewal = c.renewedFromContractId !== null;
    if (c.startDate <= base) {
      events.push({ id: `c-start-${c.id}`, at: c.startDate, title: renewal ? `Contract renewed — ${name(c.tenantId)} · ${unitNo(c.unitId)}` : `${name(c.tenantId)} moved into ${unitNo(c.unitId)}`, detail: `${c.contractNumber} · ${c.durationMonths} months · ${money(c.monthlyRent)}/month`, tone: "success", kind: "contract" });
    }
    const leftOn = c.moveOutDate ?? (c.status === "expired" || c.status === "terminated" ? c.endDate : null);
    if (leftOn && leftOn <= base && c.status !== "renewed" && !isOccupying(c)) {
      events.push({ id: `c-end-${c.id}`, at: leftOn, title: `${name(c.tenantId)} moved out of ${unitNo(c.unitId)}`, detail: `${c.contractNumber} ended${c.status === "terminated" ? " early" : ""}`, tone: "warning", kind: "contract" });
    }
  }

  for (const p of store.payments) {
    if (p.propertyId !== propertyId) continue;
    if (p.status === "overdue" && p.daysLate > 0) events.push({ id: `p-${p.id}`, at: p.dueDate, title: `Rent overdue — ${name(p.tenantId)} · ${unitNo(p.unitId)}`, detail: `${money(p.amountDue)} for ${p.periodMonth} · ${p.daysLate} days late`, tone: "critical", kind: "payment" });
    else if (p.status === "paid" && p.paidDate && p.daysLate > 7) events.push({ id: `p-${p.id}`, at: p.paidDate, title: `Rent paid ${p.daysLate} days late — ${name(p.tenantId)} · ${unitNo(p.unitId)}`, detail: `${money(p.amountPaid)} for ${p.periodMonth}`, tone: "warning", kind: "payment" });
  }

  for (const w of store.workOrders) {
    if (w.propertyId !== propertyId) continue;
    const where = w.unitId ? unitNo(w.unitId) : w.assetId ? idx.assetById.get(w.assetId)?.name ?? "building" : "building";
    events.push({ id: `wo-open-${w.id}`, at: w.reportedAt, title: `${w.priority === "emergency" ? "Emergency reported" : "Work order opened"} — ${w.title}`, detail: `${w.number} · ${where} · ${w.category}${w.supplierId ? ` · ${idx.supplierById.get(w.supplierId)?.name ?? ""}` : ""}`, tone: w.priority === "emergency" ? "critical" : "info", kind: "maintenance" });
    if (w.completedAt) events.push({ id: `wo-done-${w.id}`, at: w.completedAt, title: `Work completed — ${w.title}`, detail: `${w.number} · ${where}${w.actualCost ? ` · ${money(w.actualCost)}` : ""}`, tone: "success", kind: "maintenance" });
  }

  for (const plan of store.preventivePlans) {
    if (plan.propertyId !== propertyId || !plan.lastServiceDate) continue;
    const asset = plan.assetId ? idx.assetById.get(plan.assetId)?.name : null;
    events.push({ id: `pm-${plan.id}`, at: plan.lastServiceDate, title: `${plan.maintenanceType}${asset ? ` — ${asset}` : ""}`, detail: `Serviced${plan.supplierId ? ` by ${idx.supplierById.get(plan.supplierId)?.name ?? ""}` : ""} · next ${plan.nextServiceDate}`, tone: "default", kind: "asset" });
  }

  for (const i of store.inspections) {
    if (i.propertyId !== propertyId) continue;
    const at = i.completedDate ?? i.scheduledDate;
    if (at > base) continue;
    const failed = i.items.filter((x) => x.result === "fail").length;
    events.push({ id: `insp-${i.id}`, at, title: `${i.type.replace("_", " ")} inspection ${i.status === "completed" ? `${i.overallResult ?? "completed"}` : i.status}${i.unitId ? ` — ${unitNo(i.unitId)}` : ""}`, detail: `${i.inspector}${failed > 0 ? ` · ${failed} failed item${failed === 1 ? "" : "s"}` : ""}`, tone: i.overallResult === "fail" ? "critical" : i.overallResult === "attention" ? "warning" : "default", kind: "inspection" });
  }

  for (const r of store.renovations) {
    if (r.propertyId !== propertyId) continue;
    if (r.startDate <= base) events.push({ id: `rn-start-${r.id}`, at: r.startDate, title: `${r.status === "planned" ? "Renovation planned" : "Renovation started"} — ${r.title}`, detail: `Budget ${money(r.budget)}${r.unitId ? ` · ${unitNo(r.unitId)}` : ""}`, tone: "info", kind: "renovation" });
    if (r.actualEndDate && r.actualEndDate <= base) events.push({ id: `rn-end-${r.id}`, at: r.actualEndDate, title: `Renovation completed — ${r.title}`, detail: `${money(r.actualCost)} spent vs ${money(r.budget)} budget`, tone: r.actualCost > r.budget ? "warning" : "success", kind: "renovation" });
  }

  for (const e of store.expenses) {
    if (e.propertyId !== propertyId || e.deleted || e.workOrderId || e.recurring || e.amount < 1000) continue;
    events.push({ id: `e-${e.id}`, at: e.expenseDate, title: `${e.classification === "capex" ? "CapEx" : "Expense"} — ${e.description}`, detail: `${money(e.amount)} · ${e.category}${e.supplierId ? ` · ${idx.supplierById.get(e.supplierId)?.name ?? ""}` : ""}`, tone: "default", kind: "expense" });
  }

  for (const d of store.deposits) {
    if (d.propertyId !== propertyId || !d.settlementDate) continue;
    events.push({ id: `dep-${d.id}`, at: d.settlementDate, title: `Deposit settled — ${name(d.tenantId)} · ${unitNo(d.unitId)}`, detail: `${money(d.finalRefund ?? 0)} refunded${d.deductions.length > 0 ? ` · ${money(sum(d.deductions.map((x) => x.amount)))} deducted` : ""}`, tone: "default", kind: "deposit" });
  }

  for (const d of store.documents) {
    if (d.deleted || d.propertyId !== propertyId || d.tenantId || d.generated) continue;
    events.push({ id: `d-${d.id}`, at: d.uploadedAt, title: `Document added — ${d.title}`, detail: d.fileName, tone: "info", kind: "document" });
  }

  for (const a of store.activity) {
    if (a.propertyId === propertyId) events.push({ id: `a-${a.id}`, at: a.at, title: a.message, detail: `by ${a.actor}`, tone: "info", kind: "activity" });
  }

  return events
    .filter((e) => e.at.slice(0, 10) <= base)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

export { daysSince };
