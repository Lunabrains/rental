"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";

import { AddTenantDialog } from "@/components/flows/add-tenant-dialog";
import { ContractTermsDialog } from "@/components/flows/contract-terms-dialog";
import { ReminderDialog, type ReminderTarget } from "@/components/flows/reminder-dialog";
import { RenewalDecisionDialog } from "@/components/flows/renewal-decision-dialog";
import { MarkLeavingDialog } from "@/components/flows/mark-leaving-dialog";
import { RecordPaymentDialog } from "@/components/flows/record-payment-dialog";
import { RenewContractDialog } from "@/components/flows/renew-contract-dialog";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import type { AlertAction, ID, RenewalDecision } from "@/types";

export type DrawerTab = "tenant" | "contract" | "payments" | "documents" | "activity";

type Flow =
  | { kind: "record_payment"; paymentId: ID }
  | { kind: "renew"; contractId: ID }
  | { kind: "leaving"; contractId: ID }
  | { kind: "add_tenant"; unitId: ID }
  | { kind: "renewal_decision"; contractId: ID; initial?: RenewalDecision | null }
  | { kind: "contract_terms"; contractId: ID }
  | { kind: "reminder"; target: ReminderTarget }
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
  const { store } = useStoreContext();
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
      }
    },
    [recordPayment, sendReminder, renewContract, markAsLeaving, openUnit, openTenant, openProperty, openContract, uploadDocument],
  );

  const value = useMemo<ActionsContextValue>(
    () => ({ perform, openUnit, openUnitHere, openUnitPage, openTenant, openProperty, openContract, recordPayment, renewContract, markAsLeaving, addTenant, renewalDecision, editContractTerms, createReminder, sendReminder, uploadDocument }),
    [perform, openUnit, openUnitHere, openUnitPage, openTenant, openProperty, openContract, recordPayment, renewContract, markAsLeaving, addTenant, renewalDecision, editContractTerms, createReminder, sendReminder, uploadDocument],
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
      {flow?.kind === "reminder" && <ReminderDialog key={`${flow.target.entityType}-${flow.target.entityId}`} target={flow.target} onClose={closeFlow} />}
    </ActionsContext.Provider>
  );
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside <ActionsProvider>");
  return ctx;
}
