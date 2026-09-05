import { indexStore } from "@/lib/data/store";
import { addPeriods, daysBetween, daysSince, daysUntil, lastPeriods, periodOf, today } from "@/lib/date";
import { budgetActual, budgetVariance, isOpenWorkOrder, sum, type BudgetVariance, type HealthComponent } from "@/lib/derived/metrics";
import { isOccupying } from "@/lib/derived/occupancy";
import type {
  Asset,
  AuditEntry,
  Budget,
  ChargeAllocation,
  CommonCharge,
  Contract,
  Expense,
  ExpenseCategory,
  ExpenseClassification,
  ID,
  Inspection,
  ISODate,
  KeyItem,
  ParkingSpace,
  PreventivePlan,
  Property,
  Reminder,
  Renovation,
  SecurityDeposit,
  Store,
  StoredDocument,
  Supplier,
  Tenant,
  Unit,
  UtilityMeter,
  UtilityReading,
  WorkOrder,
  WorkOrderStatus,
} from "@/types";

/**
 * Read queries for the operations side of the portfolio: expenses, budgets,
 * deposits, maintenance, assets, suppliers, utilities, common charges,
 * inspections, renovations, parking, keys, reminders and the audit log.
 * Pure functions over a store snapshot, like everything in this folder.
 */

const byDateDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/* -------------------------------- Expenses -------------------------------- */

export interface ExpenseRow {
  expense: Expense;
  property: Property;
  unit: Unit | null;
  supplier: Supplier | null;
  workOrder: WorkOrder | null;
  renovation: Renovation | null;
  document: StoredDocument | null;
  /** Days past the due date for unpaid invoices. */
  overdueDays: number;
}

export interface ExpenseFilter {
  propertyId?: ID;
  unitId?: ID;
  supplierId?: ID;
  category?: ExpenseCategory;
  classification?: ExpenseClassification;
  status?: Expense["paymentStatus"];
  /** `YYYY-MM` or `YYYY`. */
  period?: string;
  from?: ISODate;
  to?: ISODate;
  includeDeleted?: boolean;
  workOrderId?: ID;
  renovationId?: ID;
  assetId?: ID;
}

export function expenseRow(store: Store, e: Expense, base: ISODate = today()): ExpenseRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(e.propertyId);
  if (!property) return null;
  return {
    expense: e,
    property,
    unit: e.unitId ? idx.unitById.get(e.unitId) ?? null : null,
    supplier: e.supplierId ? idx.supplierById.get(e.supplierId) ?? null : null,
    workOrder: e.workOrderId ? idx.workOrderById.get(e.workOrderId) ?? null : null,
    renovation: e.renovationId ? idx.renovationById.get(e.renovationId) ?? null : null,
    document: e.documentId ? idx.documentById.get(e.documentId) ?? null : null,
    overdueDays: e.paymentStatus === "unpaid" && e.dueDate && e.dueDate < base ? daysBetween(e.dueDate, base) : 0,
  };
}

export function getExpenses(store: Store, filter: ExpenseFilter = {}, base: ISODate = today()): ExpenseRow[] {
  return store.expenses
    .filter(
      (e) =>
        (filter.includeDeleted || !e.deleted) &&
        (!filter.propertyId || e.propertyId === filter.propertyId) &&
        (!filter.unitId || e.unitId === filter.unitId) &&
        (!filter.supplierId || e.supplierId === filter.supplierId) &&
        (!filter.category || e.category === filter.category) &&
        (!filter.classification || e.classification === filter.classification) &&
        (!filter.status || e.paymentStatus === filter.status) &&
        (!filter.period || (filter.period.length === 4 ? e.expenseDate.startsWith(filter.period) : periodOf(e.expenseDate) === filter.period)) &&
        (!filter.from || e.expenseDate >= filter.from) &&
        (!filter.to || e.expenseDate <= filter.to) &&
        (!filter.workOrderId || e.workOrderId === filter.workOrderId) &&
        (!filter.renovationId || e.renovationId === filter.renovationId) &&
        (!filter.assetId || e.assetId === filter.assetId),
    )
    .map((e) => expenseRow(store, e, base))
    .filter((x): x is ExpenseRow => x !== null)
    .sort((a, b) => byDateDesc(a.expense.expenseDate, b.expense.expenseDate));
}

export interface ExpenseSummary {
  total: number;
  operating: number;
  capex: number;
  unpaid: number;
  unpaidCount: number;
  byCategory: { category: ExpenseCategory; amount: number; count: number; share: number }[];
  byProperty: { property: Property; amount: number; count: number }[];
  bySupplier: { supplier: Supplier; amount: number; count: number }[];
  count: number;
}

export function summarizeExpenses(rows: ExpenseRow[]): ExpenseSummary {
  const byCategory = new Map<ExpenseCategory, { amount: number; count: number }>();
  const byProperty = new Map<ID, { property: Property; amount: number; count: number }>();
  const bySupplier = new Map<ID, { supplier: Supplier; amount: number; count: number }>();
  let total = 0;
  let operating = 0;
  let capex = 0;
  let unpaid = 0;
  let unpaidCount = 0;
  for (const r of rows) {
    const e = r.expense;
    total += e.amount;
    if (e.classification === "capex") capex += e.amount;
    else operating += e.amount;
    if (e.paymentStatus === "unpaid") {
      unpaid += e.amount;
      unpaidCount++;
    }
    const c = byCategory.get(e.category) ?? { amount: 0, count: 0 };
    byCategory.set(e.category, { amount: c.amount + e.amount, count: c.count + 1 });
    const p = byProperty.get(r.property.id) ?? { property: r.property, amount: 0, count: 0 };
    byProperty.set(r.property.id, { ...p, amount: p.amount + e.amount, count: p.count + 1 });
    if (r.supplier) {
      const s = bySupplier.get(r.supplier.id) ?? { supplier: r.supplier, amount: 0, count: 0 };
      bySupplier.set(r.supplier.id, { ...s, amount: s.amount + e.amount, count: s.count + 1 });
    }
  }
  return {
    total,
    operating,
    capex,
    unpaid,
    unpaidCount,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v, share: total > 0 ? v.amount / total : 0 })).sort((a, b) => b.amount - a.amount),
    byProperty: [...byProperty.values()].sort((a, b) => b.amount - a.amount),
    bySupplier: [...bySupplier.values()].sort((a, b) => b.amount - a.amount),
    count: rows.length,
  };
}

/** Monthly operating spend per category for the last N months (oldest first). */
export function getExpenseTrend(store: Store, months = 12, propertyId?: ID, base: ISODate = today()): { period: string; total: number; operating: number; capex: number; byCategory: Partial<Record<ExpenseCategory, number>> }[] {
  return lastPeriods(months, periodOf(base)).map((period) => {
    const rows = getExpenses(store, { period, propertyId }, base);
    const byCategory: Partial<Record<ExpenseCategory, number>> = {};
    let operating = 0;
    let capex = 0;
    for (const r of rows) {
      const e = r.expense;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
      if (e.classification === "capex") capex += e.amount;
      else operating += e.amount;
    }
    return { period, total: operating + capex, operating, capex, byCategory };
  });
}

/* --------------------------------- Budgets -------------------------------- */

export interface BudgetRow {
  budget: Budget;
  property: Property;
  actual: number;
  variance: BudgetVariance;
}

export function getBudgets(store: Store, filter: { propertyId?: ID; period?: string; periodType?: Budget["periodType"]; overOnly?: boolean } = {}): BudgetRow[] {
  const idx = indexStore(store);
  const pct = store.settings.thresholds.budgetOverPct;
  return store.budgets
    .filter((b) => (!filter.propertyId || b.propertyId === filter.propertyId) && (!filter.period || b.period === filter.period) && (!filter.periodType || b.periodType === filter.periodType))
    .map((b) => {
      const property = idx.propertyById.get(b.propertyId);
      if (!property) return null;
      const actual = budgetActual(store.expenses, b);
      return { budget: b, property, actual, variance: budgetVariance(b.amount, actual, pct) };
    })
    .filter((x): x is BudgetRow => x !== null && (!filter.overOnly || x.variance.over))
    .sort((a, b) => b.variance.variance - a.variance.variance);
}

/* --------------------------------- Deposits ------------------------------- */

export interface DepositRow {
  deposit: SecurityDeposit;
  contract: Contract;
  tenant: Tenant;
  unit: Unit;
  property: Property;
  deducted: number;
  tenancyEnded: boolean;
  endedOn: ISODate | null;
}

export function depositRow(store: Store, d: SecurityDeposit): DepositRow | null {
  const idx = indexStore(store);
  const contract = idx.contractById.get(d.contractId);
  const tenant = idx.tenantById.get(d.tenantId);
  const unit = idx.unitById.get(d.unitId);
  const property = idx.propertyById.get(d.propertyId);
  if (!contract || !tenant || !unit || !property) return null;
  const tenancyEnded = !isOccupying(contract);
  return {
    deposit: d,
    contract,
    tenant,
    unit,
    property,
    deducted: sum(d.deductions.map((x) => x.amount)),
    tenancyEnded,
    endedOn: tenancyEnded ? contract.moveOutDate ?? contract.endDate : null,
  };
}

export function getDeposits(store: Store, filter: { propertyId?: ID; tenantId?: ID; status?: SecurityDeposit["status"]; unitId?: ID } = {}): DepositRow[] {
  return store.deposits
    .filter((d) => (!filter.propertyId || d.propertyId === filter.propertyId) && (!filter.tenantId || d.tenantId === filter.tenantId) && (!filter.status || d.status === filter.status) && (!filter.unitId || d.unitId === filter.unitId))
    .map((d) => depositRow(store, d))
    .filter((x): x is DepositRow => x !== null)
    .sort((a, b) => {
      const rank = (r: DepositRow) => (r.deposit.status === "held" && r.tenancyEnded ? 0 : r.deposit.status === "pending" ? 1 : r.deposit.status === "held" ? 2 : 3);
      return rank(a) - rank(b) || byDateDesc(a.contract.startDate, b.contract.startDate);
    });
}

export interface DepositSummary {
  held: number;
  heldCount: number;
  pending: number;
  pendingCount: number;
  awaitingSettlement: number;
  awaitingSettlementCount: number;
}

export function summarizeDeposits(rows: DepositRow[]): DepositSummary {
  const s: DepositSummary = { held: 0, heldCount: 0, pending: 0, pendingCount: 0, awaitingSettlement: 0, awaitingSettlementCount: 0 };
  for (const r of rows) {
    if (r.deposit.status === "held") {
      s.held += r.deposit.amountHeld;
      s.heldCount++;
      if (r.tenancyEnded) {
        s.awaitingSettlement += r.deposit.amountHeld;
        s.awaitingSettlementCount++;
      }
    } else if (r.deposit.status === "pending") {
      s.pending += r.deposit.amountExpected;
      s.pendingCount++;
    }
  }
  return s;
}

/* ------------------------------- Work orders ------------------------------ */

export interface WorkOrderRow {
  workOrder: WorkOrder;
  property: Property;
  unit: Unit | null;
  asset: Asset | null;
  supplier: Supplier | null;
  tenant: Tenant | null;
  ageDays: number;
  isOpen: boolean;
  /** Open longer than the configured threshold (or emergency older than a day). */
  overdue: boolean;
  cost: number;
  /** Days from report to completion, when completed. */
  resolutionDays: number | null;
}

export type WorkOrderStatusFilter = WorkOrderStatus | "open" | "closed_all";

export interface WorkOrderFilter {
  propertyId?: ID;
  unitId?: ID;
  assetId?: ID;
  supplierId?: ID;
  tenantId?: ID;
  category?: WorkOrder["category"];
  priority?: WorkOrder["priority"];
  status?: WorkOrderStatusFilter;
  overdueOnly?: boolean;
  from?: ISODate;
}

export function workOrderRow(store: Store, w: WorkOrder, base: ISODate = today()): WorkOrderRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(w.propertyId);
  if (!property) return null;
  const isOpen = isOpenWorkOrder(w);
  const ageDays = Math.max(0, daysBetween(w.reportedAt, base));
  const t = store.settings.thresholds;
  return {
    workOrder: w,
    property,
    unit: w.unitId ? idx.unitById.get(w.unitId) ?? null : null,
    asset: w.assetId ? idx.assetById.get(w.assetId) ?? null : null,
    supplier: w.supplierId ? idx.supplierById.get(w.supplierId) ?? null : null,
    tenant: w.tenantId ? idx.tenantById.get(w.tenantId) ?? null : null,
    ageDays,
    isOpen,
    overdue: isOpen && (w.priority === "emergency" ? ageDays >= 1 : ageDays > t.workOrderOpenTooLongDays),
    cost: w.actualCost ?? w.estimatedCost ?? 0,
    resolutionDays: w.completedAt ? Math.max(0, daysBetween(w.reportedAt, w.completedAt)) : null,
  };
}

const PRIORITY_RANK: Record<WorkOrder["priority"], number> = { emergency: 0, high: 1, normal: 2, low: 3 };

export function getWorkOrders(store: Store, filter: WorkOrderFilter = {}, base: ISODate = today()): WorkOrderRow[] {
  return store.workOrders
    .filter(
      (w) =>
        (!filter.propertyId || w.propertyId === filter.propertyId) &&
        (!filter.unitId || w.unitId === filter.unitId) &&
        (!filter.assetId || w.assetId === filter.assetId) &&
        (!filter.supplierId || w.supplierId === filter.supplierId) &&
        (!filter.tenantId || w.tenantId === filter.tenantId) &&
        (!filter.category || w.category === filter.category) &&
        (!filter.priority || w.priority === filter.priority) &&
        (!filter.status || (filter.status === "open" ? isOpenWorkOrder(w) : filter.status === "closed_all" ? !isOpenWorkOrder(w) : w.status === filter.status)) &&
        (!filter.from || w.reportedAt >= filter.from),
    )
    .map((w) => workOrderRow(store, w, base))
    .filter((x): x is WorkOrderRow => x !== null && (!filter.overdueOnly || x.overdue))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || PRIORITY_RANK[a.workOrder.priority] - PRIORITY_RANK[b.workOrder.priority] || byDateDesc(a.workOrder.reportedAt, b.workOrder.reportedAt));
}

export interface WorkOrderDetails extends WorkOrderRow {
  expenses: ExpenseRow[];
  documents: StoredDocument[];
  /** Same unit / asset and category within the repeat window, newest first. */
  related: WorkOrderRow[];
  repeatOf: WorkOrder | null;
  inspection: Inspection | null;
  plan: PreventivePlan | null;
  audit: AuditEntry[];
}

export function getWorkOrderDetails(store: Store, id: ID, base: ISODate = today()): WorkOrderDetails | null {
  const idx = indexStore(store);
  const w = idx.workOrderById.get(id);
  if (!w) return null;
  const row = workOrderRow(store, w, base);
  if (!row) return null;
  const related = store.workOrders
    .filter((x) => x.id !== w.id && x.category === w.category && (w.unitId ? x.unitId === w.unitId : w.assetId ? x.assetId === w.assetId : x.propertyId === w.propertyId && !x.unitId && !x.assetId))
    .map((x) => workOrderRow(store, x, base))
    .filter((x): x is WorkOrderRow => x !== null)
    .sort((a, b) => byDateDesc(a.workOrder.reportedAt, b.workOrder.reportedAt));
  return {
    ...row,
    expenses: getExpenses(store, { workOrderId: w.id }, base),
    documents: store.documents.filter((d) => !d.deleted && (d.workOrderId === w.id || w.beforePhotoIds.includes(d.id) || w.afterPhotoIds.includes(d.id) || d.id === w.invoiceDocumentId)),
    related,
    repeatOf: w.repeatOfWorkOrderId ? idx.workOrderById.get(w.repeatOfWorkOrderId) ?? null : null,
    inspection: w.inspectionId ? idx.inspectionById.get(w.inspectionId) ?? null : null,
    plan: w.preventivePlanId ? idx.planById.get(w.preventivePlanId) ?? null : null,
    audit: store.audit.filter((a) => a.entityType === "work_order" && a.entityId === w.id),
  };
}

export interface MaintenanceSummary {
  open: number;
  emergencies: number;
  awaitingApproval: number;
  overdue: number;
  completedLast30: number;
  spendLast30: number;
  spendThisMonth: number;
  avgResolutionDays: number | null;
  repeatIssues: number;
  byCategory: { category: WorkOrder["category"]; open: number; total: number; cost: number }[];
}

export function getMaintenanceSummary(store: Store, propertyId?: ID, base: ISODate = today()): MaintenanceSummary {
  const rows = getWorkOrders(store, { propertyId }, base);
  const from30 = daysBetween("2000-01-01", base) - 30;
  const recent = rows.filter((r) => r.workOrder.completedAt && daysBetween("2000-01-01", r.workOrder.completedAt) >= from30);
  const resolved = rows.filter((r) => r.resolutionDays !== null);
  const byCategory = new Map<WorkOrder["category"], { open: number; total: number; cost: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.workOrder.category) ?? { open: 0, total: 0, cost: 0 };
    byCategory.set(r.workOrder.category, { open: c.open + (r.isOpen ? 1 : 0), total: c.total + 1, cost: c.cost + (r.workOrder.actualCost ?? 0) });
  }
  return {
    open: rows.filter((r) => r.isOpen).length,
    emergencies: rows.filter((r) => r.isOpen && r.workOrder.priority === "emergency").length,
    awaitingApproval: rows.filter((r) => r.workOrder.status === "awaiting_approval").length,
    overdue: rows.filter((r) => r.overdue).length,
    completedLast30: recent.length,
    spendLast30: sum(recent.map((r) => r.workOrder.actualCost ?? 0)),
    spendThisMonth: sum(rows.filter((r) => r.workOrder.completedAt && periodOf(r.workOrder.completedAt) === periodOf(base)).map((r) => r.workOrder.actualCost ?? 0)),
    avgResolutionDays: resolved.length > 0 ? Math.round((sum(resolved.map((r) => r.resolutionDays ?? 0)) / resolved.length) * 10) / 10 : null,
    repeatIssues: store.alerts.filter((a) => a.type === "maintenance_repeat_issue" && (!propertyId || a.propertyId === propertyId)).length,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.total - a.total),
  };
}

/* ---------------------------------- Assets -------------------------------- */

export type PlanState = "overdue" | "due_soon" | "scheduled" | "paused";

export interface PlanRow {
  plan: PreventivePlan;
  property: Property;
  asset: Asset | null;
  supplier: Supplier | null;
  daysUntil: number;
  state: PlanState;
}

export function planRow(store: Store, p: PreventivePlan, base: ISODate = today()): PlanRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(p.propertyId);
  if (!property) return null;
  const d = daysBetween(base, p.nextServiceDate);
  const soon = Math.max(p.reminderDays, store.settings.thresholds.serviceDueSoonDays);
  return {
    plan: p,
    property,
    asset: p.assetId ? idx.assetById.get(p.assetId) ?? null : null,
    supplier: p.supplierId ? idx.supplierById.get(p.supplierId) ?? null : null,
    daysUntil: d,
    state: p.status === "paused" ? "paused" : d < 0 ? "overdue" : d <= soon ? "due_soon" : "scheduled",
  };
}

export function getPreventivePlans(store: Store, filter: { propertyId?: ID; assetId?: ID; state?: PlanState; supplierId?: ID } = {}, base: ISODate = today()): PlanRow[] {
  return store.preventivePlans
    .filter((p) => (!filter.propertyId || p.propertyId === filter.propertyId) && (!filter.assetId || p.assetId === filter.assetId) && (!filter.supplierId || p.supplierId === filter.supplierId))
    .map((p) => planRow(store, p, base))
    .filter((x): x is PlanRow => x !== null && (!filter.state || x.state === filter.state))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export interface AssetRow {
  asset: Asset;
  property: Property;
  unit: Unit | null;
  supplier: Supplier | null;
  plans: PlanRow[];
  openOrders: number;
  totalSpend: number;
  daysToService: number | null;
  warrantyDays: number | null;
  /** Worst plan state — drives the badge. */
  serviceState: PlanState | "none";
}

export function assetRow(store: Store, a: Asset, base: ISODate = today()): AssetRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(a.propertyId);
  if (!property) return null;
  const plans = (idx.plansByAsset.get(a.id) ?? []).map((p) => planRow(store, p, base)).filter((x): x is PlanRow => x !== null).sort((x, y) => x.daysUntil - y.daysUntil);
  const orders = idx.workOrdersByAsset.get(a.id) ?? [];
  const spend = sum(orders.map((w) => w.actualCost ?? 0)) + sum((store.expenses.filter((e) => !e.deleted && e.assetId === a.id && !e.workOrderId)).map((e) => e.amount));
  const active = plans.filter((p) => p.state !== "paused");
  const serviceState: AssetRow["serviceState"] = active.some((p) => p.state === "overdue") ? "overdue" : active.some((p) => p.state === "due_soon") ? "due_soon" : active.length > 0 ? "scheduled" : plans.length > 0 ? "paused" : "none";
  return {
    asset: a,
    property,
    unit: a.unitId ? idx.unitById.get(a.unitId) ?? null : null,
    supplier: a.supplierId ? idx.supplierById.get(a.supplierId) ?? null : null,
    plans,
    openOrders: orders.filter(isOpenWorkOrder).length,
    totalSpend: spend,
    daysToService: a.nextServiceDate ? daysBetween(base, a.nextServiceDate) : null,
    warrantyDays: a.warrantyExpiry ? daysBetween(base, a.warrantyExpiry) : null,
    serviceState,
  };
}

const ASSET_STATUS_RANK: Record<Asset["status"], number> = { out_of_service: 0, degraded: 1, operational: 2, retired: 3 };

export function getAssets(store: Store, filter: { propertyId?: ID; type?: Asset["assetType"]; status?: Asset["status"]; supplierId?: ID; serviceState?: AssetRow["serviceState"] } = {}, base: ISODate = today()): AssetRow[] {
  return store.assets
    .filter((a) => (!filter.propertyId || a.propertyId === filter.propertyId) && (!filter.type || a.assetType === filter.type) && (!filter.status || a.status === filter.status) && (!filter.supplierId || a.supplierId === filter.supplierId))
    .map((a) => assetRow(store, a, base))
    .filter((x): x is AssetRow => x !== null && (!filter.serviceState || x.serviceState === filter.serviceState))
    .sort((a, b) => ASSET_STATUS_RANK[a.asset.status] - ASSET_STATUS_RANK[b.asset.status] || (a.daysToService ?? 9999) - (b.daysToService ?? 9999) || a.asset.name.localeCompare(b.asset.name));
}

export interface AssetDetails extends AssetRow {
  workOrders: WorkOrderRow[];
  expenses: ExpenseRow[];
  documents: StoredDocument[];
  inspections: Inspection[];
  /** Total spend per month, last 12 months, oldest first. */
  costHistory: { period: string; amount: number }[];
}

export function getAssetDetails(store: Store, id: ID, base: ISODate = today()): AssetDetails | null {
  const idx = indexStore(store);
  const a = idx.assetById.get(id);
  if (!a) return null;
  const row = assetRow(store, a, base);
  if (!row) return null;
  const workOrders = getWorkOrders(store, { assetId: a.id }, base);
  const expenses = getExpenses(store, { assetId: a.id }, base);
  const costHistory = lastPeriods(12, periodOf(base)).map((period) => ({
    period,
    amount: sum(expenses.filter((e) => periodOf(e.expense.expenseDate) === period).map((e) => e.expense.amount)) + sum(workOrders.filter((w) => !w.workOrder.actualCost || expenses.some((e) => e.expense.workOrderId === w.workOrder.id) ? false : w.workOrder.completedAt !== null && periodOf(w.workOrder.completedAt) === period).map((w) => w.workOrder.actualCost ?? 0)),
  }));
  return {
    ...row,
    workOrders,
    expenses,
    documents: store.documents.filter((d) => !d.deleted && d.assetId === a.id),
    inspections: store.inspections.filter((i) => i.assetId === a.id),
    costHistory,
  };
}

export function findAssetByQr(store: Store, code: string): Asset | null {
  const q = code.trim().toUpperCase();
  return store.assets.find((a) => a.qrCode.toUpperCase() === q || a.id.toUpperCase() === q) ?? null;
}

/* --------------------------------- Suppliers ------------------------------ */

export interface SupplierRow {
  supplier: Supplier;
  jobs: number;
  openJobs: number;
  completedJobs: number;
  totalSpend: number;
  avgCost: number | null;
  avgResponseDays: number | null;
  avgCompletionDays: number | null;
  /** Share of completed jobs followed by the same issue within the repeat window. */
  repeatIssueRate: number | null;
  /** Actual ÷ estimated across quoted jobs. */
  costVariance: number | null;
  /** 0–100, null while data is insufficient. */
  score: number | null;
  scoreLabel: string;
  components: HealthComponent[];
  lastJobAt: ISODate | null;
}

export function supplierRow(store: Store, s: Supplier): SupplierRow {
  const idx = indexStore(store);
  const t = store.settings.thresholds;
  const orders = idx.workOrdersBySupplier.get(s.id) ?? [];
  const completed = orders.filter((w) => w.completedAt !== null && w.status !== "cancelled");
  const expenses = idx.expensesBySupplier.get(s.id) ?? [];
  const totalSpend = sum(expenses.map((e) => e.amount)) + sum(completed.filter((w) => !expenses.some((e) => e.workOrderId === w.id)).map((w) => w.actualCost ?? 0));
  const responses = completed.map((w) => (w.startedAt ? daysBetween(w.reportedAt, w.startedAt) : null)).filter((x): x is number => x !== null && x >= 0);
  const completions = completed.map((w) => (w.completedAt ? daysBetween(w.reportedAt, w.completedAt) : null)).filter((x): x is number => x !== null && x >= 0);
  const quoted = completed.filter((w) => w.estimatedCost && w.actualCost);
  const costVariance = quoted.length > 0 ? sum(quoted.map((w) => w.actualCost!)) / sum(quoted.map((w) => w.estimatedCost!)) : null;
  let repeats = 0;
  for (const w of completed) {
    const again = store.workOrders.some(
      (x) =>
        x.id !== w.id &&
        x.category === w.category &&
        (w.unitId ? x.unitId === w.unitId : w.assetId ? x.assetId === w.assetId : false) &&
        w.completedAt !== null &&
        x.reportedAt > w.completedAt &&
        daysBetween(w.completedAt, x.reportedAt) <= t.repeatIssueWindowDays,
    );
    if (again) repeats++;
  }
  const avg = (xs: number[]) => (xs.length > 0 ? Math.round((sum(xs) / xs.length) * 10) / 10 : null);
  const avgResponseDays = avg(responses);
  const avgCompletionDays = avg(completions);
  const repeatIssueRate = completed.length > 0 ? repeats / completed.length : null;
  const jobsWithCost = completed.filter((w) => w.actualCost);
  const avgCost = jobsWithCost.length > 0 ? sum(jobsWithCost.map((w) => w.actualCost!)) / jobsWithCost.length : null;

  const enough = completed.length >= 3;
  const components: HealthComponent[] = enough
    ? [
        { key: "response", label: "Response speed", weight: 25, score: Math.round(Math.max(0, Math.min(100, 100 - ((avgResponseDays ?? 3) - 1) * 25))), detail: avgResponseDays === null ? "no start dates recorded" : `${avgResponseDays} days to start on average` },
        { key: "completion", label: "Completion speed", weight: 25, score: Math.round(Math.max(0, Math.min(100, 100 - ((avgCompletionDays ?? 5) - 2) * 12))), detail: avgCompletionDays === null ? "no completion dates" : `${avgCompletionDays} days to complete on average` },
        { key: "cost", label: "Cost vs quote", weight: 20, score: costVariance === null ? 70 : Math.round(Math.max(0, Math.min(100, 100 - (costVariance - 1) * 200))), detail: costVariance === null ? "no quoted jobs" : `${Math.round(costVariance * 100)}% of quoted amounts on average` },
        { key: "repeat", label: "Repeat issues", weight: 20, score: Math.round(100 * (1 - (repeatIssueRate ?? 0))), detail: `${repeats} of ${completed.length} jobs recurred within ${t.repeatIssueWindowDays} days` },
        { key: "rating", label: "Your rating", weight: 10, score: s.rating === null ? 70 : Math.round((s.rating / 5) * 100), detail: s.rating === null ? "not rated yet" : `${s.rating} / 5` },
      ]
    : [];
  const score = enough ? Math.round(sum(components.map((c) => (c.weight * c.score) / 100))) : null;
  return {
    supplier: s,
    jobs: orders.length,
    openJobs: orders.filter(isOpenWorkOrder).length,
    completedJobs: completed.length,
    totalSpend,
    avgCost: avgCost === null ? null : Math.round(avgCost),
    avgResponseDays,
    avgCompletionDays,
    repeatIssueRate,
    costVariance,
    score,
    scoreLabel: score === null ? "Insufficient data" : score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Watch" : "Poor",
    components,
    lastJobAt: orders.map((w) => w.reportedAt).sort().reverse()[0] ?? null,
  };
}

export function getSuppliers(store: Store, filter: { category?: Supplier["category"]; activeOnly?: boolean } = {}): SupplierRow[] {
  return store.suppliers
    .filter((s) => (!filter.category || s.category === filter.category) && (!filter.activeOnly || s.active))
    .map((s) => supplierRow(store, s))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.jobs - a.jobs || a.supplier.name.localeCompare(b.supplier.name));
}

export interface SupplierDetails extends SupplierRow {
  workOrders: WorkOrderRow[];
  expenses: ExpenseRow[];
  assets: Asset[];
  plans: PlanRow[];
  spendByYear: { year: string; amount: number }[];
}

export function getSupplierDetails(store: Store, id: ID, base: ISODate = today()): SupplierDetails | null {
  const s = indexStore(store).supplierById.get(id);
  if (!s) return null;
  const expenses = getExpenses(store, { supplierId: id }, base);
  const byYear = new Map<string, number>();
  for (const e of expenses) byYear.set(e.expense.expenseDate.slice(0, 4), (byYear.get(e.expense.expenseDate.slice(0, 4)) ?? 0) + e.expense.amount);
  return {
    ...supplierRow(store, s),
    workOrders: getWorkOrders(store, { supplierId: id }, base),
    expenses,
    assets: store.assets.filter((a) => a.supplierId === id),
    plans: getPreventivePlans(store, { supplierId: id }, base),
    spendByYear: [...byYear.entries()].map(([year, amount]) => ({ year, amount })).sort((a, b) => a.year.localeCompare(b.year)),
  };
}

/* --------------------------------- Utilities ------------------------------ */

export interface MeterRow {
  meter: UtilityMeter;
  property: Property;
  unit: Unit | null;
  readings: UtilityReading[];
  lastReading: UtilityReading | null;
  /** Consumption per month, oldest first (one entry per reading). */
  trend: { date: ISODate; consumption: number; amount: number | null }[];
  totalConsumption: number;
  totalAmount: number;
}

export function meterRow(store: Store, m: UtilityMeter): MeterRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(m.propertyId);
  if (!property) return null;
  const readings = (idx.readingsByMeter.get(m.id) ?? []).slice().sort((a, b) => (a.readingDate < b.readingDate ? -1 : 1));
  return {
    meter: m,
    property,
    unit: m.unitId ? idx.unitById.get(m.unitId) ?? null : null,
    readings,
    lastReading: readings[readings.length - 1] ?? null,
    trend: readings.map((r) => ({ date: r.readingDate, consumption: r.consumption, amount: r.calculatedAmount })),
    totalConsumption: sum(readings.map((r) => r.consumption)),
    totalAmount: sum(readings.map((r) => r.calculatedAmount ?? 0)),
  };
}

export function getMeters(store: Store, filter: { propertyId?: ID; unitId?: ID; type?: UtilityMeter["utilityType"]; buildingLevelOnly?: boolean } = {}): MeterRow[] {
  return store.meters
    .filter((m) => (!filter.propertyId || m.propertyId === filter.propertyId) && (!filter.unitId || m.unitId === filter.unitId) && (!filter.type || m.utilityType === filter.type) && (!filter.buildingLevelOnly || m.unitId === null))
    .map((m) => meterRow(store, m))
    .filter((x): x is MeterRow => x !== null)
    .sort((a, b) => a.property.name.localeCompare(b.property.name) || (a.unit?.unitNumber ?? "").localeCompare(b.unit?.unitNumber ?? "", undefined, { numeric: true }) || a.meter.utilityType.localeCompare(b.meter.utilityType));
}

export interface ChargeRow {
  charge: CommonCharge;
  property: Property;
  allocations: (ChargeAllocation & { unit: Unit; tenant: Tenant | null })[];
  paidAmount: number;
  unpaidAmount: number;
  paidCount: number;
}

export function chargeRow(store: Store, c: CommonCharge): ChargeRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(c.propertyId);
  if (!property) return null;
  const allocations = c.allocations
    .map((a) => {
      const unit = idx.unitById.get(a.unitId);
      if (!unit) return null;
      const contract = idx.activeContractByUnit.get(unit.id) ?? (idx.contractsByUnit.get(unit.id) ?? []).find(isOccupying);
      return { ...a, unit, tenant: contract ? idx.tenantById.get(contract.tenantId) ?? null : null };
    })
    .filter((x): x is ChargeRow["allocations"][number] => x !== null)
    .sort((a, b) => a.unit.unitNumber.localeCompare(b.unit.unitNumber, undefined, { numeric: true }));
  return {
    charge: c,
    property,
    allocations,
    paidAmount: sum(allocations.filter((a) => a.paid).map((a) => a.amount)),
    unpaidAmount: sum(allocations.filter((a) => !a.paid).map((a) => a.amount)),
    paidCount: allocations.filter((a) => a.paid).length,
  };
}

export function getCommonCharges(store: Store, filter: { propertyId?: ID; period?: string } = {}): ChargeRow[] {
  return store.commonCharges
    .filter((c) => (!filter.propertyId || c.propertyId === filter.propertyId) && (!filter.period || c.period === filter.period))
    .map((c) => chargeRow(store, c))
    .filter((x): x is ChargeRow => x !== null)
    .sort((a, b) => byDateDesc(a.charge.period, b.charge.period) || a.property.name.localeCompare(b.property.name));
}

/* -------------------------------- Inspections ----------------------------- */

export interface InspectionRow {
  inspection: Inspection;
  property: Property;
  unit: Unit | null;
  asset: Asset | null;
  tenant: Tenant | null;
  failed: number;
  attention: number;
  followUps: number;
  overdue: boolean;
}

export function inspectionRow(store: Store, i: Inspection, base: ISODate = today()): InspectionRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(i.propertyId);
  if (!property) return null;
  return {
    inspection: i,
    property,
    unit: i.unitId ? idx.unitById.get(i.unitId) ?? null : null,
    asset: i.assetId ? idx.assetById.get(i.assetId) ?? null : null,
    tenant: i.tenantId ? idx.tenantById.get(i.tenantId) ?? null : null,
    failed: i.items.filter((x) => x.result === "fail").length,
    attention: i.items.filter((x) => x.result === "attention").length,
    followUps: i.items.filter((x) => x.followUpRequired && !x.workOrderId).length,
    overdue: (i.status === "scheduled" || i.status === "in_progress") && daysBetween(i.scheduledDate, base) > store.settings.thresholds.inspectionOverdueDays,
  };
}

export function getInspections(store: Store, filter: { propertyId?: ID; unitId?: ID; type?: Inspection["type"]; status?: Inspection["status"]; tenantId?: ID; assetId?: ID } = {}, base: ISODate = today()): InspectionRow[] {
  return store.inspections
    .filter((i) => (!filter.propertyId || i.propertyId === filter.propertyId) && (!filter.unitId || i.unitId === filter.unitId) && (!filter.type || i.type === filter.type) && (!filter.status || i.status === filter.status) && (!filter.tenantId || i.tenantId === filter.tenantId) && (!filter.assetId || i.assetId === filter.assetId))
    .map((i) => inspectionRow(store, i, base))
    .filter((x): x is InspectionRow => x !== null)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || byDateDesc(a.inspection.completedDate ?? a.inspection.scheduledDate, b.inspection.completedDate ?? b.inspection.scheduledDate));
}

/* -------------------------------- Renovations ----------------------------- */

export interface RenovationRow {
  renovation: Renovation;
  property: Property;
  unit: Unit | null;
  contractor: Supplier | null;
  variance: number;
  variancePct: number | null;
  delayed: boolean;
  daysToTarget: number;
  tasksDone: number;
  tasksTotal: number;
}

export function renovationRow(store: Store, r: Renovation, base: ISODate = today()): RenovationRow | null {
  const idx = indexStore(store);
  const property = idx.propertyById.get(r.propertyId);
  if (!property) return null;
  const live = r.status === "planned" || r.status === "in_progress" || r.status === "on_hold";
  return {
    renovation: r,
    property,
    unit: r.unitId ? idx.unitById.get(r.unitId) ?? null : null,
    contractor: r.contractorSupplierId ? idx.supplierById.get(r.contractorSupplierId) ?? null : null,
    variance: r.actualCost - r.budget,
    variancePct: r.budget > 0 ? (r.actualCost - r.budget) / r.budget : null,
    delayed: live && r.targetEndDate < base,
    daysToTarget: daysBetween(base, r.targetEndDate),
    tasksDone: r.tasks.filter((t) => t.done).length,
    tasksTotal: r.tasks.length,
  };
}

export function getRenovations(store: Store, filter: { propertyId?: ID; unitId?: ID; status?: Renovation["status"] | "live" } = {}, base: ISODate = today()): RenovationRow[] {
  return store.renovations
    .filter((r) => (!filter.propertyId || r.propertyId === filter.propertyId) && (!filter.unitId || r.unitId === filter.unitId) && (!filter.status || (filter.status === "live" ? r.status === "planned" || r.status === "in_progress" || r.status === "on_hold" : r.status === filter.status)))
    .map((r) => renovationRow(store, r, base))
    .filter((x): x is RenovationRow => x !== null)
    .sort((a, b) => Number(b.delayed) - Number(a.delayed) || byDateDesc(a.renovation.startDate, b.renovation.startDate));
}

export interface RenovationDetails extends RenovationRow {
  expenses: ExpenseRow[];
  documents: StoredDocument[];
}

export function getRenovationDetails(store: Store, id: ID, base: ISODate = today()): RenovationDetails | null {
  const r = indexStore(store).renovationById.get(id);
  if (!r) return null;
  const row = renovationRow(store, r, base);
  if (!row) return null;
  return { ...row, expenses: getExpenses(store, { renovationId: id }, base), documents: store.documents.filter((d) => !d.deleted && (d.renovationId === id || r.photoIds.includes(d.id))) };
}

/* ------------------------------ Parking & keys ---------------------------- */

export interface ParkingRow {
  space: ParkingSpace;
  property: Property;
  unit: Unit | null;
  tenant: Tenant | null;
}

export function getParking(store: Store, filter: { propertyId?: ID; unitId?: ID; tenantId?: ID; status?: ParkingSpace["status"] } = {}): ParkingRow[] {
  const idx = indexStore(store);
  return store.parking
    .filter((p) => (!filter.propertyId || p.propertyId === filter.propertyId) && (!filter.unitId || p.unitId === filter.unitId) && (!filter.tenantId || p.tenantId === filter.tenantId) && (!filter.status || p.status === filter.status))
    .map((space) => {
      const property = idx.propertyById.get(space.propertyId);
      if (!property) return null;
      return { space, property, unit: space.unitId ? idx.unitById.get(space.unitId) ?? null : null, tenant: space.tenantId ? idx.tenantById.get(space.tenantId) ?? null : null };
    })
    .filter((x): x is ParkingRow => x !== null)
    .sort((a, b) => a.property.name.localeCompare(b.property.name) || a.space.spaceNumber.localeCompare(b.space.spaceNumber, undefined, { numeric: true }));
}

export interface KeyRow {
  key: KeyItem;
  property: Property;
  unit: Unit | null;
  tenant: Tenant | null;
}

export function getKeys(store: Store, filter: { propertyId?: ID; unitId?: ID; tenantId?: ID; status?: KeyItem["status"]; type?: KeyItem["type"] } = {}): KeyRow[] {
  const idx = indexStore(store);
  return store.keys
    .filter((k) => (!filter.propertyId || k.propertyId === filter.propertyId) && (!filter.unitId || k.unitId === filter.unitId) && (!filter.tenantId || k.tenantId === filter.tenantId) && (!filter.status || k.status === filter.status) && (!filter.type || k.type === filter.type))
    .map((key) => {
      const property = idx.propertyById.get(key.propertyId);
      if (!property) return null;
      return { key, property, unit: key.unitId ? idx.unitById.get(key.unitId) ?? null : null, tenant: key.tenantId ? idx.tenantById.get(key.tenantId) ?? null : null };
    })
    .filter((x): x is KeyRow => x !== null)
    .sort((a, b) => (a.key.status === "lost" ? -1 : 0) - (b.key.status === "lost" ? -1 : 0) || a.property.name.localeCompare(b.property.name) || (a.unit?.unitNumber ?? "").localeCompare(b.unit?.unitNumber ?? "", undefined, { numeric: true }));
}

/* ------------------------------ Reminders & audit ------------------------- */

export function getReminders(store: Store, opts: { includeDone?: boolean; entityType?: Reminder["entityType"]; entityId?: ID } = {}): Reminder[] {
  return store.reminders
    .filter((r) => (opts.includeDone || !r.done) && (!opts.entityType || r.entityType === opts.entityType) && (!opts.entityId || r.entityId === opts.entityId))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate < b.dueDate ? -1 : 1));
}

export function getAudit(store: Store, filter: { entityType?: AuditEntry["entityType"]; entityId?: ID; limit?: number } = {}): AuditEntry[] {
  return store.audit
    .filter((a) => (!filter.entityType || a.entityType === filter.entityType) && (!filter.entityId || a.entityId === filter.entityId))
    .sort((a, b) => byDateDesc(a.at, b.at))
    .slice(0, filter.limit ?? 100);
}

/* ---------------------------- Building operations ------------------------- */

export interface PropertyOperations {
  openWorkOrders: WorkOrderRow[];
  maintenance: MaintenanceSummary;
  upcomingServices: PlanRow[];
  assets: AssetRow[];
  liveRenovations: RenovationRow[];
  inspections: InspectionRow[];
  unpaidExpenses: ExpenseRow[];
}

export function getPropertyOperations(store: Store, propertyId: ID, base: ISODate = today()): PropertyOperations {
  return {
    openWorkOrders: getWorkOrders(store, { propertyId, status: "open" }, base),
    maintenance: getMaintenanceSummary(store, propertyId, base),
    upcomingServices: getPreventivePlans(store, { propertyId }, base).filter((p) => p.state === "overdue" || p.state === "due_soon"),
    assets: getAssets(store, { propertyId }, base),
    liveRenovations: getRenovations(store, { propertyId, status: "live" }, base),
    inspections: getInspections(store, { propertyId }, base),
    unpaidExpenses: getExpenses(store, { propertyId, status: "unpaid" }, base),
  };
}

/** Months since the given period, for "last N months" labels. */
export function monthsAgo(period: string, base: ISODate = today()): number {
  let n = 0;
  let p = periodOf(base);
  while (p > period && n < 240) {
    p = addPeriods(p, -1);
    n++;
  }
  return n;
}

export { daysSince, daysUntil };
