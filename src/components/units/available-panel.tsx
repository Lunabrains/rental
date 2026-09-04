"use client";

import { Pencil, UserPlus } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/units/tenant-tab";
import { formatDate, formatMoney } from "@/lib/format";
import type { UnitDetails } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function AvailablePanel({ details }: { details: UnitDetails }) {
  const { addTenant, openTenant } = useActions();
  const u = details.unit;
  const days = details.daysVacant;
  const lastContract = details.history.find((c) => c.tenantId === details.previousTenant?.id) ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-unit-available-border bg-unit-available p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Asking rent</div>
            <div className="tabular mt-0.5 text-2xl font-semibold">
              {u.askingRent > 0 ? formatMoney(u.askingRent) : "—"}
              <span className="text-sm font-normal text-muted-foreground">/month</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Vacant</div>
            <div className={cn("tabular mt-0.5 text-2xl font-semibold", days !== null && days > 60 ? "text-critical" : days !== null && days > 45 ? "text-warning-foreground" : "text-foreground")}>
              {days === null ? "—" : `${days}d`}
            </div>
          </div>
        </div>
        {days !== null && u.askingRent > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {formatMoney(Math.round((u.askingRent / 30) * days))} of rent missed since {formatDate(u.availableSince)}.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Size">{u.sizeSqm} m²</Field>
        <Field label="Bedrooms">{u.bedrooms}</Field>
        <Field label="Bathrooms">{u.bathrooms}</Field>
        <Field label="Furnished">{u.furnished ? "Yes" : "No"}</Field>
        <Field label="Deposit">{u.askingDeposit > 0 ? formatMoney(u.askingDeposit) : "—"}</Field>
        <Field label="Last rent">{u.lastRent ? formatMoney(u.lastRent) : "—"}</Field>
      </dl>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Previous tenant</div>
        {details.previousTenant ? (
          <button
            type="button"
            onClick={() => openTenant(details.previousTenant!.id)}
            className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-md border bg-card p-3 text-left hover:bg-accent/60"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{details.previousTenant.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {lastContract ? `${formatDate(lastContract.startDate)} → ${formatDate(lastContract.moveOutDate ?? lastContract.endDate)} · ${formatMoney(lastContract.monthlyRent)}/mo` : "On record"}
                {lastContract?.notes ? ` · ${lastContract.notes}` : ""}
              </span>
            </span>
            <span className="text-xs font-medium text-brand">Profile</span>
          </button>
        ) : (
          <p className="mt-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">No previous tenant on record.</p>
        )}
      </div>

      {u.notes && <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{u.notes}</p>}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={() => addTenant(u.id)}>
          <UserPlus className="size-4" /> Add tenant
        </Button>
        <Button variant="ghost">
          <Pencil className="size-4" /> Edit
        </Button>
      </div>
    </div>
  );
}
