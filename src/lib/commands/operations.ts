import { freshId, ids, shortHash } from "@/lib/data/ids";
import { indexStore } from "@/lib/data/store";
import { nowISO, today } from "@/lib/date";
import { recompute } from "@/lib/derived/recompute";
import { mimeFor } from "@/lib/import/apply";
import type { AlertEntityType, DocumentCategory, DocumentKind, ID, ISODate, Reminder, Store, StoredDocument } from "@/types";

import { appendActivity, appendAudit, finish, removeAudit, replaceById, type Command, auditChanges } from "./core";

/**
 * Cross-cutting writes shared by every module: documents, reminders and
 * alert resolution. Feature modules (expenses, maintenance, …) live in their
 * own files and follow the same shape — undoable, audited, recomputed.
 */

/* -------------------------------- Documents ------------------------------- */

export interface AddDocumentInput {
  title: string;
  fileName: string;
  mimeType?: string;
  sizeKb: number;
  category: DocumentCategory;
  kind?: DocumentKind;
  /** Object URL created by the uploader — kept for this session only. */
  dataUrl: string | null;
  issuedDate?: ISODate | null;
  expiryDate?: ISODate | null;
  links: Partial<Pick<StoredDocument, "tenantId" | "contractId" | "unitId" | "propertyId" | "paymentId" | "expenseId" | "workOrderId" | "assetId" | "supplierId" | "inspectionId" | "renovationId">>;
}

const KIND_FOR_CATEGORY: Partial<Record<DocumentCategory, DocumentKind>> = { tenant_id: "id", lease: "contract", receipt: "receipt" };

export function addDocument(input: AddDocumentInput): Command<StoredDocument> {
  return (store) => {
    const idx = indexStore(store);
    const links = input.links;
    // Fill in the building / unit / tenant from whatever the document is attached to.
    const contract = links.contractId ? idx.contractById.get(links.contractId) : undefined;
    const workOrder = links.workOrderId ? idx.workOrderById.get(links.workOrderId) : undefined;
    const expense = links.expenseId ? idx.expenseById.get(links.expenseId) : undefined;
    const asset = links.assetId ? idx.assetById.get(links.assetId) : undefined;
    const inspection = links.inspectionId ? idx.inspectionById.get(links.inspectionId) : undefined;
    const renovation = links.renovationId ? idx.renovationById.get(links.renovationId) : undefined;
    const unitId = links.unitId ?? contract?.unitId ?? workOrder?.unitId ?? expense?.unitId ?? asset?.unitId ?? inspection?.unitId ?? renovation?.unitId ?? null;
    const unit = unitId ? idx.unitById.get(unitId) : undefined;
    const propertyId = links.propertyId ?? contract?.propertyId ?? workOrder?.propertyId ?? expense?.propertyId ?? asset?.propertyId ?? inspection?.propertyId ?? renovation?.propertyId ?? unit?.propertyId ?? null;
    const tenantId = links.tenantId ?? contract?.tenantId ?? workOrder?.tenantId ?? inspection?.tenantId ?? null;
    const owner = tenantId ?? links.supplierId ?? asset?.id ?? workOrder?.id ?? expense?.id ?? propertyId ?? "portfolio";
    const kind = input.kind ?? KIND_FOR_CATEGORY[input.category] ?? "other";

    const doc: StoredDocument = {
      id: ids.document(owner, kind, `${input.fileName}-${Date.now()}`),
      kind,
      category: input.category,
      title: input.title.trim() || input.fileName,
      fileName: input.fileName,
      mimeType: input.mimeType ?? mimeFor(input.fileName),
      sizeKb: Math.max(1, Math.round(input.sizeKb)),
      tenantId,
      contractId: links.contractId ?? null,
      unitId,
      propertyId,
      paymentId: links.paymentId ?? null,
      expenseId: links.expenseId ?? null,
      workOrderId: links.workOrderId ?? null,
      assetId: links.assetId ?? null,
      supplierId: links.supplierId ?? null,
      inspectionId: links.inspectionId ?? null,
      renovationId: links.renovationId ?? null,
      issuedDate: input.issuedDate ?? null,
      expiryDate: input.expiryDate ?? null,
      uploadedAt: today(),
      generated: false,
      dataUrl: input.dataUrl,
      deleted: false,
    };
    const next: Store = { ...store, documents: [...store.documents, doc] };
    const { store: logged, entry } = appendActivity(next, {
      type: "document_added",
      message: `Document added — ${doc.title}`,
      entityType: workOrder ? "work_order" : asset ? "asset" : expense ? "expense" : tenantId ? "tenant" : propertyId ? "property" : "portfolio",
      entityId: workOrder?.id ?? asset?.id ?? expense?.id ?? tenantId ?? propertyId ?? "portfolio",
      propertyId,
      unitId,
      tenantId,
      contractId: links.contractId ?? null,
      workOrderId: links.workOrderId ?? null,
      assetId: links.assetId ?? null,
      expenseId: links.expenseId ?? null,
    });
    const undo = (s: Store): Store => recompute({ ...s, documents: s.documents.filter((d) => d.id !== doc.id), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, doc, undo);
  };
}

export type DocumentPatch = Partial<Pick<StoredDocument, "title" | "category" | "kind" | "tenantId" | "contractId" | "unitId" | "propertyId" | "supplierId" | "assetId" | "workOrderId" | "expenseId" | "issuedDate" | "expiryDate">>;

/** File a document: category, links and dates. The upload itself is untouched. */
export function updateDocument(documentId: ID, patch: DocumentPatch): Command<StoredDocument> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.documentById.get(documentId);
    if (!prev) throw new Error("Document not found");
    const check = (key: keyof DocumentPatch, map: Map<ID, unknown>, label: string) => {
      const id = patch[key];
      if (id && !map.has(id as ID)) throw new Error(`${label} not found`);
    };
    check("tenantId", idx.tenantById, "Tenant");
    check("contractId", idx.contractById, "Contract");
    check("unitId", idx.unitById, "Unit");
    check("propertyId", idx.propertyById, "Building");
    check("supplierId", idx.supplierById, "Supplier");
    check("assetId", idx.assetById, "Asset");
    check("workOrderId", idx.workOrderById, "Work order");
    check("expenseId", idx.expenseById, "Expense");
    const kind = patch.kind ?? (patch.category ? KIND_FOR_CATEGORY[patch.category] ?? (patch.category === prev.category ? prev.kind : "other") : prev.kind);
    const next: StoredDocument = { ...prev, ...patch, kind, title: patch.title === undefined ? prev.title : patch.title.trim() || prev.title };
    if (next.issuedDate && next.expiryDate && next.expiryDate < next.issuedDate) throw new Error("Expiry is before the issue date");
    const audited = auditChanges({ ...store, documents: replaceById(store.documents, next) }, "document", next.id, next.title, prev, next, ["dataUrl", "extraction", "reviewedAt"]);
    const { store: logged, entry } = appendActivity(audited.store, { type: "document_added", message: `Document filed — ${next.title} (${next.category.replace(/_/g, " ")})`, entityType: next.tenantId ? "tenant" : next.assetId ? "asset" : next.supplierId ? "supplier" : next.propertyId ? "property" : "portfolio", entityId: next.tenantId ?? next.assetId ?? next.supplierId ?? next.propertyId ?? "portfolio", propertyId: next.propertyId, unitId: next.unitId, tenantId: next.tenantId, contractId: next.contractId, assetId: next.assetId, supplierId: next.supplierId, expenseId: next.expenseId });
    return finish(logged, next, (s) => recompute(removeAudit({ ...s, documents: replaceById(s.documents, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds)));
  };
}

/** Record what was read and that the owner confirmed it. Not audited — the filing itself is. */
export function markDocumentReviewed(documentId: ID, extraction: NonNullable<StoredDocument["extraction"]>): Command<StoredDocument> {
  return (store) => {
    const prev = indexStore(store).documentById.get(documentId);
    if (!prev) throw new Error("Document not found");
    const next: StoredDocument = { ...prev, extraction, reviewedAt: extraction.at };
    return { store: { ...store, documents: replaceById(store.documents, next) }, result: next, undo: (s) => ({ ...s, documents: replaceById(s.documents, prev) }) };
  };
}

/** Soft delete — the record stays for the audit trail; the file is hidden everywhere. */
export function deleteDocument(documentId: ID): Command<StoredDocument> {
  return (store) => {
    const prev = indexStore(store).documentById.get(documentId);
    if (!prev) throw new Error("Document not found");
    const doc: StoredDocument = { ...prev, deleted: true };
    const audited = appendAudit({ ...store, documents: replaceById(store.documents, doc) }, {
      action: "delete",
      entityType: "document",
      entityId: doc.id,
      entityLabel: doc.title,
      previousValue: doc.fileName,
      newValue: null,
    });
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "document_deleted",
      message: `Document removed — ${doc.title}`,
      entityType: doc.tenantId ? "tenant" : doc.propertyId ? "property" : "portfolio",
      entityId: doc.tenantId ?? doc.propertyId ?? "portfolio",
      propertyId: doc.propertyId,
      unitId: doc.unitId,
      tenantId: doc.tenantId,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, documents: replaceById(s.documents, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, [audited.entry.id]));
    return finish(logged, doc, undo);
  };
}

export function restoreDocument(documentId: ID): Command<StoredDocument> {
  return (store) => {
    const prev = indexStore(store).documentById.get(documentId);
    if (!prev) throw new Error("Document not found");
    const doc: StoredDocument = { ...prev, deleted: false };
    const audited = appendAudit({ ...store, documents: replaceById(store.documents, doc) }, { action: "restore", entityType: "document", entityId: doc.id, entityLabel: doc.title });
    return finish(audited.store, doc, (s) => recompute(removeAudit({ ...s, documents: replaceById(s.documents, prev) }, [audited.entry.id])));
  };
}

/* -------------------------------- Reminders ------------------------------- */

export interface CreateReminderInput {
  title: string;
  note?: string | null;
  dueDate: ISODate;
  entityType?: AlertEntityType | null;
  entityId?: ID | null;
  createdBy?: Reminder["createdBy"];
}

export function createReminder(input: CreateReminderInput): Command<Reminder> {
  return (store) => {
    const idx = indexStore(store);
    let propertyId: ID | null = null;
    let unitId: ID | null = null;
    let tenantId: ID | null = null;
    if (input.entityId) {
      switch (input.entityType) {
        case "tenant": {
          tenantId = input.entityId;
          const current = (idx.contractsByTenant.get(input.entityId) ?? []).find((c) => c.status === "active" || c.status === "notice_given");
          propertyId = current?.propertyId ?? null;
          unitId = current?.unitId ?? null;
          break;
        }
        case "unit": {
          const u = idx.unitById.get(input.entityId);
          unitId = u?.id ?? null;
          propertyId = u?.propertyId ?? null;
          break;
        }
        case "contract": {
          const c = idx.contractById.get(input.entityId);
          propertyId = c?.propertyId ?? null;
          unitId = c?.unitId ?? null;
          tenantId = c?.tenantId ?? null;
          break;
        }
        case "property":
          propertyId = input.entityId;
          break;
        case "work_order": {
          const w = idx.workOrderById.get(input.entityId);
          propertyId = w?.propertyId ?? null;
          unitId = w?.unitId ?? null;
          break;
        }
        case "asset": {
          const a = idx.assetById.get(input.entityId);
          propertyId = a?.propertyId ?? null;
          unitId = a?.unitId ?? null;
          break;
        }
        default:
          break;
      }
    }
    const reminder: Reminder = {
      id: freshId("rem"),
      title: input.title.trim(),
      note: input.note?.trim() || null,
      dueDate: input.dueDate,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      propertyId,
      unitId,
      tenantId,
      done: false,
      doneAt: null,
      createdBy: input.createdBy ?? "owner",
      createdAt: nowISO(),
    };
    const next: Store = { ...store, reminders: [reminder, ...store.reminders] };
    const { store: logged, entry } = appendActivity(next, {
      type: "reminder_created",
      message: `Reminder set for ${input.dueDate} — ${reminder.title}`,
      entityType: "reminder",
      entityId: reminder.id,
      propertyId,
      unitId,
      tenantId,
    });
    const undo = (s: Store): Store => recompute({ ...s, reminders: s.reminders.filter((r) => r.id !== reminder.id), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, reminder, undo);
  };
}

export function completeReminder(reminderId: ID, done = true): Command<Reminder> {
  return (store) => {
    const prev = indexStore(store).reminderById.get(reminderId);
    if (!prev) throw new Error("Reminder not found");
    const reminder: Reminder = { ...prev, done, doneAt: done ? nowISO() : null };
    const next: Store = { ...store, reminders: replaceById(store.reminders, reminder) };
    const { store: logged, entry } = appendActivity(next, {
      type: "reminder_done",
      message: done ? `Reminder done — ${reminder.title}` : `Reminder reopened — ${reminder.title}`,
      entityType: "reminder",
      entityId: reminder.id,
      propertyId: reminder.propertyId,
      unitId: reminder.unitId,
      tenantId: reminder.tenantId,
    });
    const undo = (s: Store): Store => recompute({ ...s, reminders: replaceById(s.reminders, prev), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, reminder, undo);
  };
}

export function deleteReminder(reminderId: ID): Command {
  return (store) => {
    const prev = indexStore(store).reminderById.get(reminderId);
    if (!prev) throw new Error("Reminder not found");
    return finish({ ...store, reminders: store.reminders.filter((r) => r.id !== reminderId) }, undefined, (s) => recompute({ ...s, reminders: [prev, ...s.reminders] }));
  };
}

/* --------------------------------- Alerts --------------------------------- */

/** Mark an alert handled. It stays hidden until its condition changes. */
export function resolveAlert(alertId: string, resolved = true): Command {
  return (store) => {
    const prev = store.alerts.find((a) => a.id === alertId);
    if (!prev) throw new Error("Alert not found");
    const alerts = store.alerts.map((a) => (a.id === alertId ? { ...a, resolved, resolvedAt: resolved ? nowISO() : null, read: true } : a));
    const { store: logged, entry } = appendActivity({ ...store, alerts }, {
      type: "alert_resolved",
      message: resolved ? `Alert resolved — ${prev.title}` : `Alert reopened — ${prev.title}`,
      entityType: prev.entityType,
      entityId: prev.entityId,
      propertyId: prev.propertyId,
      unitId: prev.unitId,
      tenantId: prev.tenantId,
    });
    return {
      store: logged,
      result: undefined,
      undo: (s) => ({ ...s, alerts: s.alerts.map((a) => (a.id === alertId ? { ...a, resolved: prev.resolved, resolvedAt: prev.resolvedAt } : a)), activity: s.activity.filter((a) => a.id !== entry.id) }),
    };
  };
}

/** Stable id for generated documents (receipts, exports). */
export function generatedDocumentId(owner: ID, kind: string, seed: string): ID {
  return `d-${owner}-${kind}-${shortHash(seed)}`;
}
