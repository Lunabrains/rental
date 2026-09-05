import { freshId, ids } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { addMonthsISO, nowISO, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney } from "@/lib/format";
import type { Asset, AssetStatus, ID, ISODate, PreventivePlan, Store, Supplier, WorkOrder, WorkOrderStatus } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Maintenance (plan §Phase 7–9): work orders with a status timeline, cost and
 * approval; preventive plans that roll forward when serviced; assets and
 * suppliers. Status and cost changes are audited (plan §4.23).
 */

/* ------------------------------- Work orders ------------------------------ */

function nextWorkOrderNumber(store: Store): string {
  let max = 0;
  for (const w of store.workOrders) {
    const m = /^WO-(\d+)$/i.exec(w.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `WO-${String(max + 1).padStart(4, "0")}`;
}

export interface WorkOrderInput {
  propertyId: ID;
  unitId?: ID | null;
  assetId?: ID | null;
  tenantId?: ID | null;
  title: string;
  description?: string;
  category: WorkOrder["category"];
  priority?: WorkOrder["priority"];
  source?: WorkOrder["source"];
  supplierId?: ID | null;
  estimatedCost?: number | null;
  approvalRequired?: boolean;
  reportedAt?: ISODate;
  notes?: string | null;
  inspectionId?: ID | null;
  /** Link only this checklist item (otherwise every pending follow-up on the inspection). */
  inspectionItemId?: ID | null;
  preventivePlanId?: ID | null;
  repeatOfWorkOrderId?: ID | null;
}

const TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open: ["assigned", "awaiting_quote", "awaiting_approval", "in_progress", "cancelled"],
  assigned: ["awaiting_quote", "awaiting_approval", "in_progress", "open", "cancelled"],
  awaiting_quote: ["awaiting_approval", "assigned", "in_progress", "cancelled"],
  awaiting_approval: ["in_progress", "assigned", "awaiting_quote", "cancelled"],
  in_progress: ["completed", "assigned", "cancelled"],
  completed: ["closed", "in_progress"],
  closed: ["in_progress"],
  cancelled: ["open"],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function createWorkOrder(input: WorkOrderInput): Command<WorkOrder> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    if (!input.title.trim()) throw new Error("A title is required");
    if (input.estimatedCost !== undefined && input.estimatedCost !== null && input.estimatedCost < 0) throw new Error("Estimated cost cannot be negative");
    const reportedAt = input.reportedAt ?? today();
    const status: WorkOrderStatus = input.supplierId ? "assigned" : "open";
    const order: WorkOrder = {
      id: freshId("wo"),
      number: nextWorkOrderNumber(store),
      propertyId: property.id,
      unitId: input.unitId ?? null,
      assetId: input.assetId ?? null,
      tenantId: input.tenantId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      category: input.category,
      priority: input.priority ?? "normal",
      status,
      source: input.source ?? "owner",
      reportedAt,
      supplierId: input.supplierId ?? null,
      estimatedCost: input.estimatedCost ?? null,
      actualCost: null,
      approvalRequired: input.approvalRequired ?? (input.estimatedCost !== undefined && input.estimatedCost !== null && input.estimatedCost >= 500),
      approvedAt: null,
      startedAt: null,
      completedAt: null,
      closedAt: null,
      beforePhotoIds: [],
      afterPhotoIds: [],
      invoiceDocumentId: null,
      notes: input.notes?.trim() || null,
      repeatOfWorkOrderId: input.repeatOfWorkOrderId ?? null,
      inspectionId: input.inspectionId ?? null,
      preventivePlanId: input.preventivePlanId ?? null,
      statusHistory: [{ status: "open", at: nowISO(), note: null }, ...(status === "assigned" ? [{ status: "assigned" as WorkOrderStatus, at: nowISO(), note: "Assigned on creation" }] : [])],
      createdAt: reportedAt,
    };
    let next: Store = { ...store, workOrders: [...store.workOrders, order] };
    // Link the originating inspection item.
    if (input.inspectionId) {
      next = {
        ...next,
        inspections: next.inspections.map((i) => (i.id === input.inspectionId ? { ...i, items: i.items.map((it) => ((input.inspectionItemId ? it.id === input.inspectionItemId : it.followUpRequired && !it.workOrderId) ? { ...it, workOrderId: order.id } : it)) } : i)),
      };
    }
    const audited = appendAudit(next, { action: "create", entityType: "work_order", entityId: order.id, entityLabel: `${order.number} · ${order.title}`, newValue: order.status });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "work_order_created",
      message: `${order.priority === "emergency" ? "Emergency" : "Work order"} ${order.number} opened — ${order.title} · ${property.name}${input.unitId ? ` ${idx.unitById.get(input.unitId)?.unitNumber ?? ""}` : ""}`,
      entityType: "work_order",
      entityId: order.id,
      propertyId: order.propertyId,
      unitId: order.unitId,
      tenantId: order.tenantId,
      workOrderId: order.id,
      assetId: order.assetId,
      supplierId: order.supplierId,
      inspectionId: order.inspectionId,
    });
    const undo = (s: Store): Store =>
      recompute(
        removeAudit(
          {
            ...s,
            workOrders: s.workOrders.filter((w) => w.id !== order.id),
            inspections: s.inspections.map((i) => (i.id === input.inspectionId ? { ...i, items: i.items.map((it) => (it.workOrderId === order.id ? { ...it, workOrderId: null } : it)) } : i)),
            activity: s.activity.filter((a) => a.id !== entry.id),
          },
          [audited.entry.id],
        ),
      );
    return finish(logged, order, undo);
  };
}

export type WorkOrderPatch = Partial<Pick<WorkOrder, "title" | "description" | "category" | "priority" | "supplierId" | "estimatedCost" | "actualCost" | "approvalRequired" | "notes" | "unitId" | "assetId" | "repeatOfWorkOrderId" | "invoiceDocumentId" | "beforePhotoIds" | "afterPhotoIds">>;

export function updateWorkOrder(workOrderId: ID, patch: WorkOrderPatch): Command<WorkOrder> {
  return (store) => {
    const prev = indexStore(store).workOrderById.get(workOrderId);
    if (!prev) throw new Error("Work order not found");
    if (patch.estimatedCost !== undefined && patch.estimatedCost !== null && patch.estimatedCost < 0) throw new Error("Estimated cost cannot be negative");
    if (patch.actualCost !== undefined && patch.actualCost !== null && patch.actualCost < 0) throw new Error("Actual cost cannot be negative");
    const order: WorkOrder = { ...prev, ...patch, title: patch.title === undefined ? prev.title : patch.title.trim() || prev.title };
    const audited = auditChanges({ ...store, workOrders: replaceById(store.workOrders, order) }, "work_order", order.id, `${order.number} · ${order.title}`, prev, order, ["statusHistory"]);
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "work_order_updated",
      message: `${order.number} updated${patch.actualCost !== undefined && patch.actualCost !== prev.actualCost ? ` · cost ${formatMoney(patch.actualCost ?? 0)}` : ""}${patch.supplierId !== undefined && patch.supplierId !== prev.supplierId ? ` · supplier changed` : ""}`,
      entityType: "work_order",
      entityId: order.id,
      propertyId: order.propertyId,
      unitId: order.unitId,
      workOrderId: order.id,
      assetId: order.assetId,
      supplierId: order.supplierId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, workOrders: replaceById(s.workOrders, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, order, undo);
  };
}

export interface StatusChangeInput {
  workOrderId: ID;
  status: WorkOrderStatus;
  note?: string | null;
  date?: ISODate;
  /** Required to complete: what it cost. */
  actualCost?: number | null;
  /** Completing a preventive job rolls its plan forward. */
  rollPlan?: boolean;
}

export function changeWorkOrderStatus(input: StatusChangeInput): Command<WorkOrder> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.workOrderById.get(input.workOrderId);
    if (!prev) throw new Error("Work order not found");
    if (!canTransition(prev.status, input.status)) throw new Error(`Cannot move a ${prev.status.replace("_", " ")} work order to ${input.status.replace("_", " ")}`);
    const date = input.date ?? today();
    if (date < prev.reportedAt) throw new Error("Date cannot be before the report date");
    if ((input.status === "completed" || input.status === "closed") && input.actualCost !== undefined && input.actualCost !== null && input.actualCost < 0) throw new Error("Actual cost cannot be negative");
    const at = nowISO();
    const order: WorkOrder = {
      ...prev,
      status: input.status,
      approvedAt: input.status === "in_progress" && prev.status === "awaiting_approval" ? date : prev.approvedAt,
      startedAt: input.status === "in_progress" ? prev.startedAt ?? date : prev.startedAt,
      completedAt: input.status === "completed" || input.status === "closed" ? prev.completedAt ?? date : input.status === "in_progress" ? null : prev.completedAt,
      closedAt: input.status === "closed" ? date : input.status === "cancelled" ? date : prev.closedAt,
      actualCost: input.actualCost !== undefined ? input.actualCost : prev.actualCost,
      statusHistory: [...prev.statusHistory, { status: input.status, at, note: input.note?.trim() || null }],
    };
    if ((order.status === "completed" || order.status === "closed") && !order.completedAt) order.completedAt = date;

    let next: Store = { ...store, workOrders: replaceById(store.workOrders, order) };
    let planEntryIds: string[] = [];
    if (order.status === "completed" && order.preventivePlanId && input.rollPlan !== false) {
      const plan = idx.planById.get(order.preventivePlanId);
      if (plan) {
        const rolled: PreventivePlan = { ...plan, lastServiceDate: date, nextServiceDate: addMonthsISO(date, plan.recurrenceMonths) };
        const a = auditChanges({ ...next, preventivePlans: replaceById(next.preventivePlans, rolled) }, "preventive_plan", plan.id, plan.maintenanceType, plan, rolled);
        next = a.store;
        planEntryIds = a.entryIds;
      }
    }
    const audited = appendAudit(next, { action: "status", entityType: "work_order", entityId: order.id, entityLabel: `${order.number} · ${order.title}`, field: "status", previousValue: prev.status, newValue: order.status, metadata: input.actualCost !== undefined && input.actualCost !== null ? { actualCost: String(input.actualCost) } : null });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "work_order_status",
      message: `${order.number} → ${order.status.replace("_", " ")} — ${order.title}${order.actualCost && (order.status === "completed" || order.status === "closed") ? ` · ${formatMoney(order.actualCost)}` : ""}${input.note ? ` · ${input.note}` : ""}`,
      entityType: "work_order",
      entityId: order.id,
      propertyId: order.propertyId,
      unitId: order.unitId,
      tenantId: order.tenantId,
      workOrderId: order.id,
      assetId: order.assetId,
      supplierId: order.supplierId,
    });
    const undo = (s: Store): Store =>
      recompute(
        removeAudit(
          {
            ...s,
            workOrders: replaceById(s.workOrders, prev),
            preventivePlans: order.preventivePlanId && planEntryIds.length > 0 ? s.preventivePlans.map((p) => (p.id === order.preventivePlanId ? idx.planById.get(p.id) ?? p : p)) : s.preventivePlans,
            activity: s.activity.filter((a) => a.id !== entry.id),
          },
          [audited.entry.id, ...planEntryIds],
        ),
      );
    return finish(logged, order, undo);
  };
}

/** Approve a quote: the work moves to in progress, stamped with the approval date. */
export function approveWorkOrder(workOrderId: ID, note?: string | null): Command<WorkOrder> {
  return (store) => {
    const prev = indexStore(store).workOrderById.get(workOrderId);
    if (!prev) throw new Error("Work order not found");
    if (prev.status !== "awaiting_approval" && prev.status !== "awaiting_quote") throw new Error("This work order is not waiting for approval");
    const stamped: Store = { ...store, workOrders: replaceById(store.workOrders, { ...prev, approvedAt: today(), status: "awaiting_approval" }) };
    return changeWorkOrderStatus({ workOrderId, status: "in_progress", note: note ?? `Approved${prev.estimatedCost ? ` at ${formatMoney(prev.estimatedCost)}` : ""}` })(stamped);
  };
}

/* ------------------------------ Preventive plans -------------------------- */

export interface PlanInput {
  propertyId: ID;
  assetId?: ID | null;
  maintenanceType: string;
  recurrenceMonths: number;
  nextServiceDate: ISODate;
  lastServiceDate?: ISODate | null;
  supplierId?: ID | null;
  estimatedCost?: number | null;
  reminderDays?: number;
  notes?: string | null;
}

export function addPreventivePlan(input: PlanInput): Command<PreventivePlan> {
  return (store) => {
    const idx = indexStore(store);
    if (!idx.propertyById.has(input.propertyId)) throw new Error("Building not found");
    if (!input.maintenanceType.trim()) throw new Error("Describe the service");
    if (!Number.isInteger(input.recurrenceMonths) || input.recurrenceMonths < 1) throw new Error("Recurrence must be at least one month");
    if (input.estimatedCost !== undefined && input.estimatedCost !== null && input.estimatedCost < 0) throw new Error("Cost cannot be negative");
    const plan: PreventivePlan = {
      id: `${ids.plan(input.propertyId, input.maintenanceType, input.assetId ?? null)}-${Date.now().toString(36)}`,
      propertyId: input.propertyId,
      assetId: input.assetId ?? null,
      maintenanceType: input.maintenanceType.trim(),
      recurrenceMonths: input.recurrenceMonths,
      lastServiceDate: input.lastServiceDate ?? null,
      nextServiceDate: input.nextServiceDate,
      supplierId: input.supplierId ?? null,
      estimatedCost: input.estimatedCost ?? null,
      status: "active",
      reminderDays: input.reminderDays ?? 14,
      notes: input.notes?.trim() || null,
      createdAt: today(),
    };
    const { store: logged, entry } = appendActivity({ ...store, preventivePlans: [...store.preventivePlans, plan] }, { type: "plan_added", message: `Preventive plan added — ${plan.maintenanceType} every ${plan.recurrenceMonths} months`, entityType: "preventive_plan", entityId: plan.id, propertyId: plan.propertyId, assetId: plan.assetId, supplierId: plan.supplierId });
    return finish(logged, plan, (s) => recompute({ ...s, preventivePlans: s.preventivePlans.filter((p) => p.id !== plan.id), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export function updatePreventivePlan(planId: ID, patch: Partial<Omit<PreventivePlan, "id" | "createdAt">>): Command<PreventivePlan> {
  return (store) => {
    const prev = indexStore(store).planById.get(planId);
    if (!prev) throw new Error("Plan not found");
    const plan: PreventivePlan = { ...prev, ...patch };
    if (plan.recurrenceMonths < 1) throw new Error("Recurrence must be at least one month");
    const audited = auditChanges({ ...store, preventivePlans: replaceById(store.preventivePlans, plan) }, "preventive_plan", plan.id, plan.maintenanceType, prev, plan);
    const { store: logged, entry } = appendActivity(audited.store, { type: "plan_updated", message: `Preventive plan updated — ${plan.maintenanceType}`, entityType: "preventive_plan", entityId: plan.id, propertyId: plan.propertyId, assetId: plan.assetId });
    return finish(logged, plan, (s) => recompute(removeAudit({ ...s, preventivePlans: replaceById(s.preventivePlans, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

export interface LogServiceInput {
  planId: ID;
  date?: ISODate;
  cost?: number | null;
  supplierId?: ID | null;
  note?: string | null;
  /** Also book the cost as an expense (default when a cost is given). */
  bookExpense?: boolean;
}

/** Record a completed service: rolls the plan forward and books the cost. */
export function logService(input: LogServiceInput): Command<PreventivePlan> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.planById.get(input.planId);
    if (!prev) throw new Error("Plan not found");
    const date = input.date ?? today();
    if (input.cost !== undefined && input.cost !== null && input.cost < 0) throw new Error("Cost cannot be negative");
    const plan: PreventivePlan = { ...prev, lastServiceDate: date, nextServiceDate: addMonthsISO(date, prev.recurrenceMonths), supplierId: input.supplierId ?? prev.supplierId };
    const asset = prev.assetId ? idx.assetById.get(prev.assetId) : undefined;
    let next: Store = { ...store, preventivePlans: replaceById(store.preventivePlans, plan) };
    let expenseId: ID | null = null;
    const cost = input.cost ?? prev.estimatedCost;
    if (cost && (input.bookExpense ?? true)) {
      expenseId = freshId("e");
      next = {
        ...next,
        expenses: [
          ...next.expenses,
          { id: expenseId, propertyId: prev.propertyId, unitId: asset?.unitId ?? null, supplierId: plan.supplierId, category: asset?.assetType === "elevator" ? "elevator" : asset?.assetType === "generator" ? "generator" : asset?.assetType === "hvac" ? "hvac" : "maintenance", amount: cost, expenseDate: date, dueDate: null, paymentStatus: "unpaid", paidDate: null, recurring: false, recurrence: null, description: `${prev.maintenanceType}${asset ? ` — ${asset.name}` : ""}`, documentId: null, classification: "operating", workOrderId: null, renovationId: null, assetId: prev.assetId, invoiceNumber: null, notes: input.note?.trim() || null, deleted: false, createdAt: today() },
        ],
      };
    }
    const audited = auditChanges(next, "preventive_plan", plan.id, plan.maintenanceType, prev, plan);
    const { store: logged, entry } = appendActivity(audited.store, { type: "asset_serviced", message: `${plan.maintenanceType}${asset ? ` — ${asset.name}` : ""} done on ${date}${cost ? ` · ${formatMoney(cost)}` : ""} · next ${plan.nextServiceDate}`, entityType: "preventive_plan", entityId: plan.id, propertyId: plan.propertyId, unitId: asset?.unitId ?? null, assetId: plan.assetId, supplierId: plan.supplierId, expenseId });
    return finish(logged, plan, (s) => recompute(removeAudit({ ...s, preventivePlans: replaceById(s.preventivePlans, prev), expenses: expenseId ? s.expenses.filter((e) => e.id !== expenseId) : s.expenses, activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/* ---------------------------------- Assets -------------------------------- */

export interface AssetInput {
  propertyId: ID;
  unitId?: ID | null;
  assetType: Asset["assetType"];
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installationDate?: ISODate | null;
  purchaseCost?: number | null;
  warrantyExpiry?: ISODate | null;
  supplierId?: ID | null;
  status?: AssetStatus;
  notes?: string | null;
}

export function addAsset(input: AssetInput): Command<Asset> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    if (!input.name.trim()) throw new Error("Name is required");
    if (input.purchaseCost !== undefined && input.purchaseCost !== null && input.purchaseCost < 0) throw new Error("Cost cannot be negative");
    const base = ids.asset(property.id, input.name.trim());
    const id = idx.assetById.has(base) ? `${base}-${Date.now().toString(36)}` : base;
    const asset: Asset = {
      id,
      propertyId: property.id,
      unitId: input.unitId ?? null,
      assetType: input.assetType,
      name: input.name.trim(),
      manufacturer: input.manufacturer?.trim() || null,
      model: input.model?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null,
      installationDate: input.installationDate ?? null,
      purchaseCost: input.purchaseCost ?? null,
      warrantyExpiry: input.warrantyExpiry ?? null,
      supplierId: input.supplierId ?? null,
      status: input.status ?? "operational",
      lastServiceDate: null,
      nextServiceDate: null,
      qrCode: `AST-${property.code.toUpperCase()}-${input.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
      notes: input.notes?.trim() || null,
      createdAt: today(),
    };
    const audited = appendAudit({ ...store, assets: [...store.assets, asset] }, { action: "create", entityType: "asset", entityId: asset.id, entityLabel: asset.name });
    const { store: logged, entry } = appendActivity(audited.store, { type: "asset_added", message: `Asset registered — ${asset.name} (${asset.assetType}) · ${property.name}`, entityType: "asset", entityId: asset.id, propertyId: asset.propertyId, unitId: asset.unitId, assetId: asset.id, supplierId: asset.supplierId });
    return finish(logged, asset, (s) => recompute(removeAudit({ ...s, assets: s.assets.filter((a) => a.id !== asset.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function updateAsset(assetId: ID, patch: Partial<Omit<Asset, "id" | "propertyId" | "qrCode" | "createdAt" | "nextServiceDate">>): Command<Asset> {
  return (store) => {
    const prev = indexStore(store).assetById.get(assetId);
    if (!prev) throw new Error("Asset not found");
    if (patch.purchaseCost !== undefined && patch.purchaseCost !== null && patch.purchaseCost < 0) throw new Error("Cost cannot be negative");
    const asset: Asset = { ...prev, ...patch, name: patch.name === undefined ? prev.name : patch.name.trim() || prev.name };
    const audited = auditChanges({ ...store, assets: replaceById(store.assets, asset) }, "asset", asset.id, asset.name, prev, asset, ["nextServiceDate", "lastServiceDate"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "asset_updated", message: `${asset.name} updated${patch.status && patch.status !== prev.status ? ` · ${patch.status.replace("_", " ")}` : ""}`, entityType: "asset", entityId: asset.id, propertyId: asset.propertyId, unitId: asset.unitId, assetId: asset.id });
    return finish(logged, asset, (s) => recompute(removeAudit({ ...s, assets: replaceById(s.assets, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/* -------------------------------- Suppliers ------------------------------- */

export interface SupplierInput {
  name: string;
  category: Supplier["category"];
  phone?: string;
  email?: string;
  company?: string | null;
  services?: string[];
  notes?: string | null;
  rating?: number | null;
  active?: boolean;
}

export function addSupplier(input: SupplierInput): Command<Supplier> {
  return (store) => {
    if (!input.name.trim()) throw new Error("Name is required");
    if (store.suppliers.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error("A supplier with this name already exists");
    if (input.rating !== undefined && input.rating !== null && (input.rating < 1 || input.rating > 5)) throw new Error("Rating must be between 1 and 5");
    const supplier: Supplier = { id: `${ids.supplier(input.name.trim())}-${Date.now().toString(36).slice(-4)}`, name: input.name.trim(), category: input.category, phone: input.phone?.trim() ?? "", email: input.email?.trim() ?? "", company: input.company?.trim() || null, services: input.services ?? [], notes: input.notes?.trim() || null, active: input.active ?? true, rating: input.rating ?? null, createdAt: today() };
    const { store: logged, entry } = appendActivity({ ...store, suppliers: [...store.suppliers, supplier] }, { type: "supplier_added", message: `Supplier added — ${supplier.name} (${supplier.category})`, entityType: "supplier", entityId: supplier.id, supplierId: supplier.id });
    return finish(logged, supplier, (s) => recompute({ ...s, suppliers: s.suppliers.filter((x) => x.id !== supplier.id), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export function updateSupplier(supplierId: ID, patch: Partial<Omit<Supplier, "id" | "createdAt">>): Command<Supplier> {
  return (store) => {
    const prev = indexStore(store).supplierById.get(supplierId);
    if (!prev) throw new Error("Supplier not found");
    if (patch.rating !== undefined && patch.rating !== null && (patch.rating < 1 || patch.rating > 5)) throw new Error("Rating must be between 1 and 5");
    const supplier: Supplier = { ...prev, ...patch, name: patch.name === undefined ? prev.name : patch.name.trim() || prev.name };
    const audited = auditChanges({ ...store, suppliers: replaceById(store.suppliers, supplier) }, "supplier", supplier.id, supplier.name, prev, supplier);
    const { store: logged, entry } = appendActivity(audited.store, { type: "supplier_updated", message: `${supplier.name} updated${patch.rating !== undefined ? ` · rated ${patch.rating ?? "—"}/5` : ""}`, entityType: "supplier", entityId: supplier.id, supplierId: supplier.id });
    return finish(logged, supplier, (s) => recompute(removeAudit({ ...s, suppliers: replaceById(s.suppliers, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}
