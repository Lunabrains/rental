import { indexStore } from "@/lib/data/store";
import { addPeriods, daysBetween, periodOf, today } from "@/lib/date";
import { sum, tenantReliability, unitHealth, vacancyLoss, type HealthScore, type ReliabilityScore, type VacancyLoss } from "@/lib/derived/metrics";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatMoney } from "@/lib/format";
import type { ID, ISODate, Store, Tenant } from "@/types";

import { getUnitDetails, getUnitTimeline, type TimelineEvent, type UnitDetails } from "./entities";
import {
  depositRow,
  getExpenses,
  getInspections,
  getKeys,
  getMeters,
  getParking,
  getRenovations,
  getWorkOrders,
  type DepositRow,
  type ExpenseRow,
  type InspectionRow,
  type KeyRow,
  type MeterRow,
  type ParkingRow,
  type RenovationRow,
  type WorkOrderRow,
} from "./operations";

export interface VacancySpell {
  from: ISODate;
  to: ISODate | null;
  days: number;
  previousTenant: Tenant | null;
  nextTenant: Tenant | null;
}

/** Everything the unit page shows — the drawer's details plus operations, money and history. */
export interface Unit360 extends UnitDetails {
  deposit: DepositRow | null;
  reliability: ReliabilityScore | null;
  health: HealthScore;
  reference: VacancyLoss;
  workOrders: WorkOrderRow[];
  maintenanceYtd: number;
  maintenanceLast12: number;
  inspections: InspectionRow[];
  meters: MeterRow[];
  keys: KeyRow[];
  parking: ParkingRow[];
  renovations: RenovationRow[];
  expenses: ExpenseRow[];
  vacancyHistory: VacancySpell[];
  timeline: TimelineEvent[];
}

export function getUnit360(store: Store, unitId: ID, base: ISODate = today()): Unit360 | null {
  const details = getUnitDetails(store, unitId);
  if (!details) return null;
  const idx = indexStore(store);
  const { unit, contract } = details;

  const deposit = contract ? idx.depositByContract.get(contract.id) : undefined;
  const tenantPayments = contract ? (idx.paymentsByTenant.get(contract.tenantId) ?? []) : [];

  const workOrders = getWorkOrders(store, { unitId }, base);
  const expenses = getExpenses(store, { unitId }, base);
  const year = base.slice(0, 4);
  const spend = (from: ISODate) => sum(expenses.filter((e) => e.expense.expenseDate >= from && e.expense.classification === "operating").map((e) => e.expense.amount)) + sum(workOrders.filter((w) => w.workOrder.completedAt && w.workOrder.completedAt >= from && w.workOrder.actualCost && !expenses.some((e) => e.expense.workOrderId === w.workOrder.id)).map((w) => w.workOrder.actualCost ?? 0));

  // Vacancy spells between consecutive tenancies, plus the current one.
  const history = (idx.contractsByUnit.get(unitId) ?? []).slice().sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const vacancyHistory: VacancySpell[] = [];
  for (let i = 0; i < history.length; i++) {
    const c = history[i];
    if (isOccupying(c) || c.status === "renewed") continue;
    const leftOn = c.moveOutDate ?? c.endDate;
    const next = history.slice(i + 1).find((x) => x.startDate > leftOn && x.tenantId !== c.tenantId) ?? history.slice(i + 1).find((x) => x.startDate > leftOn);
    const to = next ? next.startDate : null;
    if (to === null && unit.status !== "available") continue;
    const end = to ?? base;
    const days = Math.max(0, daysBetween(leftOn, end));
    if (days === 0 && to !== null) continue;
    vacancyHistory.push({ from: leftOn, to, days, previousTenant: idx.tenantById.get(c.tenantId) ?? null, nextTenant: next ? idx.tenantById.get(next.tenantId) ?? null : null });
  }
  if (vacancyHistory.length === 0 && unit.status === "available" && unit.availableSince) {
    vacancyHistory.push({ from: unit.availableSince, to: null, days: Math.max(0, daysBetween(unit.availableSince, base)), previousTenant: details.previousTenant, nextTenant: null });
  }
  vacancyHistory.sort((a, b) => (a.from < b.from ? 1 : -1));

  // Timeline: the unit's story plus its maintenance and inspections.
  const events = getUnitTimeline(store, unitId, 200);
  for (const w of workOrders) {
    events.push({ id: `wo-${w.workOrder.id}`, at: w.workOrder.reportedAt, title: `${w.workOrder.priority === "emergency" ? "Emergency" : "Work order"} — ${w.workOrder.title}`, detail: `${w.workOrder.number} · ${w.workOrder.category}${w.supplier ? ` · ${w.supplier.name}` : ""}${w.workOrder.actualCost ? ` · ${formatMoney(w.workOrder.actualCost)}` : ""}`, tone: w.workOrder.priority === "emergency" ? "critical" : w.isOpen ? "warning" : "default", kind: "maintenance" });
    if (w.workOrder.completedAt) events.push({ id: `wo-done-${w.workOrder.id}`, at: w.workOrder.completedAt, title: `Work completed — ${w.workOrder.title}`, detail: `${w.workOrder.number}${w.workOrder.actualCost ? ` · ${formatMoney(w.workOrder.actualCost)}` : ""}`, tone: "success", kind: "maintenance" });
  }
  const inspections = getInspections(store, { unitId }, base);
  for (const i of inspections) {
    const at = i.inspection.completedDate ?? i.inspection.scheduledDate;
    if (at > base) continue;
    events.push({ id: `insp-${i.inspection.id}`, at, title: `${i.inspection.type.replace("_", " ")} inspection ${i.inspection.status === "completed" ? i.inspection.overallResult ?? "completed" : i.inspection.status}`, detail: `${i.inspection.inspector}${i.failed > 0 ? ` · ${i.failed} failed` : ""}${i.attention > 0 ? ` · ${i.attention} attention` : ""}`, tone: i.inspection.overallResult === "fail" ? "critical" : i.inspection.overallResult === "attention" ? "warning" : "default", kind: "inspection" });
  }
  const renovations = getRenovations(store, { unitId }, base);
  for (const r of renovations) {
    if (r.renovation.startDate <= base) events.push({ id: `rn-${r.renovation.id}`, at: r.renovation.startDate, title: `Renovation — ${r.renovation.title}`, detail: `Budget ${formatMoney(r.renovation.budget)} · ${r.renovation.status.replace("_", " ")}`, tone: "info", kind: "renovation" });
  }
  const timeline = events
    .filter((e) => e.at.slice(0, 10) <= base)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    ...details,
    deposit: deposit ? depositRow(store, deposit) : null,
    reliability: contract ? tenantReliability(tenantPayments, base) : null,
    health: unitHealth(store, unitId, base),
    reference: vacancyLoss(unit, base),
    workOrders,
    maintenanceYtd: spend(`${year}-01-01`),
    maintenanceLast12: spend(`${addPeriods(periodOf(base), -11)}-01`),
    inspections,
    meters: getMeters(store, { unitId }),
    keys: getKeys(store, { unitId }),
    parking: getParking(store, { unitId }),
    renovations,
    expenses,
    vacancyHistory,
    timeline,
  };
}
