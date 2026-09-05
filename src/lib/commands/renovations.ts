import { indexStore } from "@/lib/data/store";
import { freshId, ids } from "@/lib/data/ids";
import { isAfter, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { isOccupying } from "@/lib/derived/occupancy";
import { formatMoney, labelize } from "@/lib/format";
import type { ID, ISODate, Renovation, RenovationStatus, RenovationTask, Store, Unit } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

export interface RenovationInput {
  propertyId: ID;
  unitId?: ID | null;
  title: string;
  description?: string;
  projectType: Renovation["projectType"];
  budget: number;
  contractorSupplierId?: ID | null;
  startDate: ISODate;
  targetEndDate: ISODate;
  tasks?: { title: string; dueDate?: ISODate | null }[];
  notes?: string | null;
  status?: RenovationStatus;
  /** Flag a vacant unit as "renovation" so it drops out of the rentable count. */
  markUnit?: boolean;
}

const TRANSITIONS: Record<RenovationStatus, RenovationStatus[]> = {
  planned: ["in_progress", "on_hold", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["planned"],
};

export function canTransitionRenovation(from: RenovationStatus, to: RenovationStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

const isLive = (s: RenovationStatus) => s === "planned" || s === "in_progress" || s === "on_hold";

function newTasks(list: { title: string; dueDate?: ISODate | null }[]): RenovationTask[] {
  return list.filter((t) => t.title.trim()).map((t) => ({ id: freshId("rt"), title: t.title.trim(), done: false, dueDate: t.dueDate ?? null }));
}

function unitIsVacant(store: Store, unit: Unit): boolean {
  return !store.contracts.some((c) => c.unitId === unit.id && isOccupying(c));
}

export function createRenovation(input: RenovationInput): Command<Renovation> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    if (!input.title.trim()) throw new Error("Give the project a title");
    if (input.budget < 0) throw new Error("Budget cannot be negative");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.targetEndDate)) throw new Error("Pick the start and target end dates");
    if (isAfter(input.startDate, input.targetEndDate)) throw new Error("Target end must be on or after the start");
    const unit = input.unitId ? idx.unitById.get(input.unitId) ?? null : null;
    if (input.unitId && !unit) throw new Error("Unit not found");
    if (unit && unit.propertyId !== input.propertyId) throw new Error("The unit is in another building");
    if (input.contractorSupplierId && !idx.supplierById.get(input.contractorSupplierId)) throw new Error("Contractor not found");
    const status: RenovationStatus = input.status ?? (isAfter(input.startDate, today()) ? "planned" : "in_progress");
    const renovation: Renovation = {
      id: `${ids.renovation(input.propertyId, input.title.trim())}-${freshId("s").slice(2)}`,
      propertyId: input.propertyId,
      unitId: unit?.id ?? null,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      projectType: input.projectType,
      budget: input.budget,
      actualCost: 0,
      contractorSupplierId: input.contractorSupplierId ?? null,
      startDate: input.startDate,
      targetEndDate: input.targetEndDate,
      actualEndDate: null,
      progressPercent: 0,
      status,
      tasks: newTasks(input.tasks ?? []),
      photoIds: [],
      notes: input.notes?.trim() || null,
      createdAt: today(),
    };
    let next: Store = { ...store, renovations: [...store.renovations, renovation] };
    let unitPrev: Unit | null = null;
    if (unit && input.markUnit && status !== "planned" && unitIsVacant(store, unit)) {
      unitPrev = unit;
      next = { ...next, units: replaceById(next.units, { ...unit, status: "renovation" }) };
    }
    const audited = appendAudit(next, { action: "create", entityType: "renovation", entityId: renovation.id, entityLabel: renovation.title, newValue: `${labelize(status)} · budget ${formatMoney(renovation.budget)}` });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "renovation_created",
      message: `${labelize(renovation.projectType)} project "${renovation.title}" ${status === "planned" ? "planned" : "started"} — ${property.name}${unit ? ` ${unit.unitNumber}` : ""} · budget ${formatMoney(renovation.budget)}`,
      entityType: "renovation",
      entityId: renovation.id,
      propertyId: renovation.propertyId,
      unitId: renovation.unitId,
      renovationId: renovation.id,
      supplierId: renovation.contractorSupplierId,
    });
    return finish(logged, renovation, (s) => recompute(removeAudit({ ...s, renovations: s.renovations.filter((r) => r.id !== renovation.id), units: unitPrev ? replaceById(s.units, unitPrev) : s.units, activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function updateRenovation(renovationId: ID, patch: Partial<Pick<Renovation, "title" | "description" | "projectType" | "budget" | "contractorSupplierId" | "startDate" | "targetEndDate" | "notes" | "progressPercent">>): Command<Renovation> {
  return (store) => {
    const prev = indexStore(store).renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    const next: Renovation = { ...prev, ...patch, title: patch.title === undefined ? prev.title : patch.title.trim() || prev.title };
    if (next.budget < 0) throw new Error("Budget cannot be negative");
    if (isAfter(next.startDate, next.targetEndDate)) throw new Error("Target end must be on or after the start");
    if (next.progressPercent < 0 || next.progressPercent > 100) throw new Error("Progress is a percentage");
    if (patch.contractorSupplierId && !indexStore(store).supplierById.get(patch.contractorSupplierId)) throw new Error("Contractor not found");
    const audited = auditChanges({ ...store, renovations: replaceById(store.renovations, next) }, "renovation", next.id, next.title, prev, next, ["actualCost", "tasks", "photoIds"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "renovation_updated", message: `${next.title} updated${patch.budget !== undefined && patch.budget !== prev.budget ? ` · budget ${formatMoney(prev.budget)} → ${formatMoney(patch.budget)}` : ""}${patch.targetEndDate && patch.targetEndDate !== prev.targetEndDate ? ` · target end ${patch.targetEndDate}` : ""}`, entityType: "renovation", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, renovationId: next.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, renovations: replaceById(s.renovations, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

export function setRenovationStatus(renovationId: ID, status: RenovationStatus, note?: string | null): Command<Renovation> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    if (status === "completed") throw new Error("Use Complete to close a project with its end date");
    if (!canTransitionRenovation(prev.status, status)) throw new Error(`Cannot move from ${labelize(prev.status)} to ${labelize(status)}`);
    const next: Renovation = { ...prev, status, actualEndDate: status === "in_progress" ? null : prev.actualEndDate, notes: note?.trim() ? `${prev.notes ? `${prev.notes}\n` : ""}${labelize(status)} ${today()}: ${note.trim()}` : prev.notes };
    let s: Store = { ...store, renovations: replaceById(store.renovations, next) };
    // A cancelled or resumed project frees / flags the vacant unit.
    const unit = prev.unitId ? idx.unitById.get(prev.unitId) ?? null : null;
    let unitPrev: Unit | null = null;
    if (unit && unitIsVacant(store, unit)) {
      if (status === "cancelled" && unit.status === "renovation") {
        unitPrev = unit;
        s = { ...s, units: replaceById(s.units, { ...unit, status: "available" }) };
      } else if (status === "in_progress" && unit.status === "available" && prev.status !== "completed") {
        unitPrev = unit;
        s = { ...s, units: replaceById(s.units, { ...unit, status: "renovation" }) };
      }
    }
    const audited = appendAudit(s, { action: "status", entityType: "renovation", entityId: next.id, entityLabel: next.title, field: "status", previousValue: prev.status, newValue: status });
    const { store: logged, entry } = appendActivity(audited.store, { type: "renovation_updated", message: `${next.title} — ${labelize(status)}${note ? ` · ${note}` : ""}`, entityType: "renovation", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, renovationId: next.id });
    return finish(logged, next, (x) => recompute(removeAudit({ ...x, renovations: replaceById(x.renovations, prev), units: unitPrev ? replaceById(x.units, unitPrev) : x.units, activity: x.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export interface CompleteRenovationInput {
  actualEndDate?: ISODate;
  notes?: string | null;
  /** Post-project condition recorded on the unit. */
  unitCondition?: Unit["condition"] | null;
  /** New asking rent after the works (unit projects). */
  marketRent?: number | null;
}

export function completeRenovation(renovationId: ID, input: CompleteRenovationInput = {}): Command<Renovation> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    if (prev.status === "completed") throw new Error("Already completed");
    if (prev.status === "cancelled") throw new Error("The project was cancelled");
    const actualEndDate = input.actualEndDate ?? today();
    if (isAfter(actualEndDate, today())) throw new Error("End date cannot be in the future");
    if (isAfter(prev.startDate, actualEndDate)) throw new Error("End date is before the start");
    if (input.marketRent !== undefined && input.marketRent !== null && input.marketRent < 0) throw new Error("Rent cannot be negative");
    const next: Renovation = { ...prev, status: "completed", actualEndDate, progressPercent: 100, tasks: prev.tasks.map((t) => ({ ...t, done: true })), notes: input.notes?.trim() ? `${prev.notes ? `${prev.notes}\n` : ""}${input.notes.trim()}` : prev.notes };
    let s: Store = { ...store, renovations: replaceById(store.renovations, next) };
    const unit = prev.unitId ? idx.unitById.get(prev.unitId) ?? null : null;
    let unitPrev: Unit | null = null;
    const unitChanges: string[] = [];
    if (unit) {
      const updated: Unit = { ...unit };
      if (unit.status === "renovation") {
        updated.status = "available";
        unitChanges.push("available again");
      }
      if (input.unitCondition && input.unitCondition !== unit.condition) {
        updated.condition = input.unitCondition;
        unitChanges.push(`condition ${labelize(input.unitCondition)}`);
      }
      if (input.marketRent !== undefined && input.marketRent !== null && input.marketRent !== unit.marketRent) {
        updated.marketRent = input.marketRent;
        unitChanges.push(`asking rent ${formatMoney(input.marketRent)}`);
      }
      if (unitChanges.length > 0) {
        unitPrev = unit;
        s = { ...s, units: replaceById(s.units, updated) };
      }
    }
    const audited = appendAudit(s, { action: "status", entityType: "renovation", entityId: next.id, entityLabel: next.title, field: "status", previousValue: prev.status, newValue: `completed ${actualEndDate} · ${formatMoney(prev.actualCost)} vs ${formatMoney(prev.budget)} budget` });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "renovation_updated",
      message: `${next.title} completed — ${formatMoney(prev.actualCost)} spent vs ${formatMoney(prev.budget)} budget${isAfter(actualEndDate, prev.targetEndDate) ? ` · finished late` : ""}${unitChanges.length > 0 ? ` · unit ${unitChanges.join(", ")}` : ""}`,
      entityType: "renovation",
      entityId: next.id,
      propertyId: next.propertyId,
      unitId: next.unitId,
      renovationId: next.id,
    });
    return finish(logged, next, (x) => recompute(removeAudit({ ...x, renovations: replaceById(x.renovations, prev), units: unitPrev ? replaceById(x.units, unitPrev) : x.units, activity: x.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function addRenovationTask(renovationId: ID, input: { title: string; dueDate?: ISODate | null }): Command<Renovation> {
  return (store) => {
    const prev = indexStore(store).renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    if (!input.title.trim()) throw new Error("Describe the task");
    if (!isLive(prev.status)) throw new Error("The project is closed");
    const next: Renovation = { ...prev, tasks: [...prev.tasks, ...newTasks([input])] };
    return finish({ ...store, renovations: replaceById(store.renovations, next) }, next, (s) => recompute({ ...s, renovations: replaceById(s.renovations, prev) }));
  };
}

export function toggleRenovationTask(renovationId: ID, taskId: ID, done?: boolean): Command<Renovation> {
  return (store) => {
    const prev = indexStore(store).renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    const task = prev.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found");
    const next: Renovation = { ...prev, status: prev.status === "planned" && (done ?? !task.done) ? "in_progress" : prev.status, tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, done: done ?? !t.done } : t)) };
    return finish({ ...store, renovations: replaceById(store.renovations, next) }, next, (s) => recompute({ ...s, renovations: replaceById(s.renovations, prev) }));
  };
}

export function removeRenovationTask(renovationId: ID, taskId: ID): Command<Renovation> {
  return (store) => {
    const prev = indexStore(store).renovationById.get(renovationId);
    if (!prev) throw new Error("Project not found");
    if (!prev.tasks.some((t) => t.id === taskId)) throw new Error("Task not found");
    const next: Renovation = { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) };
    return finish({ ...store, renovations: replaceById(store.renovations, next) }, next, (s) => recompute({ ...s, renovations: replaceById(s.renovations, prev) }));
  };
}
