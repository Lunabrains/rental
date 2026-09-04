"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";

import { AddTenantDialog } from "@/components/flows/add-tenant-dialog";
import { MarkLeavingDialog } from "@/components/flows/mark-leaving-dialog";
import { RecordPaymentDialog } from "@/components/flows/record-payment-dialog";
import { RenewContractDialog } from "@/components/flows/renew-contract-dialog";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import type { AlertAction, ID } from "@/types";

export type DrawerTab = "tenant" | "contract" | "payments" | "documents" | "activity";

type Flow =
  | { kind: "record_payment"; paymentId: ID }
  | { kind: "renew"; contractId: ID }
  | { kind: "leaving"; contractId: ID }
  | { kind: "add_tenant"; unitId: ID }
  | null;

export interface ActionsContextValue {
  /** Dispatch an alert action — navigation or a write flow. */
  perform: (action: AlertAction) => void;
  openUnit: (unitId: ID, tab?: DrawerTab) => void;
  openTenant: (tenantId: ID) => void;
  openProperty: (propertyId: ID) => void;
  openContract: (contractId: ID) => void;
  /** Write flows — open the corresponding dialog. */
  recordPayment: (paymentId: ID) => void;
  renewContract: (contractId: ID) => void;
  markAsLeaving: (contractId: ID) => void;
  addTenant: (unitId: ID) => void;
  sendReminder: (tenantId: ID) => void;
  uploadDocument: (targetId: ID) => void;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
    () => ({ perform, openUnit, openTenant, openProperty, openContract, recordPayment, renewContract, markAsLeaving, addTenant, sendReminder, uploadDocument }),
    [perform, openUnit, openTenant, openProperty, openContract, recordPayment, renewContract, markAsLeaving, addTenant, sendReminder, uploadDocument],
  );

  return (
    <ActionsContext.Provider value={value}>
      {children}
      {flow?.kind === "record_payment" && <RecordPaymentDialog key={flow.paymentId} paymentId={flow.paymentId} onClose={closeFlow} />}
      {flow?.kind === "renew" && <RenewContractDialog key={flow.contractId} contractId={flow.contractId} onClose={closeFlow} />}
      {flow?.kind === "leaving" && <MarkLeavingDialog key={flow.contractId} contractId={flow.contractId} onClose={closeFlow} />}
      {flow?.kind === "add_tenant" && <AddTenantDialog key={flow.unitId} unitId={flow.unitId} onClose={closeFlow} />}
    </ActionsContext.Provider>
  );
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used inside <ActionsProvider>");
  return ctx;
}
