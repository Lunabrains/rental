"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Field, FlowDialog, Summary } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { markAsLeaving } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, formatMoney } from "@/lib/format";
import { getContractDetails } from "@/lib/queries";

export function MarkLeavingDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const details = useMemo(() => getContractDetails(store, contractId), [store, contractId]);
  const c = details?.contract ?? null;

  const [moveOutDate, setMoveOutDate] = useState(c ? (c.endDate >= today() ? c.endDate : today()) : today());
  const [applyNow, setApplyNow] = useState(false);

  if (!details || !c) return null;
  const effective = applyNow ? today() : moveOutDate;

  function submit() {
    if (!c) return;
    const { result, undo } = run(markAsLeaving({ contractId, moveOutDate, applyNow }));
    toast.success(result.vacatedNow ? `${result.tenantName} moved out — unit ${result.unitNumber} is available` : `Notice recorded — ${result.tenantName} leaves ${formatDate(effective)}`, {
      description: result.vacatedNow ? "The square is white, a vacancy alert was raised and future rent rows were removed." : "The unit turns available on the move-out date.",
      action: undo ? { label: "Undo", onClick: undo } : undefined,
      duration: 8000,
    });
    onClose();
  }

  return (
    <FlowDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Mark as leaving"
      description={`${details.tenant.fullName} · ${details.property.name} ${details.unit.unitNumber}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={applyNow ? "destructive" : "default"} onClick={submit}>
            {applyNow ? "Move out now" : "Record notice"}
          </Button>
        </>
      }
    >
      <Summary
        rows={[
          ["Contract", c.contractNumber],
          ["Ends", formatDate(c.endDate)],
          ["Rent", `${formatMoney(c.monthlyRent)}/month`],
          ["Outstanding", details.totals.outstanding > 0 ? formatMoney(details.totals.outstanding) : "—"],
        ]}
      />
      <Field label="Move-out date" htmlFor="ml-date" hint="Rent is not owed for months after this date">
        <Input id="ml-date" type="date" value={moveOutDate} min={today()} disabled={applyNow} onChange={(e) => setMoveOutDate(e.target.value)} />
      </Field>
      <label className="flex items-start gap-3 rounded-md border p-3">
        <Switch checked={applyNow} onCheckedChange={setApplyNow} className="mt-0.5" />
        <span>
          <span className="block text-sm font-medium">Apply now</span>
          <span className="block text-xs text-muted-foreground">Ends the contract today: the unit becomes available immediately and a vacancy alert is raised.</span>
        </span>
      </label>
    </FlowDialog>
  );
}
