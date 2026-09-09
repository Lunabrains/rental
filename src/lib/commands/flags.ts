import { indexStore } from "@/lib/data/store";
import { isISODate, today } from "@/lib/date";
import { isOccupying } from "@/lib/derived/occupancy";
import { recompute } from "@/lib/derived/recompute";
import type { Contract, ID, ISODate, Tenant } from "@/types";

import { appendActivity, appendAudit, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Two flags the owner reads off the building grid at a glance:
 *  - a complaint (red): an open dispute between the manager and the tenant;
 *  - تعهد بالإخلاء (orange): the tenant signed an undertaking to vacate by a date.
 * Both are audited and undoable like every other write.
 */

export interface ComplaintInput {
  summary: string;
  openedOn?: ISODate;
}

export function openComplaint(tenantId: ID, input: ComplaintInput): Command<Tenant> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.tenantById.get(tenantId);
    if (!prev) throw new Error("Tenant not found");
    const summary = input.summary.trim();
    if (!summary) throw new Error("Describe the complaint in a few words");
    const openedOn = input.openedOn && isISODate(input.openedOn) ? input.openedOn : today();
    const next: Tenant = { ...prev, complaint: { openedOn, summary } };
    const current = store.contracts.find((c) => c.tenantId === prev.id && isOccupying(c)) ?? null;
    const audited = appendAudit({ ...store, tenants: replaceById(store.tenants, next) }, { action: "update", entityType: "tenant", entityId: prev.id, entityLabel: prev.fullName, field: "complaint", previousValue: prev.complaint?.summary ?? null, newValue: summary });
    const { store: logged, entry } = appendActivity(audited.store, { type: "complaint_opened", message: `Complaint ${prev.complaint ? "updated" : "opened"} — ${prev.fullName}: ${summary}`, entityType: "tenant", entityId: prev.id, tenantId: prev.id, propertyId: current?.propertyId, unitId: current?.unitId, contractId: current?.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, tenants: replaceById(s.tenants, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function resolveComplaint(tenantId: ID, resolution?: string | null): Command<Tenant> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.tenantById.get(tenantId);
    if (!prev) throw new Error("Tenant not found");
    if (!prev.complaint) throw new Error("No open complaint");
    const note = resolution?.trim() || null;
    const stamp = `${today()} — Complaint resolved${note ? `: ${note}` : ""} (was: ${prev.complaint.summary})`;
    const next: Tenant = { ...prev, complaint: null, notes: prev.notes ? `${stamp}\n${prev.notes}` : stamp };
    const current = store.contracts.find((c) => c.tenantId === prev.id && isOccupying(c)) ?? null;
    const audited = appendAudit({ ...store, tenants: replaceById(store.tenants, next) }, { action: "update", entityType: "tenant", entityId: prev.id, entityLabel: prev.fullName, field: "complaint", previousValue: prev.complaint.summary, newValue: null });
    const { store: logged, entry } = appendActivity(audited.store, { type: "complaint_resolved", message: `Complaint resolved — ${prev.fullName}${note ? `: ${note}` : ""}`, entityType: "tenant", entityId: prev.id, tenantId: prev.id, propertyId: current?.propertyId, unitId: current?.unitId, contractId: current?.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, tenants: replaceById(s.tenants, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export interface VacateInput {
  vacateBy: ISODate;
  signedOn?: ISODate;
  notes?: string | null;
}

/** تعهد بالإخلاء — the tenant signed an undertaking to vacate by a date. */
export function recordVacateUndertaking(contractId: ID, input: VacateInput): Command<Contract> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.contractById.get(contractId);
    if (!prev) throw new Error("Contract not found");
    if (!isISODate(input.vacateBy)) throw new Error("Pick the date the tenant agreed to vacate by");
    const signedOn = input.signedOn && isISODate(input.signedOn) ? input.signedOn : today();
    if (input.vacateBy < signedOn) throw new Error("The vacate date cannot be before the signing date");
    const tenant = idx.tenantById.get(prev.tenantId);
    const unit = idx.unitById.get(prev.unitId);
    const next: Contract = { ...prev, vacateUndertaking: { signedOn, vacateBy: input.vacateBy, notes: input.notes?.trim() || null } };
    const audited = appendAudit({ ...store, contracts: replaceById(store.contracts, next) }, { action: "update", entityType: "contract", entityId: prev.id, entityLabel: prev.contractNumber, field: "vacateUndertaking", previousValue: prev.vacateUndertaking?.vacateBy ?? null, newValue: input.vacateBy });
    const { store: logged, entry } = appendActivity(audited.store, { type: "vacate_undertaking_recorded", message: `تعهد بالإخلاء — ${tenant?.fullName ?? "Tenant"} agreed to vacate ${unit?.unitNumber ?? "the unit"} by ${input.vacateBy}`, entityType: "contract", entityId: prev.id, tenantId: prev.tenantId, propertyId: prev.propertyId, unitId: prev.unitId, contractId: prev.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, contracts: replaceById(s.contracts, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}

export function clearVacateUndertaking(contractId: ID): Command<Contract> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.contractById.get(contractId);
    if (!prev) throw new Error("Contract not found");
    if (!prev.vacateUndertaking) throw new Error("No undertaking on this contract");
    const tenant = idx.tenantById.get(prev.tenantId);
    const next: Contract = { ...prev, vacateUndertaking: null };
    const audited = appendAudit({ ...store, contracts: replaceById(store.contracts, next) }, { action: "update", entityType: "contract", entityId: prev.id, entityLabel: prev.contractNumber, field: "vacateUndertaking", previousValue: prev.vacateUndertaking.vacateBy, newValue: null });
    const { store: logged, entry } = appendActivity(audited.store, { type: "vacate_undertaking_cleared", message: `Undertaking to vacate withdrawn — ${tenant?.fullName ?? "Tenant"}`, entityType: "contract", entityId: prev.id, tenantId: prev.tenantId, propertyId: prev.propertyId, unitId: prev.unitId, contractId: prev.id });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, contracts: replaceById(s.contracts, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id])));
  };
}
