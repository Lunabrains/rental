import { indexStore } from "@/lib/data/store";
import { recompute } from "@/lib/derived/recompute";
import { formatMoney } from "@/lib/format";
import type { Contract, ID, RenewalDecision, Store, Tenant } from "@/types";

import { appendActivity, auditChanges, finish, removeAudit, replaceById, type Command } from "./core";

/**
 * Contract intelligence writes (plan §Phase 3): renewal decisions, the
 * clause / terms fields and notes. Rent, dates and the tenant never change
 * here — those go through renew / add-tenant / mark-as-leaving, which
 * regenerate schedules and are confirmed by the owner.
 */

export interface RenewalDecisionInput {
  contractId: ID;
  decision: RenewalDecision | null;
  proposedRent?: number | null;
  notes?: string | null;
}

export function setRenewalDecision(input: RenewalDecisionInput): Command<Contract> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.contractById.get(input.contractId);
    if (!prev) throw new Error("Contract not found");
    if (input.proposedRent !== undefined && input.proposedRent !== null && input.proposedRent < 0) throw new Error("Proposed rent cannot be negative");
    const contract: Contract = {
      ...prev,
      renewalDecision: input.decision,
      proposedRent: input.proposedRent === undefined ? prev.proposedRent : input.proposedRent,
      renewalNotes: input.notes === undefined ? prev.renewalNotes : input.notes?.trim() || null,
    };
    const tenant = idx.tenantById.get(prev.tenantId);
    const audited = auditChanges({ ...store, contracts: replaceById(store.contracts, contract) }, "contract", contract.id, `${contract.contractNumber} · ${tenant?.fullName ?? "Tenant"}`, prev, contract, ["renewalStatus"]);
    const label = input.decision === "renew" ? "Marked to renew" : input.decision === "do_not_renew" ? "Marked not to renew" : input.decision === "awaiting_decision" ? "Renewal decision pending" : "Renewal decision cleared";
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "renewal_decision",
      message: `${label} — ${tenant?.fullName ?? "Tenant"} · ${contract.contractNumber}${contract.proposedRent ? ` · proposed ${formatMoney(contract.proposedRent)}` : ""}`,
      entityType: "contract",
      entityId: contract.id,
      propertyId: contract.propertyId,
      unitId: contract.unitId,
      tenantId: contract.tenantId,
      contractId: contract.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, contracts: replaceById(s.contracts, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, contract, undo);
  };
}

export type ContractTermsPatch = Partial<Pick<Contract, "rentIncreaseClause" | "specialTerms" | "notes" | "proposedRent" | "renewalNotes" | "paymentDay" | "paymentMethod">>;

export function updateContractTerms(contractId: ID, patch: ContractTermsPatch): Command<Contract> {
  return (store) => {
    const idx = indexStore(store);
    const prev = idx.contractById.get(contractId);
    if (!prev) throw new Error("Contract not found");
    if (patch.paymentDay !== undefined && (patch.paymentDay < 1 || patch.paymentDay > 28)) throw new Error("Payment day must be between 1 and 28");
    if (patch.proposedRent !== undefined && patch.proposedRent !== null && patch.proposedRent < 0) throw new Error("Proposed rent cannot be negative");
    const contract: Contract = { ...prev, ...patch };
    const tenant = idx.tenantById.get(prev.tenantId);
    const audited = auditChanges({ ...store, contracts: replaceById(store.contracts, contract) }, "contract", contract.id, `${contract.contractNumber} · ${tenant?.fullName ?? "Tenant"}`, prev, contract);
    const { store: logged, entry } = appendActivity(audited.store, {
      type: "contract_updated",
      message: `Contract ${contract.contractNumber} terms updated`,
      entityType: "contract",
      entityId: contract.id,
      propertyId: contract.propertyId,
      unitId: contract.unitId,
      tenantId: contract.tenantId,
      contractId: contract.id,
    });
    const undo = (s: Store): Store => recompute(removeAudit({ ...s, contracts: replaceById(s.contracts, prev), activity: s.activity.filter((a) => a.id !== entry.id) }, audited.entryIds));
    return finish(logged, contract, undo);
  };
}

/** Free-text notes on a tenant profile (complaints, calls, agreements). */
export function updateTenantNotes(tenantId: ID, notes: string | null): Command<Tenant> {
  return (store) => {
    const prev = indexStore(store).tenantById.get(tenantId);
    if (!prev) throw new Error("Tenant not found");
    const tenant: Tenant = { ...prev, notes: notes?.trim() || null };
    const { store: logged, entry } = appendActivity({ ...store, tenants: replaceById(store.tenants, tenant) }, {
      type: "tenant_updated",
      message: `Notes updated for ${tenant.fullName}`,
      entityType: "tenant",
      entityId: tenant.id,
      tenantId: tenant.id,
    });
    const undo = (s: Store): Store => recompute({ ...s, tenants: replaceById(s.tenants, prev), activity: s.activity.filter((a) => a.id !== entry.id) });
    return finish(logged, tenant, undo);
  };
}
