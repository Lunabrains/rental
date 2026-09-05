"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { PiggyBank } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { daysSince } from "@/lib/date";
import { formatDate, formatMoney } from "@/lib/format";
import { getDeposits, summarizeDeposits, type DepositRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Filter = "all" | "held" | "settlement" | "pending" | "settled";

/** Security deposits (plan §Phase 6): received, held, deductions, settlement, refund. */
export function DepositsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openDeposit, openTenant } = useActions();
  const filter = (params.get("status") as Filter | null) ?? "all";
  const propertyId = params.get("property");

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/deposits${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const all = useMemo(() => getDeposits(store, { propertyId: propertyId ?? undefined }), [store, propertyId]);
  const summary = useMemo(() => summarizeDeposits(all), [all]);
  const rows = useMemo(
    () =>
      all.filter((r) => {
        switch (filter) {
          case "held":
            return r.deposit.status === "held" && !r.tenancyEnded;
          case "settlement":
            return r.deposit.status === "held" && r.tenancyEnded;
          case "pending":
            return r.deposit.status === "pending";
          case "settled":
            return r.deposit.status === "settled";
          default:
            return true;
        }
      }),
    [all, filter],
  );
  const counts = {
    all: all.length,
    held: all.filter((r) => r.deposit.status === "held" && !r.tenancyEnded).length,
    settlement: all.filter((r) => r.deposit.status === "held" && r.tenancyEnded).length,
    pending: all.filter((r) => r.deposit.status === "pending").length,
    settled: all.filter((r) => r.deposit.status === "settled").length,
  };

  const columns: Column<DepositRow>[] = [
    { key: "tenant", header: "Tenant", cell: (r) => <button type="button" className="font-medium hover:underline" onClick={(e) => { e.stopPropagation(); openTenant(r.tenant.id); }}>{r.tenant.fullName}</button>, value: (r) => r.tenant.fullName },
    { key: "where", header: "Building · Unit", cell: (r) => `${r.property.name} · ${r.unit.unitNumber}`, value: (r) => `${r.property.name} ${r.unit.unitNumber}` },
    { key: "contract", header: "Contract", cell: (r) => <span className="font-mono text-xs">{r.contract.contractNumber}</span>, value: (r) => r.contract.contractNumber },
    { key: "expected", header: "Expected", align: "right", cell: (r) => formatMoney(r.deposit.amountExpected), value: (r) => r.deposit.amountExpected },
    { key: "received", header: "Received", align: "right", cell: (r) => (r.deposit.amountReceived > 0 ? `${formatMoney(r.deposit.amountReceived)}` : <span className="text-warning-foreground">—</span>), value: (r) => r.deposit.amountReceived },
    { key: "deducted", header: "Deductions", align: "right", cell: (r) => (r.deducted > 0 ? <span className="text-critical">−{formatMoney(r.deducted)}</span> : "—"), value: (r) => r.deducted },
    { key: "held", header: "Held", align: "right", cell: (r) => <span className="font-medium">{formatMoney(r.deposit.amountHeld)}</span>, value: (r) => r.deposit.amountHeld },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.deposit.status} label={r.deposit.status === "held" && r.tenancyEnded ? "Awaiting settlement" : undefined} tone={r.deposit.status === "held" && r.tenancyEnded ? "warning" : undefined} />, value: (r) => r.deposit.status },
    { key: "ended", header: "Tenancy", cell: (r) => (r.tenancyEnded ? <span className={cn(r.deposit.status === "held" && daysSince(r.endedOn!) > 14 && "text-critical")}>ended {formatDate(r.endedOn)}{r.deposit.status === "held" ? ` · ${daysSince(r.endedOn!)}d ago` : ""}</span> : <span className="text-muted-foreground">current</span>), value: (r) => r.endedOn ?? "" },
    { key: "settled", header: "Refund", align: "right", cell: (r) => (r.deposit.settlementDate ? `${formatMoney(r.deposit.finalRefund ?? 0)} · ${formatDate(r.deposit.settlementDate)}` : "—"), value: (r) => r.deposit.finalRefund },
    { key: "act", header: "", sortable: false, noExport: true, cell: (r) => <Button size="sm" variant={r.deposit.status === "held" && r.tenancyEnded ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); openDeposit(r.deposit.id); }}>{r.deposit.status === "settled" ? "View" : r.tenancyEnded ? "Settle" : "Manage"}</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Security deposits" description={`${formatMoney(summary.held)} held across ${summary.heldCount} tenancies`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Held" value={formatMoney(summary.held)} sublabel={`${summary.heldCount} deposits`} icon={PiggyBank} />
        <KpiCard label="Awaiting settlement" value={summary.awaitingSettlementCount} tone={summary.awaitingSettlementCount > 0 ? "warning" : "success"} sublabel={summary.awaitingSettlementCount > 0 ? `${formatMoney(summary.awaitingSettlement)} to refund or deduct` : "Nothing to settle"} />
        <KpiCard label="Not yet received" value={summary.pendingCount} tone={summary.pendingCount > 0 ? "warning" : "success"} sublabel={summary.pendingCount > 0 ? `${formatMoney(summary.pending)} expected` : "All collected"} />
        <KpiCard label="Settled" value={counts.settled} sublabel="Refunded or deducted in full" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<Filter> aria-label="Status" value={filter} onChange={(v) => setParams({ status: v })} options={[{ value: "all", label: "All", count: counts.all }, { value: "settlement", label: "Awaiting settlement", count: counts.settlement }, { value: "pending", label: "Not received", count: counts.pending }, { value: "held", label: "Held", count: counts.held }, { value: "settled", label: "Settled", count: counts.settled }]} />
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.deposit.id} onRowClick={(r) => openDeposit(r.deposit.id)} dense pageSize={100} exportName="deposits" searchable={(r) => `${r.tenant.fullName} ${r.unit.unitNumber} ${r.property.name} ${r.contract.contractNumber}`} emptyTitle="No deposits match" emptyIcon={PiggyBank} rowClassName={(r) => (r.deposit.status === "held" && r.tenancyEnded ? "bg-warning-muted/30" : undefined)} />
    </div>
  );
}
