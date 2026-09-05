"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";

import { AddTenantDialog } from "@/components/flows/add-tenant-dialog";
import { ContractTermsDialog } from "@/components/flows/contract-terms-dialog";
import { ReminderDialog, type ReminderTarget } from "@/components/flows/reminder-dialog";
import { RenewalDecisionDialog } from "@/components/flows/renewal-decision-dialog";
import { PaymentDetailDialog } from "@/components/payments/payment-detail-dialog";
import { DepositDialog } from "@/components/finance/deposit-dialog";
import { AssetDialog, LogServiceDialog, PlanDialog } from "@/components/maintenance/asset-dialogs";
import { SupplierDialog } from "@/components/maintenance/supplier-dialog";
import { CompleteInspectionDialog, ScheduleInspectionDialog, type InspectionPrefill } from "@/components/operations/inspection-dialogs";
import { IssueKeyDialog, KeyDialog } from "@/components/operations/key-dialogs";
import { AssignParkingDialog, ParkingSpaceDialog } from "@/components/operations/parking-dialogs";
import { CompleteRenovationDialog, RenovationDialog, type RenovationPrefill } from "@/components/operations/renovation-dialogs";
import { DocumentReviewDialog } from "@/components/documents/document-review-dialog";
import { WorkOrderDialog, WorkOrderStatusDialog, type WorkOrderPrefill } from "@/components/maintenance/work-order-dialogs";
import { ExpenseDialog, type ExpensePrefill } from "@/components/finance/expense-dialog";
import { MarkLeavingDialog } from "@/components/flows/mark-leaving-dialog";
import { RecordPaymentDialog } from "@/components/flows/record-payment-dialog";
import { RenewContractDialog } from "@/components/flows/renew-contract-dialog";
import { completeReminder, resolveAlert } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { daysSince } from "@/lib/date";
import { useStoreContext } from "@/lib/data/store-context";
import type { AlertAction, ID, RenewalDecision, WorkOrderStatus, SupplierCategory } from "@/types";

export type DrawerTab = "tenant" | "contract" | "payments" | "documents" | "activity";

type Flow =
  | { kind: "record_payment"; paymentId: ID }
  | { kind: "renew"; contractId: ID }
  | { kind: "leaving"; contractId: ID }
  | { kind: "add_tenant"; unitId: ID }
  | { kind: "renewal_decision"; contractId: ID; initial?: RenewalDecision | null }
  | { kind: "contract_terms"; contractId: ID }
  | { kind: "reminder"; target: ReminderTarget }
  | { kind: "payment_detail"; paymentId: ID }
  | { kind: "expense"; expenseId?: ID; prefill?: ExpensePrefill }
  | { kind: "deposit"; depositId: ID }
  | { kind: "work_order"; workOrderId?: ID; prefill?: WorkOrderPrefill }
  | { kind: "work_order_status"; workOrderId: ID; initial?: WorkOrderStatus }
  | { kind: "asset"; assetId?: ID; propertyId?: ID | null }
  | { kind: "plan"; planId?: ID; defaults?: { propertyId?: ID | null; assetId?: ID | null } }
  | { kind: "log_service"; planId: ID }
  | { kind: "supplier"; supplierId?: ID; category?: SupplierCategory }
  | { kind: "inspection_schedule"; prefill?: InspectionPrefill }
  | { kind: "inspection_complete"; inspectionId: ID }
  | { kind: "key"; keyId?: ID; defaults?: { propertyId?: ID | null; unitId?: ID | null } }
  | { kind: "issue_key"; keyId: ID; tenantId?: ID | null }
  | { kind: "parking"; spaceId?: ID; propertyId?: ID | null }
  | { kind: "assign_parking"; spaceId: ID }
  | { kind: "renovation"; renovationId?: ID; prefill?: RenovationPrefill }
  | { kind: "renovation_complete"; renovationId: ID }
  | { kind: "document_review"; documentId: ID }
  | null;

export interface ActionsContextValue {
  /** Dispatch an alert action — navigation or a write flow. */
  perform: (action: AlertAction) => void;
  /** Open the unit inside its building page (the demo's default). */
  openUnit: (unitId: ID, tab?: DrawerTab) => void;
  /** Open the drawer over the current page — used by tables. */
  openUnitHere: (unitId: ID, tab?: DrawerTab) => void;
  /** The unit's full page (unit 360°). */
  openUnitPage: (unitId: ID, tab?: string) => void;
  openTenant: (tenantId: ID) => void;
  openProperty: (propertyId: ID) => void;
  openContract: (contractId: ID) => void;
  /** Write flows — open the corresponding dialog. */
  recordPayment: (paymentId: ID) => void;
  openPayment: (paymentId: ID) => void;
  addExpense: (prefill?: ExpensePrefill) => void;
  editExpense: (expenseId: ID) => void;
  openDeposit: (depositId: ID) => void;
  createWorkOrder: (prefill?: WorkOrderPrefill) => void;
  editWorkOrder: (workOrderId: ID) => void;
  openWorkOrder: (workOrderId: ID) => void;
  workOrderStatus: (workOrderId: ID, initial?: WorkOrderStatus) => void;
  openAsset: (assetId: ID) => void;
  addAsset: (propertyId?: ID | null) => void;
  editAsset: (assetId: ID) => void;
  addPlan: (defaults?: { propertyId?: ID | null; assetId?: ID | null }) => void;
  editPlan: (planId: ID) => void;
  logService: (planId: ID) => void;
  openSupplier: (supplierId: ID) => void;
  addSupplier: (category?: SupplierCategory) => void;
  editSupplier: (supplierId: ID) => void;
  openInspection: (inspectionId: ID) => void;
  scheduleInspection: (prefill?: InspectionPrefill) => void;
  completeInspection: (inspectionId: ID) => void;
  addKey: (defaults?: { propertyId?: ID | null; unitId?: ID | null }) => void;
  editKey: (keyId: ID) => void;
  issueKey: (keyId: ID, tenantId?: ID | null) => void;
  addParking: (propertyId?: ID | null) => void;
  editParking: (spaceId: ID) => void;
  assignParking: (spaceId: ID) => void;
  openRenovation: (renovationId: ID) => void;
  createRenovation: (prefill?: RenovationPrefill) => void;
  editRenovation: (renovationId: ID) => void;
  completeRenovation: (renovationId: ID) => void;
  reviewDocument: (documentId: ID) => void;
  renewContract: (contractId: ID) => void;
  markAsLeaving: (contractId: ID) => void;
  addTenant: (unitId: ID) => void;
  renewalDecision: (contractId: ID, initial?: RenewalDecision | null) => void;
  editContractTerms: (contractId: ID) => void;
  createReminder: (target: ReminderTarget) => void;
  sendReminder: (tenantId: ID) => void;
  uploadDocument: (targetId: ID) => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { store, run } = useStoreContext();
  const [flow, setFlow] = useState<Flow>(null);
  const closeFlow = useCallback(() => setFlow(null), []);

  const openUnit = useCallback(
    (unitId: ID, tab?: DrawerTab) => {
      const unit = indexStore(store).unitById.get(unitId);
      if (!unit) return;
      const params = new URLSearchParams({ unit: unitId });
      if (tab) params.set("tab", tab);
      router.push(`/properties/${unit.propertyId}?${params.toString()}`);
    },
    [router, store],
  );

  const openUnitHere = useCallback(
    (unitId: ID, tab?: DrawerTab) => {
      const params = new URLSearchParams(window.location.search);
      params.set("unit", unitId);
      if (tab && tab !== "tenant") params.set("tab", tab);
      else params.delete("tab");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const openUnitPage = useCallback((unitId: ID, tab?: string) => router.push(`/units/${unitId}${tab ? `?tab=${tab}` : ""}`), [router]);
  const openTenant = useCallback((tenantId: ID) => router.push(`/tenants/${tenantId}`), [router]);
  const openProperty = useCallback((propertyId: ID) => router.push(`/properties/${propertyId}`), [router]);

  const openContract = useCallback(
    (contractId: ID) => {
      const c = indexStore(store).contractById.get(contractId);
      if (c) openUnit(c.unitId, "contract");
    },
    [openUnit, store],
  );

  const recordPayment = useCallback((paymentId: ID) => setFlow({ kind: "record_payment", paymentId }), []);
  const openPayment = useCallback((paymentId: ID) => setFlow({ kind: "payment_detail", paymentId }), []);
  const addExpense = useCallback((prefill?: ExpensePrefill) => setFlow({ kind: "expense", prefill }), []);
  const editExpense = useCallback((expenseId: ID) => setFlow({ kind: "expense", expenseId }), []);
  const openDeposit = useCallback((depositId: ID) => setFlow({ kind: "deposit", depositId }), []);
  const createWorkOrder = useCallback((prefill?: WorkOrderPrefill) => setFlow({ kind: "work_order", prefill }), []);
  const editWorkOrder = useCallback((workOrderId: ID) => setFlow({ kind: "work_order", workOrderId }), []);
  const openWorkOrder = useCallback((workOrderId: ID) => router.push(`/maintenance/${workOrderId}`), [router]);
  const workOrderStatus = useCallback((workOrderId: ID, initial?: WorkOrderStatus) => setFlow({ kind: "work_order_status", workOrderId, initial }), []);
  const openAsset = useCallback((assetId: ID) => router.push(`/assets/${assetId}`), [router]);
  const addAsset = useCallback((propertyId?: ID | null) => setFlow({ kind: "asset", propertyId }), []);
  const editAsset = useCallback((assetId: ID) => setFlow({ kind: "asset", assetId }), []);
  const addPlan = useCallback((defaults?: { propertyId?: ID | null; assetId?: ID | null }) => setFlow({ kind: "plan", defaults }), []);
  const editPlan = useCallback((planId: ID) => setFlow({ kind: "plan", planId }), []);
  const logService = useCallback((planId: ID) => setFlow({ kind: "log_service", planId }), []);
  const openSupplier = useCallback((supplierId: ID) => router.push(`/suppliers/${supplierId}`), [router]);
  const addSupplier = useCallback((category?: SupplierCategory) => setFlow({ kind: "supplier", category }), []);
  const editSupplier = useCallback((supplierId: ID) => setFlow({ kind: "supplier", supplierId }), []);
  const openInspection = useCallback((inspectionId: ID) => router.push(`/inspections/${inspectionId}`), [router]);
  const scheduleInspection = useCallback((prefill?: InspectionPrefill) => setFlow({ kind: "inspection_schedule", prefill }), []);
  const completeInspection = useCallback((inspectionId: ID) => setFlow({ kind: "inspection_complete", inspectionId }), []);
  const addKey = useCallback((defaults?: { propertyId?: ID | null; unitId?: ID | null }) => setFlow({ kind: "key", defaults }), []);
  const editKey = useCallback((keyId: ID) => setFlow({ kind: "key", keyId }), []);
  const issueKey = useCallback((keyId: ID, tenantId?: ID | null) => setFlow({ kind: "issue_key", keyId, tenantId }), []);
  const addParking = useCallback((propertyId?: ID | null) => setFlow({ kind: "parking", propertyId }), []);
  const editParking = useCallback((spaceId: ID) => setFlow({ kind: "parking", spaceId }), []);
  const assignParking = useCallback((spaceId: ID) => setFlow({ kind: "assign_parking", spaceId }), []);
  const openRenovation = useCallback((renovationId: ID) => router.push(`/renovations/${renovationId}`), [router]);
  const createRenovation = useCallback((prefill?: RenovationPrefill) => setFlow({ kind: "renovation", prefill }), []);
  const editRenovation = useCallback((renovationId: ID) => setFlow({ kind: "renovation", renovationId }), []);
  const completeRenovation = useCallback((renovationId: ID) => setFlow({ kind: "renovation_complete", renovationId }), []);
  const reviewDocument = useCallback((documentId: ID) => setFlow({ kind: "document_review", documentId }), []);
  const renewContract = useCallback((contractId: ID) => setFlow({ kind: "renew", contractId }), []);
  const markAsLeaving = useCallback((contractId: ID) => setFlow({ kind: "leaving", contractId }), []);
  const addTenant = useCallback((unitId: ID) => setFlow({ kind: "add_tenant", unitId }), []);
  const renewalDecision = useCallback((contractId: ID, initial?: RenewalDecision | null) => setFlow({ kind: "renewal_decision", contractId, initial }), []);
  const editContractTerms = useCallback((contractId: ID) => setFlow({ kind: "contract_terms", contractId }), []);
  const createReminder = useCallback((target: ReminderTarget) => setFlow({ kind: "reminder", target }), []);

  const sendReminder = useCallback(
    (tenantId: ID) => {
      const t = indexStore(store).tenantById.get(tenantId);
      toast.success(`Reminder queued for ${t?.fullName ?? "tenant"}`, {
        description: "Messaging channels are not connected in this demo.",
      });
    },
    [store],
  );

  const uploadDocument = useCallback(
    (targetId: ID) => {
      const idx = indexStore(store);
      const contract = idx.contractById.get(targetId);
      if (contract) return openUnit(contract.unitId, "documents");
      const tenant = idx.tenantById.get(targetId);
      if (tenant) return openTenant(tenant.id);
    },
    [openUnit, openTenant, store],
  );

  const perform = useCallback(
    (action: AlertAction) => {
      switch (action.kind) {
        case "record_payment":
          return recordPayment(action.targetId);
        case "send_reminder":
          return sendReminder(action.targetId);
        case "renew_contract":
          return renewContract(action.targetId);
        case "mark_as_leaving":
          return markAsLeaving(action.targetId);
        case "view_unit":
          return openUnit(action.targetId);
        case "view_tenant":
          return openTenant(action.targetId);
        case "view_property":
          return openProperty(action.targetId);
        case "view_contract":
          return openContract(action.targetId);
        case "upload_document":
          return uploadDocument(action.targetId);
        case "view_expense":
        case "record_expense_payment":
          return editExpense(action.targetId);
        case "view_deposit":
        case "settle_deposit":
          return openDeposit(action.targetId);
        case "view_work_order":
          return openWorkOrder(action.targetId);
        case "view_asset":
          return openAsset(action.targetId);
        case "view_supplier":
          return openSupplier(action.targetId);
        case "view_inspection":
          return openInspection(action.targetId);
        case "view_renovation":
          return openRenovation(action.targetId);
        case "create_reminder": {
          const i = indexStore(store);
          const t = i.tenantById.get(action.targetId);
          if (t) return createReminder({ entityType: "tenant", entityId: t.id, label: t.fullName, title: `Follow up with ${t.fullName}` });
          const u = i.unitById.get(action.targetId);
          if (u) return createReminder({ entityType: "unit", entityId: u.id, label: `${i.propertyById.get(u.propertyId)?.name ?? ""} ${u.unitNumber}`.trim() });
          const p = i.propertyById.get(action.targetId);
          return createReminder({ entityType: p ? "property" : null, entityId: p?.id ?? null, label: p?.name ?? "Portfolio" });
        }
        case "resolve_alert": {
          const a = store.alerts.find((x) => x.id === action.targetId);
          if (!a) return;
          toast(`Mark "${a.title}" as handled?`, {
            description: "It stays hidden until the underlying condition changes.",
            action: {
              label: "Confirm",
              onClick: () => {
                const { undo } = run(resolveAlert(a.id, true));
                toast.success("Alert resolved", { action: undo ? { label: "Undo", onClick: undo } : undefined });
              },
            },
          });
          return;
        }
        case "complete_reminder": {
          const { undo } = run(completeReminder(action.targetId, true));
          toast.success("Reminder done", { action: undo ? { label: "Undo", onClick: undo } : undefined });
          return;
        }
        case "schedule_inspection": {
          const c = indexStore(store).contractById.get(action.targetId);
          if (!c) return scheduleInspection({});
          const hasMoveIn = store.inspections.some((i) => i.contractId === c.id && i.type === "move_in" && i.status !== "cancelled");
          return scheduleInspection({ contractId: c.id, type: !hasMoveIn && daysSince(c.startDate) <= store.settings.thresholds.inspectionOverdueDays ? "move_in" : "move_out" });
        }
        case "view_keys": {
          const k = store.keys.find((x) => x.id === action.targetId);
          return router.push(k ? `/keys?property=${k.propertyId}${k.unitId ? `&unit=${k.unitId}` : ""}` : "/keys");
        }
        case "view_plan":
          return router.push(`/maintenance/preventive?state=all`);
        case "schedule_service":
          return logService(action.targetId);
        case "approve_work_order":
          return workOrderStatus(action.targetId, "in_progress");
        case "create_work_order": {
          const i = indexStore(store);
          const asset = i.assetById.get(action.targetId);
          if (asset) return createWorkOrder({ propertyId: asset.propertyId, unitId: asset.unitId, assetId: asset.id, title: `${asset.name} — repair`, category: asset.assetType === "elevator" ? "elevator" : asset.assetType === "generator" ? "generator" : asset.assetType === "hvac" ? "hvac" : "other", priority: asset.status === "out_of_service" ? "emergency" : "high" });
          const insp = i.inspectionById.get(action.targetId);
          if (insp) {
            const item = insp.items.find((x) => x.followUpRequired && !x.workOrderId);
            return createWorkOrder({ propertyId: insp.propertyId, unitId: insp.unitId, assetId: insp.assetId, tenantId: insp.tenantId, inspectionId: insp.id, source: "inspection", title: item ? `${item.area} — ${item.item}` : "Inspection follow-up", description: item?.notes ?? undefined, category: "other" });
          }
          const unit = i.unitById.get(action.targetId);
          if (unit) return createWorkOrder({ propertyId: unit.propertyId, unitId: unit.id, title: "Change the lock — key lost", category: "other", priority: "high" });
          if (i.propertyById.get(action.targetId)) return createWorkOrder({ propertyId: action.targetId, title: "Change the lock — key lost", category: "security", priority: "high" });
          return createWorkOrder({});
        }
        case "view_budget": {
          const b = indexStore(store).budgetById.get(action.targetId);
          return router.push(b ? `/finance/budgets?type=${b.periodType}&period=${b.period}&property=${b.propertyId}` : "/finance/budgets");
        }
        default:
          return;
      }
    },
    [recordPayment, sendReminder, renewContract, markAsLeaving, openUnit, openTenant, openProperty, openContract, uploadDocument, editExpense, openDeposit, openWorkOrder, workOrderStatus, createWorkOrder, openAsset, logService, openSupplier, openInspection, scheduleInspection, openRenovation, createReminder, router, store, run],
  );

  const value = useMemo<ActionsContextValue>(
    () => ({ perform, openUnit, openUnitHere, openUnitPage, openTenant, openProperty, openContract, recordPayment, openPayment, addExpense, editExpense, openDeposit, createWorkOrder, editWorkOrder, openWorkOrder, workOrderStatus, openAsset, addAsset, editAsset, addPlan, editPlan, logService, openSupplier, addSupplier, editSupplier, openInspection, scheduleInspection, completeInspection, addKey, editKey, issueKey, addParking, editParking, assignParking, openRenovation, createRenovation, editRenovation, completeRenovation, reviewDocument, renewContract, markAsLeaving, addTenant, renewalDecision, editContractTerms, createReminder, sendReminder, uploadDocument }),
    [perform, openUnit, openUnitHere, openUnitPage, openTenant, openProperty, openContract, recordPayment, openPayment, addExpense, editExpense, openDeposit, createWorkOrder, editWorkOrder, openWorkOrder, workOrderStatus, openAsset, addAsset, editAsset, addPlan, editPlan, logService, openSupplier, addSupplier, editSupplier, openInspection, scheduleInspection, completeInspection, addKey, editKey, issueKey, addParking, editParking, assignParking, openRenovation, createRenovation, editRenovation, completeRenovation, reviewDocument, renewContract, markAsLeaving, addTenant, renewalDecision, editContractTerms, createReminder, sendReminder, uploadDocument],
  );

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {flow?.kind === "record_payment" && <RecordPaymentDialog key={flow.paymentId} paymentId={flow.paymentId} onClose={closeFlow} />}
      {flow?.kind === "renew" && <RenewContractDialog key={flow.contractId} contractId={flow.contractId} onClose={closeFlow} />}
      {flow?.kind === "leaving" && <MarkLeavingDialog key={flow.contractId} contractId={flow.contractId} onClose={closeFlow} />}
      {flow?.kind === "add_tenant" && <AddTenantDialog key={flow.unitId} unitId={flow.unitId} onClose={closeFlow} />}
      {flow?.kind === "renewal_decision" && <RenewalDecisionDialog key={flow.contractId} contractId={flow.contractId} initial={flow.initial} onClose={closeFlow} />}
      {flow?.kind === "contract_terms" && <ContractTermsDialog key={flow.contractId} contractId={flow.contractId} onClose={closeFlow} />}
      {flow?.kind === "work_order" && <WorkOrderDialog key={flow.workOrderId ?? "new"} workOrderId={flow.workOrderId} prefill={flow.prefill} onClose={closeFlow} />}
      {flow?.kind === "asset" && <AssetDialog key={flow.assetId ?? "new"} assetId={flow.assetId} defaultPropertyId={flow.propertyId} onClose={closeFlow} />}
      {flow?.kind === "plan" && <PlanDialog key={flow.planId ?? "new"} planId={flow.planId} defaults={flow.defaults} onClose={closeFlow} />}
      {flow?.kind === "supplier" && <SupplierDialog key={flow.supplierId ?? "new"} supplierId={flow.supplierId} defaultCategory={flow.category} onClose={closeFlow} />}
      {flow?.kind === "inspection_schedule" && <ScheduleInspectionDialog prefill={flow.prefill} onClose={closeFlow} onScheduled={(id) => router.push(`/inspections/${id}`)} />}
      {flow?.kind === "inspection_complete" && <CompleteInspectionDialog key={flow.inspectionId} inspectionId={flow.inspectionId} onClose={closeFlow} />}
      {flow?.kind === "key" && <KeyDialog key={flow.keyId ?? "new"} keyId={flow.keyId} defaults={flow.defaults} onClose={closeFlow} />}
      {flow?.kind === "issue_key" && <IssueKeyDialog key={flow.keyId} keyId={flow.keyId} defaultTenantId={flow.tenantId} onClose={closeFlow} />}
      {flow?.kind === "parking" && <ParkingSpaceDialog key={flow.spaceId ?? "new"} spaceId={flow.spaceId} defaultPropertyId={flow.propertyId} onClose={closeFlow} />}
      {flow?.kind === "renovation" && <RenovationDialog key={flow.renovationId ?? "new"} renovationId={flow.renovationId} prefill={flow.prefill} onClose={closeFlow} onCreated={(id) => router.push(`/renovations/${id}`)} />}
      {flow?.kind === "document_review" && <DocumentReviewDialog key={flow.documentId} documentId={flow.documentId} onClose={closeFlow} />}
      {flow?.kind === "renovation_complete" && <CompleteRenovationDialog key={flow.renovationId} renovationId={flow.renovationId} onClose={closeFlow} />}
      {flow?.kind === "assign_parking" && <AssignParkingDialog key={flow.spaceId} spaceId={flow.spaceId} onClose={closeFlow} />}
      {flow?.kind === "log_service" && <LogServiceDialog key={flow.planId} planId={flow.planId} onClose={closeFlow} />}
      {flow?.kind === "work_order_status" && <WorkOrderStatusDialog key={flow.workOrderId} workOrderId={flow.workOrderId} initial={flow.initial} onClose={closeFlow} />}
      {flow?.kind === "deposit" && <DepositDialog key={flow.depositId} depositId={flow.depositId} onClose={closeFlow} />}
      {flow?.kind === "expense" && <ExpenseDialog key={flow.expenseId ?? "new"} expenseId={flow.expenseId} prefill={flow.prefill} onClose={closeFlow} />}
      {flow?.kind === "payment_detail" && <PaymentDetailDialog key={flow.paymentId} paymentId={flow.paymentId} onClose={closeFlow} />}
      {flow?.kind === "reminder" && <ReminderDialog key={`${flow.target.entityType}-${flow.target.entityId}`} target={flow.target} onClose={closeFlow} />}
    </ActionsContext.Provider>
  );
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside <ActionsProvider>");
  return ctx;
}
