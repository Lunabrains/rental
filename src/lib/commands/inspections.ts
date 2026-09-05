import { indexStore } from "@/lib/data/store";
import { freshId, ids } from "@/lib/data/ids";
import { isAfter, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { isOccupying } from "@/lib/derived/occupancy";
import { labelize } from "@/lib/format";
import type { ID, ISODate, Inspection, InspectionItem, InspectionResult, InspectionType, ItemResult, KeyItem, ParkingSpace, Store } from "@/types";

import { appendActivity, appendAudit, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/* -------------------------------------------------------------------------- */
/* Checklist templates                                                         */
/* -------------------------------------------------------------------------- */

const UNIT_CHECKLIST: { area: string; item: string }[] = [
  { area: "Entrance", item: "Door, lock and intercom" },
  { area: "Living", item: "Walls and ceiling" },
  { area: "Living", item: "Floor" },
  { area: "Living", item: "Windows and shutters" },
  { area: "Kitchen", item: "Cabinets and counters" },
  { area: "Kitchen", item: "Sink and taps" },
  { area: "Kitchen", item: "Appliances" },
  { area: "Bathroom", item: "Fixtures and tiling" },
  { area: "Bathroom", item: "Water heater" },
  { area: "Bathroom", item: "Ventilation and drainage" },
  { area: "Bedrooms", item: "Walls, floor and wardrobes" },
  { area: "Electrical", item: "Sockets, switches and breakers" },
  { area: "Balcony", item: "Railing and drainage" },
];

/** Default checklist per inspection type; items start unrecorded (`na`). */
export const CHECKLIST_TEMPLATES: Record<InspectionType, { area: string; item: string }[]> = {
  move_in: [...UNIT_CHECKLIST, { area: "Keys", item: "Keys handed over" }, { area: "Meters", item: "Opening readings recorded" }],
  move_out: [...UNIT_CHECKLIST, { area: "Keys", item: "All keys returned" }, { area: "Meters", item: "Closing readings recorded" }, { area: "Cleaning", item: "Unit cleaned and emptied" }],
  annual_unit: UNIT_CHECKLIST,
  building: [
    { area: "Lobby", item: "Cleanliness and lighting" },
    { area: "Stairs", item: "Handrails, lighting and signage" },
    { area: "Elevator", item: "Operation and certificate" },
    { area: "Roof", item: "Water tanks and drainage" },
    { area: "Roof", item: "Access and safety" },
    { area: "Generator", item: "Fuel level and test run" },
    { area: "Parking", item: "Lighting and barrier" },
    { area: "Garbage", item: "Room and collection" },
    { area: "Facade", item: "Cracks and water ingress" },
    { area: "Security", item: "Doors, cameras and intercom" },
  ],
  safety: [
    { area: "Fire", item: "Extinguishers charged and tagged" },
    { area: "Fire", item: "Alarm and detectors tested" },
    { area: "Fire", item: "Exit signage and emergency lighting" },
    { area: "Fire", item: "Escape routes clear" },
    { area: "Electrical", item: "Panel labelled, no exposed wiring" },
    { area: "Gas", item: "Pipes and shut-off valve" },
    { area: "Elevator", item: "Emergency phone and certificate" },
    { area: "Water", item: "Tank hygiene and chlorination" },
  ],
  asset: [
    { area: "Condition", item: "Visual inspection" },
    { area: "Operation", item: "Test run" },
    { area: "Safety", item: "Guards, labels and shut-offs" },
    { area: "Documentation", item: "Certificate and service log" },
  ],
};

/** Overall result from item results: any fail → fail, any attention → attention, else pass. Unrecorded items are ignored. */
export function deriveOverallResult(items: InspectionItem[]): InspectionResult | null {
  const recorded = items.filter((i) => i.result !== "na");
  if (recorded.length === 0) return null;
  if (recorded.some((i) => i.result === "fail")) return "fail";
  if (recorded.some((i) => i.result === "attention")) return "attention";
  return "pass";
}

/* -------------------------------------------------------------------------- */
/* Inspections                                                                 */
/* -------------------------------------------------------------------------- */

export interface InspectionInput {
  propertyId: ID;
  unitId?: ID | null;
  assetId?: ID | null;
  tenantId?: ID | null;
  contractId?: ID | null;
  type: InspectionType;
  scheduledDate: ISODate;
  inspector: string;
  notes?: string | null;
  /** Override the template; each entry becomes an unrecorded item. */
  items?: { area: string; item: string }[];
}

const suffix = (): string => freshId("s").slice(2);

function newItems(list: { area: string; item: string }[]): InspectionItem[] {
  return list.map((t) => ({ id: freshId("ii"), area: t.area, item: t.item, result: "na", notes: null, photoIds: [], followUpRequired: false, workOrderId: null }));
}

export function scheduleInspection(input: InspectionInput): Command<Inspection> {
  return (store) => {
    const idx = indexStore(store);
    const property = idx.propertyById.get(input.propertyId);
    if (!property) throw new Error("Building not found");
    if (!input.inspector.trim()) throw new Error("Name the inspector");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) throw new Error("Pick a date");
    const unitId = input.unitId ?? null;
    if ((input.type === "move_in" || input.type === "move_out" || input.type === "annual_unit") && !unitId) throw new Error(`${labelize(input.type)} inspections need a unit`);
    if (input.type === "asset" && !input.assetId) throw new Error("Pick the asset to inspect");
    if (unitId && !idx.unitById.get(unitId)) throw new Error("Unit not found");
    if (input.assetId && !idx.assetById.get(input.assetId)) throw new Error("Asset not found");
    // Resolve tenant / contract from the occupancy when not given.
    let contractId = input.contractId ?? null;
    let tenantId = input.tenantId ?? null;
    if (unitId && !contractId) {
      const occupying = store.contracts.filter((c) => c.unitId === unitId && isOccupying(c)).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null;
      const upcoming = store.contracts.filter((c) => c.unitId === unitId && isAfter(c.startDate, today())).sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0] ?? null;
      const c = input.type === "move_in" ? upcoming ?? occupying : occupying;
      if (c) {
        contractId = c.id;
        tenantId = tenantId ?? c.tenantId;
      }
    }
    const depositId = contractId ? store.deposits.find((d) => d.contractId === contractId)?.id ?? null : null;
    const inspection: Inspection = {
      id: `${ids.inspection(input.propertyId, unitId, input.type, input.scheduledDate)}-${suffix()}`,
      propertyId: input.propertyId,
      unitId,
      assetId: input.assetId ?? null,
      tenantId,
      contractId,
      type: input.type,
      scheduledDate: input.scheduledDate,
      completedDate: null,
      inspector: input.inspector.trim(),
      status: "scheduled",
      overallResult: null,
      notes: input.notes?.trim() || null,
      items: newItems(input.items ?? CHECKLIST_TEMPLATES[input.type]),
      meterReadingIds: [],
      keyItemIds: [],
      depositId: input.type === "move_out" || input.type === "move_in" ? depositId : null,
      createdAt: today(),
    };
    const unit = unitId ? idx.unitById.get(unitId) : null;
    const audited = appendAudit({ ...store, inspections: [...store.inspections, inspection] }, { action: "create", entityType: "inspection", entityId: inspection.id, entityLabel: `${labelize(inspection.type)} inspection · ${property.name}${unit ? ` ${unit.unitNumber}` : ""}`, newValue: inspection.scheduledDate });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "inspection_created",
      message: `${labelize(inspection.type)} inspection scheduled — ${property.name}${unit ? ` ${unit.unitNumber}` : ""} on ${inspection.scheduledDate} (${inspection.inspector})`,
      entityType: "inspection",
      entityId: inspection.id,
      propertyId: inspection.propertyId,
      unitId,
      tenantId,
      contractId,
      inspectionId: inspection.id,
    });
    return finish(logged, inspection, (s) => recompute(removeAudit({ ...s, inspections: s.inspections.filter((i) => i.id !== inspection.id), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function updateInspection(inspectionId: ID, patch: Partial<Pick<Inspection, "scheduledDate" | "inspector" | "notes" | "assetId" | "tenantId">>): Command<Inspection> {
  return (store) => {
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    if (prev.status === "completed" || prev.status === "cancelled") throw new Error("This inspection is closed");
    const next: Inspection = { ...prev, ...patch, inspector: patch.inspector === undefined ? prev.inspector : patch.inspector.trim() || prev.inspector };
    const audited = auditChanges({ ...store, inspections: replaceById(store.inspections, next) }, "inspection", next.id, `${labelize(next.type)} inspection`, prev, next, ["items"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "inspection_updated", message: `${labelize(next.type)} inspection updated${patch.scheduledDate && patch.scheduledDate !== prev.scheduledDate ? ` · rescheduled to ${patch.scheduledDate}` : ""}`, entityType: "inspection", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId: next.tenantId, inspectionId: next.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, inspections: replaceById(s.inspections, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/** Record the outcome of one checklist item; the first record moves the inspection to in-progress. */
export function recordInspectionItem(inspectionId: ID, itemId: ID, patch: { result?: ItemResult; notes?: string | null; followUpRequired?: boolean }): Command<Inspection> {
  return (store) => {
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    if (prev.status === "cancelled") throw new Error("This inspection was cancelled");
    if (!prev.items.some((it) => it.id === itemId)) throw new Error("Checklist item not found");
    const next: Inspection = {
      ...prev,
      status: prev.status === "scheduled" ? "in_progress" : prev.status,
      items: prev.items.map((it) => {
        if (it.id !== itemId) return it;
        const result = patch.result ?? it.result;
        const followUpRequired = patch.followUpRequired ?? (patch.result !== undefined ? result === "fail" : it.followUpRequired);
        return { ...it, result, notes: patch.notes === undefined ? it.notes : patch.notes?.trim() || null, followUpRequired: result === "pass" || result === "na" ? false : followUpRequired };
      }),
      overallResult: prev.status === "completed" ? deriveOverallResult(prev.items.map((it) => (it.id === itemId ? { ...it, result: patch.result ?? it.result } : it))) : prev.overallResult,
    };
    return finish({ ...store, inspections: replaceById(store.inspections, next) }, next, (s) => recompute({ ...s, inspections: replaceById(s.inspections, prev) }));
  };
}

export function addInspectionItem(inspectionId: ID, input: { area: string; item: string }): Command<Inspection> {
  return (store) => {
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    if (prev.status === "cancelled") throw new Error("This inspection was cancelled");
    if (!input.item.trim()) throw new Error("Describe the item");
    const next: Inspection = { ...prev, items: [...prev.items, ...newItems([{ area: input.area.trim() || "General", item: input.item.trim() }])] };
    return finish({ ...store, inspections: replaceById(store.inspections, next) }, next, (s) => recompute({ ...s, inspections: replaceById(s.inspections, prev) }));
  };
}

export function removeInspectionItem(inspectionId: ID, itemId: ID): Command<Inspection> {
  return (store) => {
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    const item = prev.items.find((it) => it.id === itemId);
    if (!item) throw new Error("Checklist item not found");
    if (item.workOrderId) throw new Error("A work order is linked to this item");
    const next: Inspection = { ...prev, items: prev.items.filter((it) => it.id !== itemId) };
    return finish({ ...store, inspections: replaceById(store.inspections, next) }, next, (s) => recompute({ ...s, inspections: replaceById(s.inspections, prev) }));
  };
}

export function completeInspection(inspectionId: ID, input: { completedDate?: ISODate; overallResult?: InspectionResult | null; notes?: string | null }): Command<Inspection> {
  return (store) => {
    const idx = indexStore(store);
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    if (prev.status === "completed") throw new Error("Already completed");
    if (prev.status === "cancelled") throw new Error("This inspection was cancelled");
    const completedDate = input.completedDate ?? today();
    if (isAfter(completedDate, today())) throw new Error("Completion date cannot be in the future");
    const recorded = prev.items.filter((it) => it.result !== "na");
    if (prev.items.length > 0 && recorded.length === 0) throw new Error("Record at least one checklist item first");
    const overallResult = input.overallResult ?? deriveOverallResult(prev.items) ?? "pass";
    const next: Inspection = { ...prev, status: "completed", completedDate, overallResult, notes: input.notes === undefined ? prev.notes : input.notes?.trim() || null };
    const property = idx.propertyById.get(prev.propertyId);
    const unit = prev.unitId ? idx.unitById.get(prev.unitId) : null;
    const failed = next.items.filter((it) => it.result === "fail").length;
    const attention = next.items.filter((it) => it.result === "attention").length;
    const audited = appendAudit({ ...store, inspections: replaceById(store.inspections, next) }, { action: "update", entityType: "inspection", entityId: next.id, entityLabel: `${labelize(next.type)} inspection · ${property?.name ?? ""}${unit ? ` ${unit.unitNumber}` : ""}`, field: "status", previousValue: prev.status, newValue: `completed · ${overallResult}` });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "inspection_completed",
      message: `${labelize(next.type)} inspection completed — ${property?.name ?? ""}${unit ? ` ${unit.unitNumber}` : ""} · ${labelize(overallResult)}${failed > 0 ? ` · ${failed} failed` : ""}${attention > 0 ? ` · ${attention} attention` : ""}`,
      entityType: "inspection",
      entityId: next.id,
      propertyId: next.propertyId,
      unitId: next.unitId,
      tenantId: next.tenantId,
      contractId: next.contractId,
      inspectionId: next.id,
    });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, inspections: replaceById(s.inspections, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function cancelInspection(inspectionId: ID, reason?: string | null): Command<Inspection> {
  return (store) => {
    const prev = store.inspections.find((i) => i.id === inspectionId);
    if (!prev) throw new Error("Inspection not found");
    if (prev.status === "completed") throw new Error("Completed inspections cannot be cancelled");
    const next: Inspection = { ...prev, status: "cancelled", notes: reason?.trim() ? `${prev.notes ? `${prev.notes}\n` : ""}Cancelled: ${reason.trim()}` : prev.notes };
    const audited = appendAudit({ ...store, inspections: replaceById(store.inspections, next) }, { action: "update", entityType: "inspection", entityId: next.id, entityLabel: `${labelize(next.type)} inspection`, field: "status", previousValue: prev.status, newValue: "cancelled" });
    const { store: logged, entry } = appendActivity(audited.store, { type: "inspection_updated", message: `${labelize(next.type)} inspection cancelled${reason ? ` — ${reason}` : ""}`, entityType: "inspection", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId: next.tenantId, inspectionId: next.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, inspections: replaceById(s.inspections, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

/** Schedule the move-out checklist for a contract (inspection linked to tenant, unit and deposit). */
export function startMoveOut(contractId: ID, input: { scheduledDate?: ISODate; inspector: string }): Command<Inspection> {
  return (store) => {
    const c = indexStore(store).contractById.get(contractId);
    if (!c) throw new Error("Contract not found");
    if (store.inspections.some((i) => i.contractId === contractId && i.type === "move_out" && i.status !== "cancelled")) throw new Error("A move-out inspection already exists for this contract");
    const scheduledDate = input.scheduledDate ?? (isAfter(c.moveOutDate ?? c.endDate, today()) ? c.moveOutDate ?? c.endDate : today());
    return scheduleInspection({ propertyId: c.propertyId, unitId: c.unitId, tenantId: c.tenantId, contractId, type: "move_out", scheduledDate, inspector: input.inspector })(store);
  };
}

/** Schedule the move-in checklist for a contract. */
export function startMoveIn(contractId: ID, input: { scheduledDate?: ISODate; inspector: string }): Command<Inspection> {
  return (store) => {
    const c = indexStore(store).contractById.get(contractId);
    if (!c) throw new Error("Contract not found");
    if (store.inspections.some((i) => i.contractId === contractId && i.type === "move_in" && i.status !== "cancelled")) throw new Error("A move-in inspection already exists for this contract");
    return scheduleInspection({ propertyId: c.propertyId, unitId: c.unitId, tenantId: c.tenantId, contractId, type: "move_in", scheduledDate: input.scheduledDate ?? (isAfter(c.startDate, today()) ? c.startDate : today()), inspector: input.inspector })(store);
  };
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

export interface KeyInput {
  propertyId: ID;
  unitId?: ID | null;
  type: KeyItem["type"];
  identifier: string;
  notes?: string | null;
}

export function addKey(input: KeyInput): Command<KeyItem> {
  return (store) => {
    const idx = indexStore(store);
    if (!idx.propertyById.get(input.propertyId)) throw new Error("Building not found");
    if (!input.identifier.trim()) throw new Error("Give the key a label or number");
    if (store.keys.some((k) => k.propertyId === input.propertyId && k.identifier.toLowerCase() === input.identifier.trim().toLowerCase())) throw new Error("A key with this label already exists in the building");
    const key: KeyItem = { id: `${ids.key(input.propertyId, input.identifier.trim())}-${suffix()}`, propertyId: input.propertyId, unitId: input.unitId ?? null, type: input.type, identifier: input.identifier.trim(), assignedTo: null, tenantId: null, issuedDate: null, returnedDate: null, status: "in_office", notes: input.notes?.trim() || null };
    const { store: logged, entry } = appendActivity({ ...store, keys: [...store.keys, key] }, { type: "key_updated", message: `${labelize(key.type)} ${key.identifier} added to the key register`, entityType: "key", entityId: key.id, propertyId: key.propertyId, unitId: key.unitId });
    return finish(logged, key, (s) => recompute({ ...s, keys: s.keys.filter((k) => k.id !== key.id), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export function updateKey(keyId: ID, patch: Partial<Pick<KeyItem, "type" | "identifier" | "unitId" | "notes">>): Command<KeyItem> {
  return (store) => {
    const prev = store.keys.find((k) => k.id === keyId);
    if (!prev) throw new Error("Key not found");
    const next: KeyItem = { ...prev, ...patch, identifier: patch.identifier === undefined ? prev.identifier : patch.identifier.trim() || prev.identifier };
    const audited = auditChanges({ ...store, keys: replaceById(store.keys, next) }, "key", next.id, `${labelize(next.type)} ${next.identifier}`, prev, next);
    return finish(audited.store, next, (s) => recompute(removeAudit({ ...s, keys: replaceById(s.keys, prev) }, audited.entryIds)));
  };
}

export function issueKey(keyId: ID, input: { assignedTo: string; tenantId?: ID | null; date?: ISODate }): Command<KeyItem> {
  return (store) => {
    const prev = store.keys.find((k) => k.id === keyId);
    if (!prev) throw new Error("Key not found");
    if (prev.status === "issued") throw new Error(`Already issued to ${prev.assignedTo ?? "someone"}`);
    if (prev.status === "lost") throw new Error("This key is recorded as lost — replace it first");
    if (!input.assignedTo.trim() && !input.tenantId) throw new Error("Say who receives the key");
    const tenant = input.tenantId ? indexStore(store).tenantById.get(input.tenantId) ?? null : null;
    const date = input.date ?? today();
    if (isAfter(date, today())) throw new Error("Issue date cannot be in the future");
    const next: KeyItem = { ...prev, status: "issued", assignedTo: input.assignedTo.trim() || tenant?.fullName || null, tenantId: input.tenantId ?? null, issuedDate: date, returnedDate: null };
    const audited = appendAudit({ ...store, keys: replaceById(store.keys, next) }, { action: "update", entityType: "key", entityId: next.id, entityLabel: `${labelize(next.type)} ${next.identifier}`, field: "status", previousValue: prev.status, newValue: `issued to ${next.assignedTo}` });
    const { store: logged, entry } = appendActivity(audited.store, { type: "key_issued", message: `${labelize(next.type)} ${next.identifier} issued to ${next.assignedTo}`, entityType: "key", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId: next.tenantId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, keys: replaceById(s.keys, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function returnKey(keyId: ID, input: { date?: ISODate } = {}): Command<KeyItem> {
  return (store) => {
    const prev = store.keys.find((k) => k.id === keyId);
    if (!prev) throw new Error("Key not found");
    if (prev.status !== "issued" && prev.status !== "lost") throw new Error("This key is not out");
    const date = input.date ?? today();
    if (prev.issuedDate && isAfter(prev.issuedDate, date)) throw new Error("Return date is before the issue date");
    const next: KeyItem = { ...prev, status: "returned", returnedDate: date, tenantId: null };
    const audited = appendAudit({ ...store, keys: replaceById(store.keys, next) }, { action: "update", entityType: "key", entityId: next.id, entityLabel: `${labelize(next.type)} ${next.identifier}`, field: "status", previousValue: prev.status, newValue: "returned" });
    const { store: logged, entry } = appendActivity(audited.store, { type: "key_returned", message: `${labelize(next.type)} ${next.identifier} returned${prev.assignedTo ? ` by ${prev.assignedTo}` : ""}${prev.status === "lost" ? " (was recorded lost)" : ""}`, entityType: "key", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId: prev.tenantId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, keys: replaceById(s.keys, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function markKeyLost(keyId: ID, note?: string | null): Command<KeyItem> {
  return (store) => {
    const prev = store.keys.find((k) => k.id === keyId);
    if (!prev) throw new Error("Key not found");
    if (prev.status === "lost") throw new Error("Already recorded as lost");
    const next: KeyItem = { ...prev, status: "lost", notes: note?.trim() ? `${prev.notes ? `${prev.notes}\n` : ""}Lost ${today()}: ${note.trim()}` : prev.notes };
    const audited = appendAudit({ ...store, keys: replaceById(store.keys, next) }, { action: "update", entityType: "key", entityId: next.id, entityLabel: `${labelize(next.type)} ${next.identifier}`, field: "status", previousValue: prev.status, newValue: "lost" });
    const { store: logged, entry } = appendActivity(audited.store, { type: "key_updated", message: `${labelize(next.type)} ${next.identifier} recorded as lost${prev.assignedTo ? ` (held by ${prev.assignedTo})` : ""} — consider changing the lock`, entityType: "key", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId: next.tenantId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, keys: replaceById(s.keys, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

/* -------------------------------------------------------------------------- */
/* Parking                                                                     */
/* -------------------------------------------------------------------------- */

export interface ParkingInput {
  propertyId: ID;
  spaceNumber: string;
  monthlyFee?: number;
  status?: ParkingSpace["status"];
  notes?: string | null;
}

export function addParkingSpace(input: ParkingInput): Command<ParkingSpace> {
  return (store) => {
    if (!indexStore(store).propertyById.get(input.propertyId)) throw new Error("Building not found");
    if (!input.spaceNumber.trim()) throw new Error("Number the space");
    if (store.parking.some((p) => p.propertyId === input.propertyId && p.spaceNumber.toLowerCase() === input.spaceNumber.trim().toLowerCase())) throw new Error("This space already exists in the building");
    if ((input.monthlyFee ?? 0) < 0) throw new Error("Fee cannot be negative");
    const space: ParkingSpace = { id: `${ids.parking(input.propertyId, input.spaceNumber.trim())}-${suffix()}`, propertyId: input.propertyId, spaceNumber: input.spaceNumber.trim(), unitId: null, tenantId: null, vehiclePlate: null, paid: (input.monthlyFee ?? 0) > 0, monthlyFee: input.monthlyFee ?? 0, status: input.status === "unavailable" || input.status === "reserved" ? input.status : "free", notes: input.notes?.trim() || null };
    const { store: logged, entry } = appendActivity({ ...store, parking: [...store.parking, space] }, { type: "parking_updated", message: `Parking space ${space.spaceNumber} added`, entityType: "parking", entityId: space.id, propertyId: space.propertyId });
    return finish(logged, space, (s) => recompute({ ...s, parking: s.parking.filter((p) => p.id !== space.id), activity: s.activity.filter((a) => a.id !== entry.id) }));
  };
}

export function updateParkingSpace(spaceId: ID, patch: Partial<Pick<ParkingSpace, "spaceNumber" | "monthlyFee" | "paid" | "status" | "notes" | "vehiclePlate">>): Command<ParkingSpace> {
  return (store) => {
    const prev = store.parking.find((p) => p.id === spaceId);
    if (!prev) throw new Error("Parking space not found");
    if (patch.monthlyFee !== undefined && patch.monthlyFee < 0) throw new Error("Fee cannot be negative");
    if (patch.status === "assigned" && !prev.unitId && !prev.tenantId) throw new Error("Use Assign to give the space to a unit or tenant");
    const next: ParkingSpace = { ...prev, ...patch, spaceNumber: patch.spaceNumber === undefined ? prev.spaceNumber : patch.spaceNumber.trim() || prev.spaceNumber };
    const audited = auditChanges({ ...store, parking: replaceById(store.parking, next) }, "parking", next.id, `Parking ${next.spaceNumber}`, prev, next);
    return finish(audited.store, next, (s) => recompute(removeAudit({ ...s, parking: replaceById(s.parking, prev) }, audited.entryIds)));
  };
}

export function assignParking(spaceId: ID, input: { unitId?: ID | null; tenantId?: ID | null; vehiclePlate?: string | null; paid?: boolean; monthlyFee?: number }): Command<ParkingSpace> {
  return (store) => {
    const idx = indexStore(store);
    const prev = store.parking.find((p) => p.id === spaceId);
    if (!prev) throw new Error("Parking space not found");
    if (prev.status === "assigned") throw new Error(`Space ${prev.spaceNumber} is already assigned`);
    if (prev.status === "unavailable") throw new Error(`Space ${prev.spaceNumber} is unavailable`);
    if (!input.unitId && !input.tenantId) throw new Error("Pick a unit or a tenant");
    const unit = input.unitId ? idx.unitById.get(input.unitId) ?? null : null;
    if (input.unitId && !unit) throw new Error("Unit not found");
    if (unit && unit.propertyId !== prev.propertyId) throw new Error("The unit is in another building");
    let tenantId = input.tenantId ?? null;
    if (!tenantId && unit) tenantId = store.contracts.find((c) => c.unitId === unit.id && isOccupying(c))?.tenantId ?? null;
    const tenant = tenantId ? idx.tenantById.get(tenantId) ?? null : null;
    if (tenantId && !tenant) throw new Error("Tenant not found");
    const monthlyFee = input.monthlyFee ?? prev.monthlyFee;
    if (monthlyFee < 0) throw new Error("Fee cannot be negative");
    const next: ParkingSpace = { ...prev, status: "assigned", unitId: unit?.id ?? null, tenantId, vehiclePlate: input.vehiclePlate?.trim() || null, paid: input.paid ?? monthlyFee > 0, monthlyFee };
    const audited = appendAudit({ ...store, parking: replaceById(store.parking, next) }, { action: "update", entityType: "parking", entityId: next.id, entityLabel: `Parking ${next.spaceNumber}`, field: "status", previousValue: prev.status, newValue: `assigned to ${unit?.unitNumber ?? tenant?.fullName ?? ""}` });
    const { store: logged, entry } = appendActivity(audited.store, { type: "parking_updated", message: `Parking ${next.spaceNumber} assigned to ${unit ? `unit ${unit.unitNumber}` : ""}${unit && tenant ? " · " : ""}${tenant?.fullName ?? ""}${next.vehiclePlate ? ` (${next.vehiclePlate})` : ""}${next.paid && next.monthlyFee > 0 ? ` · $${next.monthlyFee}/month` : " · included"}`, entityType: "parking", entityId: next.id, propertyId: next.propertyId, unitId: next.unitId, tenantId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, parking: replaceById(s.parking, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function releaseParking(spaceId: ID): Command<ParkingSpace> {
  return (store) => {
    const prev = store.parking.find((p) => p.id === spaceId);
    if (!prev) throw new Error("Parking space not found");
    if (prev.status !== "assigned" && prev.status !== "reserved") throw new Error(`Space ${prev.spaceNumber} is not assigned`);
    const next: ParkingSpace = { ...prev, status: "free", unitId: null, tenantId: null, vehiclePlate: null };
    const audited = appendAudit({ ...store, parking: replaceById(store.parking, next) }, { action: "update", entityType: "parking", entityId: next.id, entityLabel: `Parking ${next.spaceNumber}`, field: "status", previousValue: prev.status, newValue: "free" });
    const { store: logged, entry } = appendActivity(audited.store, { type: "parking_updated", message: `Parking ${next.spaceNumber} released`, entityType: "parking", entityId: next.id, propertyId: next.propertyId, unitId: prev.unitId, tenantId: prev.tenantId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, parking: replaceById(s.parking, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

/** Convenience for the move-out flow: everything issued to a tenant comes back in one step. */
export function returnAllKeys(tenantId: ID, date: ISODate = today()): Command<KeyItem[]> {
  return (store) => {
    const out = store.keys.filter((k) => k.tenantId === tenantId && k.status === "issued");
    if (out.length === 0) throw new Error("No keys are out with this tenant");
    let next = store;
    const undos: ((s: Store) => Store)[] = [];
    const results: KeyItem[] = [];
    for (const k of out) {
      const r = returnKey(k.id, { date })(next);
      next = r.store;
      results.push(r.result);
      if (r.undo) undos.push(r.undo);
    }
    return { store: next, result: results, undo: (s) => undos.reduceRight((acc, u) => u(acc), s) };
  };
}
