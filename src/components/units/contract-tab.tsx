"use client";

import { FileText, LogOut, Pencil, RefreshCw } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { ContractStatusBadge } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/units/tenant-tab";
import { daysUntil } from "@/lib/date";
import { formatDate, formatMoney, labelize, ordinal } from "@/lib/format";
import type { UnitDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { StoredDocument } from "@/types";

export function ContractTab({ details, onPreview }: { details: UnitDetails; onPreview: (doc: StoredDocument) => void }) {
  const { renewContract, markAsLeaving } = useActions();
  const c = details.contract;
  if (!c) return null;

  const remaining = daysUntil(c.endDate);
  const total = Math.max(1, daysUntil(c.endDate) - daysUntil(c.startDate));
  const elapsed = Math.min(total, Math.max(0, -daysUntil(c.startDate)));
  const progress = elapsed / total;
  const contractDoc = details.documents.find((d) => d.kind === "contract" && (d.contractId === c.id || d.contractId === null)) ?? null;
  const previous = details.history.filter((h) => h.id !== c.id && h.tenantId === c.tenantId);

  return (
    <div className="space-y-5">
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Contract</div>
            <div className="mt-0.5 font-mono text-sm font-medium">{c.contractNumber}</div>
          </div>
          <ContractStatusBadge status={c.status} />
        </div>
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span>{formatDate(c.startDate)}</span>
            <span className={cn("tabular font-semibold", remaining <= 7 ? "text-critical" : remaining <= 30 ? "text-warning-foreground" : "text-foreground")}>
              {remaining < 0 ? `Expired ${Math.abs(remaining)} days ago` : remaining === 0 ? "Ends today" : `${remaining} days remaining`}
            </span>
            <span>{formatDate(c.endDate)}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", remaining <= 30 ? "bg-warning" : "bg-foreground/70")} style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Monthly rent">
          <span className="tabular text-base font-semibold">{formatMoney(c.monthlyRent)}</span>
        </Field>
        <Field label="Deposit">
          <span className="tabular">{formatMoney(c.deposit)}</span>
        </Field>
        <Field label="Duration">{c.durationMonths} months</Field>
        <Field label="Payment day">{ordinal(c.paymentDay)} of the month</Field>
        <Field label="Method">{labelize(c.paymentMethod)}</Field>
        <Field label="Move-out">{c.moveOutDate ? formatDate(c.moveOutDate) : "—"}</Field>
      </dl>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Signed contract</div>
        {contractDoc ? (
          <button
            type="button"
            onClick={() => onPreview(contractDoc)}
            className="mt-1.5 flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left hover:bg-accent/60"
          >
            <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <FileText className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{contractDoc.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {contractDoc.fileName} · {contractDoc.sizeKb} KB
              </span>
            </span>
            <span className="text-xs font-medium text-brand">Preview</span>
          </button>
        ) : (
          <p className="mt-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">No signed copy uploaded yet.</p>
        )}
      </div>

      {previous.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">History</div>
          <ul className="mt-1.5 divide-y rounded-md border">
            {previous.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="font-mono">{h.contractNumber}</span>
                <span className="text-muted-foreground">
                  {formatDate(h.startDate)} → {formatDate(h.endDate)}
                </span>
                <span className="tabular">{formatMoney(h.monthlyRent)}</span>
                <ContractStatusBadge status={h.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={() => renewContract(c.id)}>
          <RefreshCw className="size-4" /> Renew
        </Button>
        <Button variant="outline" onClick={() => markAsLeaving(c.id)}>
          <LogOut className="size-4" /> Mark as leaving
        </Button>
        <Button variant="ghost">
          <Pencil className="size-4" /> Edit
        </Button>
      </div>
    </div>
  );
}
