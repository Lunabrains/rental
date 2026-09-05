import { indexStore } from "@/lib/data/store";
import { addPeriods, daysBetween, daysSince, lastPeriods, periodEnd, periodOf, periodStart, today } from "@/lib/date";
import { arrearsAging, collectionRate, noiFor } from "@/lib/derived/metrics";
import { isOccupying } from "@/lib/derived/occupancy";
import type { ExportCell } from "@/lib/export";
import { labelize } from "@/lib/format";
import type { ID, ISODate, PeriodMonth, Property, Store, Supplier, WorkOrderCategory, WorkOrderPriority } from "@/types";

import { getContracts } from "./entities";
import { getRentRoll } from "./finance";
import { getAssets, getExpenses, getMaintenanceSummary, getSuppliers, getWorkOrders, type AssetRow, type MaintenanceSummary, type SupplierRow } from "./operations";
import { getRevenueHistory } from "./portfolio";
import { getPortfolioComparison } from "./profitability";

/* -------------------------------------------------------------------------- */
/* Portfolio trends                                                            */
/* -------------------------------------------------------------------------- */

export interface TrendPoint {
  period: PeriodMonth;
  occupancy: number;
  /** Rent due in the month. */
  expected: number;
  /** Cash received in the month. */
  collected: number;
  collectionRate: number;
  /** Unpaid rent at month end (due by then, not settled by then). */
  outstanding: number;
  operating: number;
  capex: number;
  noi: number;
  maintenance: number;
  /** Estimated rent lost to empty units during the month. */
  vacancyLoss: number;
}

const MAINTENANCE_CATEGORIES = new Set<string>(["maintenance", "elevator", "plumbing", "electrical", "hvac", "generator", "appliance", "painting", "pest_control"]);

/** Days of each month a unit sat empty, from the gaps between its contracts (and today's vacancy). */
function vacancyByMonth(store: Store, periods: PeriodMonth[], propertyId: ID | undefined, base: ISODate): Map<PeriodMonth, number> {
  const idx = indexStore(store);
  const out = new Map<PeriodMonth, number>(periods.map((p) => [p, 0]));
  for (const unit of store.units) {
    if (propertyId && unit.propertyId !== propertyId) continue;
    if (unit.status === "unavailable") continue;
    const contracts = (idx.contractsByUnit.get(unit.id) ?? []).slice().sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    if (contracts.length === 0 && !unit.availableSince) continue;
    const intervals = contracts.map((c) => ({ from: c.startDate, to: isOccupying(c) ? base : (c.moveOutDate ?? c.endDate), rent: c.monthlyRent }));
    const firstKnown = contracts[0]?.startDate ?? unit.availableSince ?? base;
    for (const p of periods) {
      const start = periodStart(p);
      const end = periodEnd(p) < base ? periodEnd(p) : base;
      if (end < start || end < firstKnown) continue;
      const from = start > firstKnown ? start : firstKnown;
      let covered = 0;
      for (const i of intervals) {
        const a = i.from > from ? i.from : from;
        const b = i.to < end ? i.to : end;
        if (b >= a) covered += daysBetween(a, b) + 1;
      }
      const days = Math.max(0, daysBetween(from, end) + 1 - covered);
      if (days === 0) continue;
      const before = intervals.filter((i) => i.to <= end).sort((a, b) => (a.to < b.to ? 1 : -1))[0];
      const reference = before?.rent ?? unit.lastRent ?? unit.marketRent ?? unit.askingRent ?? 0;
      out.set(p, (out.get(p) ?? 0) + Math.round((reference / 30) * days));
    }
  }
  return out;
}

/** Month-by-month portfolio trends (plan §Phase 17): occupancy, rent, collection, outstanding, expenses, NOI, maintenance, vacancy. */
export function getPortfolioTrends(store: Store, months = 12, propertyId?: ID, base: ISODate = today()): TrendPoint[] {
  const periods = lastPeriods(months, periodOf(base));
  const revenue = new Map(getRevenueHistory(store, months, base, propertyId).map((r) => [r.period, r]));
  const vacancy = vacancyByMonth(store, periods, propertyId, base);
  const payments = store.payments.filter((p) => !propertyId || p.propertyId === propertyId);
  const expenses = store.expenses.filter((e) => !e.deleted && (!propertyId || e.propertyId === propertyId));
  const linked = new Set(expenses.filter((e) => e.workOrderId).map((e) => e.workOrderId));
  return periods.map((period) => {
    const noi = noiFor(store, period, propertyId);
    const cr = collectionRate(payments, period, period === periodOf(base) ? base : undefined);
    const rev = revenue.get(period);
    const end = periodEnd(period) < base ? periodEnd(period) : base;
    let outstanding = 0;
    for (const p of payments) {
      if (p.status === "waived" || p.dueDate > end) continue;
      const paidBy = p.paidDate && p.paidDate <= end ? p.amountPaid : 0;
      outstanding += Math.max(0, p.amountDue - paidBy);
    }
    let maintenance = 0;
    for (const e of expenses) if (periodOf(e.expenseDate) === period && e.classification === "operating" && (e.workOrderId || MAINTENANCE_CATEGORIES.has(e.category))) maintenance += e.amount;
    for (const w of store.workOrders) if (w.completedAt && periodOf(w.completedAt) === period && w.actualCost && !linked.has(w.id) && (!propertyId || w.propertyId === propertyId)) maintenance += w.actualCost;
    return {
      period,
      occupancy: rev?.occupancy ?? 0,
      expected: noi.income,
      collected: rev?.collected ?? noi.collected,
      collectionRate: cr.rate,
      outstanding,
      operating: noi.operatingExpenses,
      capex: noi.capex,
      noi: noi.noi,
      maintenance,
      vacancyLoss: vacancy.get(period) ?? 0,
    };
  });
}

export interface ExpirationPoint {
  period: PeriodMonth;
  count: number;
  rent: number;
  renewing: number;
  leaving: number;
  undecided: number;
}

/** Contracts ending in each of the coming months and where the renewal stands. */
export function getExpirationTimeline(store: Store, months = 12, propertyId?: ID, base: ISODate = today()): ExpirationPoint[] {
  const first = periodOf(base);
  const periods = Array.from({ length: months }, (_, i) => addPeriods(first, i));
  const map = new Map<PeriodMonth, ExpirationPoint>(periods.map((p) => [p, { period: p, count: 0, rent: 0, renewing: 0, leaving: 0, undecided: 0 }]));
  for (const c of store.contracts) {
    if (!isOccupying(c) || (propertyId && c.propertyId !== propertyId)) continue;
    const p = periodOf(c.moveOutDate ?? c.endDate);
    const row = map.get(p);
    if (!row) continue;
    row.count += 1;
    row.rent += c.monthlyRent;
    if (c.renewalDecision === "renew" || c.status === "renewed") row.renewing += 1;
    else if (c.renewalDecision === "do_not_renew" || c.status === "notice_given") row.leaving += 1;
    else row.undecided += 1;
  }
  return [...map.values()];
}

/* -------------------------------------------------------------------------- */
/* Expense analytics                                                           */
/* -------------------------------------------------------------------------- */

export interface ExpenseAnalytics {
  year: string;
  total: number;
  operating: number;
  capex: number;
  count: number;
  byCategory: { category: string; amount: number; count: number; share: number; prevYear: number; change: number | null }[];
  byBuilding: { property: Property; amount: number; count: number; share: number; perUnit: number }[];
  bySupplier: { supplier: Supplier | null; name: string; amount: number; count: number; share: number }[];
  /** Twelve months ending in the selected year (or today for the current year), with the same month a year earlier. */
  monthly: { period: PeriodMonth; operating: number; capex: number; total: number; prevYear: number | null }[];
  yearOverYear: { year: string; total: number; operating: number; capex: number }[];
  largest: ReturnType<typeof getExpenses>;
}

export function getExpenseAnalytics(store: Store, opts: { propertyId?: ID; year?: string } = {}, base: ISODate = today()): ExpenseAnalytics {
  const idx = indexStore(store);
  const year = opts.year ?? base.slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const rows = getExpenses(store, { propertyId: opts.propertyId, period: year }, base);
  const prevRows = getExpenses(store, { propertyId: opts.propertyId, period: prevYear }, base);
  const total = rows.reduce((n, r) => n + r.expense.amount, 0);
  const sumBy = <K>(list: typeof rows, key: (r: (typeof rows)[number]) => K) => {
    const m = new Map<K, { amount: number; count: number }>();
    for (const r of list) {
      const k = key(r);
      const cur = m.get(k) ?? { amount: 0, count: 0 };
      cur.amount += r.expense.amount;
      cur.count += 1;
      m.set(k, cur);
    }
    return m;
  };
  const cat = sumBy(rows, (r) => r.expense.category);
  const prevCat = sumBy(prevRows, (r) => r.expense.category);
  const byCategory = [...new Set([...cat.keys(), ...prevCat.keys()])]
    .map((category) => {
      const cur = cat.get(category) ?? { amount: 0, count: 0 };
      const prev = prevCat.get(category)?.amount ?? 0;
      return { category, amount: cur.amount, count: cur.count, share: total > 0 ? cur.amount / total : 0, prevYear: prev, change: prev > 0 ? (cur.amount - prev) / prev : null };
    })
    .sort((a, b) => b.amount - a.amount);
  const bld = sumBy(rows, (r) => r.property.id);
  const byBuilding = [...bld.entries()]
    .map(([id, v]) => {
      const property = idx.propertyById.get(id)!;
      const units = (idx.unitsByProperty.get(id) ?? []).length;
      return { property, amount: v.amount, count: v.count, share: total > 0 ? v.amount / total : 0, perUnit: units > 0 ? v.amount / units : 0 };
    })
    .sort((a, b) => b.amount - a.amount);
  const sup = sumBy(rows, (r) => r.supplier?.id ?? "none");
  const bySupplier = [...sup.entries()]
    .map(([id, v]) => ({ supplier: id === "none" ? null : idx.supplierById.get(id) ?? null, name: id === "none" ? "No supplier" : idx.supplierById.get(id)?.name ?? "Unknown", amount: v.amount, count: v.count, share: total > 0 ? v.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const endPeriod = year === base.slice(0, 4) ? periodOf(base) : `${year}-12`;
  const monthly = lastPeriods(12, endPeriod).map((period) => {
    const m = getExpenses(store, { propertyId: opts.propertyId, period }, base);
    const operating = m.filter((r) => r.expense.classification === "operating").reduce((n, r) => n + r.expense.amount, 0);
    const capex = m.filter((r) => r.expense.classification === "capex").reduce((n, r) => n + r.expense.amount, 0);
    const py = `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
    const prev = getExpenses(store, { propertyId: opts.propertyId, period: py }, base);
    return { period, operating, capex, total: operating + capex, prevYear: prev.length > 0 ? prev.reduce((n, r) => n + r.expense.amount, 0) : null };
  });
  const years = [...new Set(store.expenses.filter((e) => !e.deleted && (!opts.propertyId || e.propertyId === opts.propertyId)).map((e) => e.expenseDate.slice(0, 4)))].sort();
  const yearOverYear = years.map((y) => {
    const list = getExpenses(store, { propertyId: opts.propertyId, period: y }, base);
    const operating = list.filter((r) => r.expense.classification === "operating").reduce((n, r) => n + r.expense.amount, 0);
    const capex = list.filter((r) => r.expense.classification === "capex").reduce((n, r) => n + r.expense.amount, 0);
    return { year: y, total: operating + capex, operating, capex };
  });
  return {
    year,
    total,
    operating: rows.filter((r) => r.expense.classification === "operating").reduce((n, r) => n + r.expense.amount, 0),
    capex: rows.filter((r) => r.expense.classification === "capex").reduce((n, r) => n + r.expense.amount, 0),
    count: rows.length,
    byCategory,
    byBuilding,
    bySupplier,
    monthly,
    yearOverYear,
    largest: [...rows].sort((a, b) => b.expense.amount - a.expense.amount).slice(0, 10),
  };
}

/* -------------------------------------------------------------------------- */
/* Maintenance analytics                                                       */
/* -------------------------------------------------------------------------- */

export interface MaintenanceAnalytics {
  summary: MaintenanceSummary;
  byCategory: { category: WorkOrderCategory; jobs: number; open: number; cost: number; avgResolutionDays: number | null }[];
  monthly: { period: PeriodMonth; reported: number; completed: number; cost: number }[];
  resolution: { avgDays: number | null; medianDays: number | null; byPriority: { priority: WorkOrderPriority; jobs: number; avgDays: number | null }[] };
  repeatIssues: { unitId: ID; unit: string; property: string; category: WorkOrderCategory; count: number; lastAt: ISODate; cost: number }[];
  suppliers: SupplierRow[];
  topAssets: AssetRow[];
  spend12m: number;
  jobs12m: number;
}

export function getMaintenanceAnalytics(store: Store, propertyId?: ID, base: ISODate = today()): MaintenanceAnalytics {
  const idx = indexStore(store);
  const rows = getWorkOrders(store, { propertyId }, base).filter((r) => r.workOrder.status !== "cancelled");
  const periods = lastPeriods(12, periodOf(base));
  const from = periodStart(periods[0]);
  const window = store.settings.thresholds.repeatIssueWindowDays;
  const catMap = new Map<WorkOrderCategory, { jobs: number; open: number; cost: number; days: number[] }>();
  for (const r of rows) {
    const cur = catMap.get(r.workOrder.category) ?? { jobs: 0, open: 0, cost: 0, days: [] };
    cur.jobs += 1;
    if (r.isOpen) cur.open += 1;
    cur.cost += r.cost;
    if (r.resolutionDays !== null) cur.days.push(r.resolutionDays);
    catMap.set(r.workOrder.category, cur);
  }
  const avg = (xs: number[]) => (xs.length > 0 ? Math.round((xs.reduce((n, x) => n + x, 0) / xs.length) * 10) / 10 : null);
  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
  };
  const byCategory = [...catMap.entries()].map(([category, v]) => ({ category, jobs: v.jobs, open: v.open, cost: v.cost, avgResolutionDays: avg(v.days) })).sort((a, b) => b.cost - a.cost || b.jobs - a.jobs);
  const monthly = periods.map((period) => ({
    period,
    reported: rows.filter((r) => periodOf(r.workOrder.reportedAt) === period).length,
    completed: rows.filter((r) => r.workOrder.completedAt && periodOf(r.workOrder.completedAt) === period).length,
    cost: rows.filter((r) => r.workOrder.completedAt && periodOf(r.workOrder.completedAt) === period).reduce((n, r) => n + r.cost, 0),
  }));
  const resolved = rows.filter((r) => r.resolutionDays !== null).map((r) => r.resolutionDays as number);
  const priorities: WorkOrderPriority[] = ["emergency", "high", "normal", "low"];
  const byPriority = priorities.map((priority) => {
    const list = rows.filter((r) => r.workOrder.priority === priority);
    return { priority, jobs: list.length, avgDays: avg(list.filter((r) => r.resolutionDays !== null).map((r) => r.resolutionDays as number)) };
  });
  const groups = new Map<string, MaintenanceAnalytics["repeatIssues"][number]>();
  for (const r of rows) {
    const w = r.workOrder;
    if (!w.unitId || daysSince(w.reportedAt) > window) continue;
    const key = `${w.unitId}|${w.category}`;
    const g = groups.get(key) ?? { unitId: w.unitId, unit: idx.unitById.get(w.unitId)?.unitNumber ?? "", property: idx.propertyById.get(w.propertyId)?.name ?? "", category: w.category, count: 0, lastAt: w.reportedAt, cost: 0 };
    g.count += 1;
    g.cost += r.cost;
    if (w.reportedAt > g.lastAt) g.lastAt = w.reportedAt;
    groups.set(key, g);
  }
  const inWindow = rows.filter((r) => r.workOrder.reportedAt >= from);
  return {
    summary: getMaintenanceSummary(store, propertyId, base),
    byCategory,
    monthly,
    resolution: { avgDays: avg(resolved), medianDays: median(resolved), byPriority },
    repeatIssues: [...groups.values()].filter((g) => g.count >= 2).sort((a, b) => b.count - a.count || b.cost - a.cost),
    suppliers: getSuppliers(store, { activeOnly: false, propertyId }).filter((s) => s.jobs > 0).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    topAssets: getAssets(store, { propertyId }).filter((a) => a.totalSpend > 0).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10),
    spend12m: inWindow.reduce((n, r) => n + r.cost, 0),
    jobs12m: inWindow.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Reports (tables ready for CSV / Excel / print)                              */
/* -------------------------------------------------------------------------- */

export type ReportKey = "rent_roll" | "tenant_balances" | "payment_history" | "expenses" | "building_pnl" | "maintenance_history" | "contracts_expiring" | "asset_register" | "supplier_performance";

export const REPORT_KEYS: ReportKey[] = ["rent_roll", "tenant_balances", "payment_history", "expenses", "building_pnl", "maintenance_history", "contracts_expiring", "asset_register", "supplier_performance"];

export interface ReportOptions {
  propertyId?: ID;
  /** YYYY-MM for the rent roll and payment history; YYYY for expenses. */
  period?: string;
  /** Days ahead for expiring contracts (default 90). */
  days?: number;
}

export interface ReportTable {
  key: ReportKey;
  title: string;
  description: string;
  columns: string[];
  rows: ExportCell[][];
  totals?: ExportCell[];
  /** Column indexes that hold money — right-aligned and summed. */
  moneyColumns: number[];
}

export const REPORT_META: Record<ReportKey, { title: string; description: string; period: "month" | "year" | "days" | "none" }> = {
  rent_roll: { title: "Rent roll", description: "Every rentable unit for a month: tenant, rent due, paid, outstanding and status", period: "month" },
  tenant_balances: { title: "Tenant balances", description: "Outstanding rent per tenant with arrears aging", period: "none" },
  payment_history: { title: "Payment history", description: "Every rent payment received in the month", period: "month" },
  expenses: { title: "Expenses", description: "Every expense booked in the year, operating and CapEx", period: "year" },
  building_pnl: { title: "Building P&L / NOI", description: "Revenue, collection, expenses, maintenance, CapEx and NOI per building, year to date", period: "none" },
  maintenance_history: { title: "Maintenance history", description: "Work orders in the year with status, supplier, cost and resolution time", period: "year" },
  contracts_expiring: { title: "Contracts expiring", description: "Contracts ending within the horizon and where the renewal stands", period: "days" },
  asset_register: { title: "Asset register", description: "Every asset with status, service dates, warranty and lifetime spend", period: "none" },
  supplier_performance: { title: "Supplier performance", description: "Scores, response and completion times, repeat rate, cost accuracy and spend", period: "none" },
};

export function buildReport(store: Store, key: ReportKey, opts: ReportOptions = {}, base: ISODate = today()): ReportTable {
  const idx = indexStore(store);
  const meta = REPORT_META[key];
  const month = opts.period && /^\d{4}-\d{2}$/.test(opts.period) ? opts.period : periodOf(base);
  const year = opts.period && /^\d{4}$/.test(opts.period) ? opts.period : base.slice(0, 4);
  const sum = (rows: ExportCell[][], i: number) => rows.reduce((n, r) => n + (typeof r[i] === "number" ? (r[i] as number) : 0), 0);
  const make = (columns: string[], rows: ExportCell[][], moneyColumns: number[], totalsLabel = "Total"): ReportTable => ({
    key,
    title: meta.title,
    description: meta.description,
    columns,
    rows,
    moneyColumns,
    totals: rows.length > 0 ? columns.map((_, i) => (i === 0 ? `${totalsLabel} (${rows.length})` : moneyColumns.includes(i) ? sum(rows, i) : "")) : undefined,
  });

  switch (key) {
    case "rent_roll": {
      const rr = getRentRoll(store, { propertyId: opts.propertyId, period: month, occupancy: "all" }, base);
      return make(["Building", "Unit", "Tenant", "Rent", "Due", "Paid", "Outstanding", "Status", "Days overdue", "Contract ends"], rr.rows.map((r) => [r.property.name, r.unit.unitNumber, r.tenant?.fullName ?? "—", r.rent, r.amountDue, r.amountPaid, r.outstanding, labelize(r.status), r.daysOverdue || "", r.contractEnd ?? ""]), [3, 4, 5, 6]);
    }
    case "tenant_balances": {
      const rows: ExportCell[][] = [];
      for (const t of store.tenants) {
        const payments = store.payments.filter((p) => p.tenantId === t.id && (!opts.propertyId || p.propertyId === opts.propertyId));
        const open = payments.filter((p) => p.status === "overdue" || p.status === "partial");
        if (open.length === 0) continue;
        const aging = arrearsAging(open);
        const oldest = open.slice().sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
        const contract = (idx.contractsByTenant.get(t.id) ?? []).find(isOccupying);
        const unit = contract ? idx.unitById.get(contract.unitId) : undefined;
        rows.push([t.fullName, unit ? `${idx.propertyById.get(unit.propertyId)?.name ?? ""} ${unit.unitNumber}` : "—", aging.total, open.length, oldest.dueDate, daysSince(oldest.dueDate), ...aging.buckets.map((b) => b.amount), t.phone]);
      }
      rows.sort((a, b) => (b[2] as number) - (a[2] as number));
      const buckets = arrearsAging([]).buckets.map((b) => b.label);
      return make(["Tenant", "Unit", "Outstanding", "Open instalments", "Oldest due", "Days late", ...buckets, "Phone"], rows, [2, ...buckets.map((_, i) => 6 + i)]);
    }
    case "payment_history": {
      const rows = store.payments
        .filter((p) => p.paidDate && periodOf(p.paidDate) === month && (!opts.propertyId || p.propertyId === opts.propertyId))
        .sort((a, b) => (a.paidDate! < b.paidDate! ? -1 : 1))
        .map((p) => [p.paidDate!, idx.tenantById.get(p.tenantId)?.fullName ?? "—", `${idx.propertyById.get(p.propertyId)?.name ?? ""} ${idx.unitById.get(p.unitId)?.unitNumber ?? ""}`, p.periodMonth, p.amountDue, p.amountPaid, p.method ? labelize(p.method) : "", p.reference ?? "", p.daysLate > 0 ? p.daysLate : ""]);
      return make(["Paid on", "Tenant", "Unit", "For period", "Due", "Paid", "Method", "Reference", "Days late"], rows, [4, 5]);
    }
    case "expenses": {
      const rows = getExpenses(store, { propertyId: opts.propertyId, period: year }, base).map((r) => [r.expense.expenseDate, r.property.name, r.unit?.unitNumber ?? "", labelize(r.expense.category), r.expense.description, r.supplier?.name ?? "", r.expense.amount, labelize(r.expense.classification), labelize(r.expense.paymentStatus), r.expense.paidDate ?? "", r.expense.invoiceNumber ?? ""]);
      return make(["Date", "Building", "Unit", "Category", "Description", "Supplier", "Amount", "Type", "Status", "Paid on", "Invoice"], rows, [6]);
    }
    case "building_pnl": {
      const cmp = getPortfolioComparison(store, "ytd", base);
      const rows = cmp.rows.filter((r) => !opts.propertyId || r.property.id === opts.propertyId).map((r) => [r.property.name, r.units, Math.round(r.occupancy * 1000) / 10, r.revenue, r.collected, Math.round(r.collectionRate * 1000) / 10, r.operatingExpenses, r.maintenance, r.capex, r.noi, Math.round(r.margin * 1000) / 10, Math.round(r.noiPerUnit), r.outstanding, r.vacancyLoss, r.health]);
      return make(["Building", "Units", "Occupancy %", "Revenue", "Collected", "Collection %", "Operating expenses", "Maintenance", "CapEx", "NOI", "Margin %", "NOI / unit / month", "Outstanding", "Vacancy loss (est.)", "Health"], rows, [3, 4, 6, 7, 8, 9, 12, 13]);
    }
    case "maintenance_history": {
      const rows = getWorkOrders(store, { propertyId: opts.propertyId }, base)
        .filter((r) => r.workOrder.reportedAt.startsWith(year))
        .map((r) => [r.workOrder.number, r.workOrder.reportedAt, r.property.name, r.unit?.unitNumber ?? "", r.asset?.name ?? "", labelize(r.workOrder.category), labelize(r.workOrder.priority), r.workOrder.title, labelize(r.workOrder.status), r.supplier?.name ?? "", r.workOrder.estimatedCost ?? "", r.cost, r.workOrder.completedAt ?? "", r.resolutionDays ?? ""]);
      return make(["Number", "Reported", "Building", "Unit", "Asset", "Category", "Priority", "Title", "Status", "Supplier", "Quote", "Cost", "Completed", "Days to resolve"], rows, [11]);
    }
    case "contracts_expiring": {
      const days = opts.days ?? 90;
      const rows = getContracts(store)
        .filter((r) => isOccupying(r.contract) && r.daysRemaining <= days && (!opts.propertyId || r.property.id === opts.propertyId))
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .map((r) => [r.contract.endDate, r.daysRemaining, r.tenant.fullName, r.property.name, r.unit.unitNumber, r.contract.monthlyRent, r.contract.deposit, labelize(r.contract.renewalStatus), r.contract.proposedRent ?? "", r.outstanding, r.reliable ? "Yes" : r.lateCount > 0 ? `${r.lateCount} late` : "", r.tenant.phone]);
      return make(["Ends", "Days left", "Tenant", "Building", "Unit", "Rent", "Deposit", "Renewal", "Proposed rent", "Outstanding", "Reliable", "Phone"], rows, [5, 6, 9]);
    }
    case "asset_register": {
      const rows = getAssets(store, { propertyId: opts.propertyId }).map((r) => [r.property.name, r.unit?.unitNumber ?? "", r.asset.name, labelize(r.asset.assetType), labelize(r.asset.status), r.asset.manufacturer ?? "", r.asset.model ?? "", r.asset.serialNumber ?? "", r.asset.installationDate ?? "", r.asset.purchaseCost ?? "", r.asset.warrantyExpiry ?? "", r.asset.lastServiceDate ?? "", r.asset.nextServiceDate ?? "", r.supplier?.name ?? "", r.totalSpend, r.asset.qrCode]);
      return make(["Building", "Unit", "Asset", "Type", "Status", "Manufacturer", "Model", "Serial", "Installed", "Purchase cost", "Warranty", "Last service", "Next service", "Supplier", "Spend to date", "QR code"], rows, [14]);
    }
    case "supplier_performance": {
      const rows = getSuppliers(store).map((r) => [r.supplier.name, labelize(r.supplier.category), r.supplier.active ? "Active" : "Inactive", r.score ?? "", r.scoreLabel, r.supplier.rating ?? "", r.jobs, r.completedJobs, r.openJobs, r.avgResponseDays ?? "", r.avgCompletionDays ?? "", r.repeatIssueRate === null ? "" : Math.round(r.repeatIssueRate * 100), r.costVariance === null ? "" : Math.round((r.costVariance - 1) * 100), r.totalSpend, r.lastJobAt ?? "", r.supplier.phone]);
      return make(["Supplier", "Category", "Status", "Score", "Label", "Rating", "Jobs", "Completed", "Open", "Avg response (d)", "Avg completion (d)", "Repeat %", "Cost vs quote %", "Spend", "Last job", "Phone"], rows, [13]);
    }
  }
}

export function buildAllReports(store: Store, opts: ReportOptions = {}, base: ISODate = today()): ReportTable[] {
  return REPORT_KEYS.map((key) => buildReport(store, key, opts, base));
}
