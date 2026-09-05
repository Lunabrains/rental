"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, MoneyInput, Summary } from "@/components/flows/flow-shell";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { setRenewalDecision } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney } from "@/lib/format";
import { getContractDetails, suggestFromClause } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { RENEWAL_DECISIONS, type RenewalDecision } from "@/types";

const LABELS: Record<RenewalDecision, string> = { awaiting_decision: "Awaiting decision", renew: "Renew", do_not_renew: "Do not renew" };
const HINTS: Record<RenewalDecision, string> = {
  awaiting_decision: "Keeps the contract on the renewals list with a pending badge.",
  renew: "Records the intent; the new contract is created when you run Renew.",
  do_not_renew: "Flags the unit as becoming vacant on the end date.",
};

/** Records the owner's renewal intent without touching the contract terms. */
export function RenewalDecisionDialog({ contractId, initial, onClose }: { contractId: string; initial?: RenewalDecision | null; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const details = useMemo(() => getContractDetails(store, contractId), [store, contractId]);
  const c = details?.contract ?? null;
  const clause = c ? suggestFromClause(c.monthlyRent, c.rentIncreaseClause) : null;
  const [decision, setDecision] = useState<RenewalDecision | null>(initial ?? c?.renewalDecision ?? "awaiting_decision");
  const [proposed, setProposed] = useState<number>(c?.proposedRent ?? clause?.rent ?? c?.monthlyRent ?? 0);
  const [notes, setNotes] = useState(c?.renewalNotes ?? "");

  if (!details || !c) return null;

  function submit() {
    if (!c) return;
    const { undo } = run(setRenewalDecision({ contractId, decision, proposedRent: decision === "do_not_renew" ? null : proposed || null, notes }));
    toast.success(`${decision ? LABELS[decision] : "Decision cleared"} — ${details!.tenant.fullName}`, {
      description: decision === "do_not_renew" ? `${details!.property.name} ${details!.unit.unitNumber} becomes vacant on ${formatDate(c.endDate)}.` : proposed ? `Proposed rent ${formatMoney(proposed)}.` : undefined,
      action: undo ? { label: "Undo", onClick: undo } : undefined,
      duration: 6000,
    });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Renewal decision"
      description={`${details.tenant.fullName} · ${details.property.name} ${details.unit.unitNumber} · ends ${formatDate(c.endDate)} (${details.daysRemaining} days)`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save decision</Button>
        </>
      }
    >
      <Summary
        rows={[
          ["Current rent", formatMoney(c.monthlyRent)],
          ["Increase clause", c.rentIncreaseClause ?? "—"],
          ["Payment record", `${details.totals.lateCount === 0 ? "never late" : `${details.totals.lateCount}× late`}${details.totals.outstanding > 0 ? ` · ${formatMoney(details.totals.outstanding)} outstanding` : ""}`],
          ["Current status", <StatusBadge key="s" value={c.renewalStatus} />],
        ]}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        {RENEWAL_DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={cn("rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent/60", decision === d && "border-primary ring-2 ring-primary/20")}
          >
            <span className="block font-medium">{LABELS[d]}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{HINTS[d]}</span>
          </button>
        ))}
      </div>
      {decision !== "do_not_renew" && (
        <Field label="Proposed new rent" htmlFor="rd-rent" hint={clause ? `${clause.label}: ${formatMoney(clause.rent)}` : "Optional — what you intend to offer"}>
          <div className="flex gap-2">
            <div className="flex-1">
              <MoneyInput id="rd-rent" value={proposed} onChange={setProposed} />
            </div>
            {clause && (
              <Button type="button" variant="outline" onClick={() => setProposed(clause.rent)}>
                Use clause
              </Button>
            )}
          </div>
        </Field>
      )}
      <Field label="Notes" htmlFor="rd-notes">
        <Textarea id="rd-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Negotiation notes, conditions, what the tenant asked for…" />
      </Field>
    </FlowDialog>
  );
}
