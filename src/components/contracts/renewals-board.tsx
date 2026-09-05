"use client";

import { useMemo } from "react";
import { BellPlus, CalendarClock, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { DataTable, type Column } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { ScoreBadge } from "@/components/common/score";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { setRenewalDecision } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney } from "@/lib/format";
import { getRenewals, summarizeRenewals, type RenewalRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The expiring-contracts screen (plan §Phase 3): every contract ending in the
 * window with its renewal status, proposed rent and one-click decisions —
 * no spreadsheet needed.
 */
export function RenewalsBoard({ days, propertyId }: { days: number; propertyId?: string }) {
  const { store, run } = useStoreContext();
  const { renewContract, markAsLeaving, renewalDecision, createReminder, openTenant, openUnitHere } = useActions();
  const rows = useMemo(() => getRenewals(store, days, propertyId), [store, days, propertyId]);
  const summary = useMemo(() => summarizeRenewals(rows), [rows]);

  function quick(row: RenewalRow, decision: "renew" | "do_not_renew" | "awaiting_decision") {
    const { undo } = run(setRenewalDecision({ contractId: row.contract.id, decision, proposedRent: decision === "renew" ? row.suggestedRent ?? row.contract.monthlyRent : decision === "do_not_renew" ? null : undefined }));
    toast.success(`${decision === "renew" ? "Marked to renew" : decision === "do_not_renew" ? "Marked not to renew" : "Awaiting decision"} — ${row.tenant.fullName}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
  }

  const columns: Column<RenewalRow>[] = [
    {
      key: "tenant",
      header: "Tenant",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{r.tenant.fullName}</span>
          {r.hasOverdue && <StatusBadge value="overdue" label="Overdue rent" />}
        </span>
      ),
      value: (r) => r.tenant.fullName,
    },
    { key: "where", header: "Building · Unit", cell: (r) => `${r.property.name} · ${r.unit.unitNumber}`, value: (r) => `${r.property.name} ${r.unit.unitNumber}` },
    { key: "rent", header: "Current rent", align: "right", cell: (r) => formatMoney(r.contract.monthlyRent), value: (r) => r.contract.monthlyRent },
    { key: "expiry", header: "Expiry", cell: (r) => formatDate(r.contract.endDate), value: (r) => r.contract.endDate },
    { key: "days", header: "Days left", align: "right", cell: (r) => <span className={cn("font-medium", r.daysRemaining < 0 ? "text-critical" : r.daysRemaining <= 7 ? "text-critical" : r.daysRemaining <= 30 ? "text-warning-foreground" : "")}>{r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d over` : r.daysRemaining}</span>, value: (r) => r.daysRemaining },
    { key: "reliability", header: "Reliability", cell: (r) => <ScoreBadge size="sm" score={r.reliability.score} label={`Payment reliability · ${r.reliability.label}`} components={r.reliability.components} scale={1} caption="Internal indicator from this ledger only." />, value: (r) => r.reliability.score },
    { key: "status", header: "Renewal", cell: (r) => <StatusBadge value={r.contract.renewalStatus} />, value: (r) => r.contract.renewalStatus },
    { key: "proposed", header: "Proposed rent", align: "right", cell: (r) => (r.contract.proposedRent ? <span className="font-medium">{formatMoney(r.contract.proposedRent)}</span> : r.suggestedRent ? <span className="text-muted-foreground" title={r.clauseSuggestion ?? undefined}>{formatMoney(r.suggestedRent)} · {r.clauseSuggestion}</span> : "—"), value: (r) => r.contract.proposedRent ?? r.suggestedRent },
    { key: "notes", header: "Notes", cell: (r) => <span className="block max-w-56 truncate text-xs text-muted-foreground" title={r.contract.renewalNotes ?? undefined}>{r.contract.renewalNotes ?? "—"}</span>, sortable: false },
    {
      key: "actions",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.contract.renewalStatus !== "renew" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" title="Mark to renew" onClick={() => quick(r, "renew")}>
              <Check className="size-3.5" /> Renew
            </Button>
          )}
          {r.contract.renewalStatus !== "do_not_renew" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" title="Mark not to renew" onClick={() => quick(r, "do_not_renew")}>
              <X className="size-3.5" /> No
            </Button>
          )}
          {r.contract.renewalStatus !== "awaiting_decision" && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Awaiting decision" onClick={() => quick(r, "awaiting_decision")}>
              <CalendarClock className="size-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Decision with proposed rent and notes" onClick={() => renewalDecision(r.contract.id)}>
            Details
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Create reminder" onClick={() => createReminder({ entityType: "contract", entityId: r.contract.id, label: `${r.tenant.fullName} · ${r.contract.contractNumber}`, title: `Follow up renewal with ${r.tenant.fullName}` })}>
            <BellPlus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Open tenant" onClick={() => openTenant(r.tenant.id)}>
            <ExternalLink className="size-3.5" />
          </Button>
          {r.contract.renewalStatus === "renew" && (
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => renewContract(r.contract.id)}>
              Run renewal
            </Button>
          )}
          {r.contract.renewalStatus === "do_not_renew" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => markAsLeaving(r.contract.id)}>
              Mark leaving
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label={`Ending within ${days} days`} value={summary.total} sublabel={`${formatMoney(summary.rentAtStake)}/month at stake`} />
        <KpiCard label="No decision yet" value={summary.undecided} tone={summary.undecided > 0 ? "warning" : "success"} sublabel="Needs a call" />
        <KpiCard label="Awaiting decision" value={summary.awaiting} tone={summary.awaiting > 0 ? "warning" : "default"} sublabel="In negotiation" />
        <KpiCard label="Renewing" value={summary.renew} tone="success" sublabel="Run the renewal when signed" />
        <KpiCard label="Not renewing" value={summary.doNotRenew} tone={summary.doNotRenew > 0 ? "critical" : "default"} sublabel={summary.expired > 0 ? `${summary.expired} already expired` : "Units becoming vacant"} />
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.contract.id}
        onRowClick={(r) => openUnitHere(r.unit.id, "contract")}
        defaultSort={{ key: "days", dir: "asc" }}
        exportName="contracts-expiring"
        searchable={(r) => `${r.tenant.fullName} ${r.contract.contractNumber} ${r.unit.unitNumber} ${r.property.name}`}
        emptyTitle={`No contracts end within ${days} days`}
        rowClassName={(r) => (r.contract.renewalStatus === "do_not_renew" ? "bg-critical-muted/20" : r.contract.renewalStatus === "renew" ? "bg-success-muted/20" : undefined)}
      />
    </div>
  );
}
