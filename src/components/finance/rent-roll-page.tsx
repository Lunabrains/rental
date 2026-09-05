"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { PaymentStatusBadge } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { addPeriods, currentPeriod } from "@/lib/date";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/lib/format";
import { getRentRoll, type RentRollFilter, type RentRollRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

type StatusChip = NonNullable<RentRollFilter["status"]>;
type Occupancy = NonNullable<RentRollFilter["occupancy"]>;

/**
 * Advanced rent roll (plan §Phase 4): every unit for a period with what was
 * due, paid and outstanding, filterable by building, occupancy, status,
 * arrears age and contract expiry. Exports to CSV / Excel.
 */
export function RentRollPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openPayment, openUnitPage, recordPayment } = useActions();

  const period = /^\d{4}-\d{2}$/.test(params.get("period") ?? "") ? params.get("period")! : currentPeriod();
  const propertyId = params.get("property");
  const occupancy = (params.get("occupancy") as Occupancy | null) ?? "all";
  const status = (params.get("status") as StatusChip | null) ?? "all";
  const overdueMin = Number(params.get("overdue") ?? 0) || 0;
  const expiring = params.get("expiring") === "1";

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "all" || v === "" || v === "0") sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/finance/rent-roll${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const roll = useMemo(() => getRentRoll(store, { period, propertyId: propertyId ?? undefined, occupancy, status, overdueMin, expiring }), [store, period, propertyId, occupancy, status, overdueMin, expiring]);
  const s = roll.summary;
  const isCurrent = period === currentPeriod();

  const columns: Column<RentRollRow>[] = [
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "unit", header: "Unit", cell: (r) => <span className="font-medium">{r.unit.unitNumber}</span>, value: (r) => r.unit.unitNumber },
    { key: "tenant", header: "Tenant", cell: (r) => r.tenant?.fullName ?? <span className="text-muted-foreground">Vacant</span>, value: (r) => r.tenant?.fullName ?? "" },
    { key: "rent", header: "Rent", align: "right", cell: (r) => (r.rent > 0 ? formatMoney(r.rent) : "—"), value: (r) => r.rent },
    { key: "due", header: "Due date", cell: (r) => formatDate(r.dueDate), value: (r) => r.dueDate },
    { key: "amountDue", header: "Amount due", align: "right", cell: (r) => (r.amountDue > 0 ? formatMoney(r.amountDue) : "—"), value: (r) => r.amountDue },
    { key: "paid", header: "Paid", align: "right", cell: (r) => (r.amountPaid > 0 ? formatMoney(r.amountPaid) : "—"), value: (r) => r.amountPaid },
    { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => (r.outstanding > 0 ? <span className="font-medium text-critical">{formatMoney(r.outstanding)}</span> : "—"), value: (r) => r.outstanding },
    { key: "status", header: "Status", cell: (r) => (r.status === "vacant" || r.status === "not_billed" ? <StatusBadge value={r.status} label={r.status === "not_billed" ? "Not billed this month" : undefined} /> : <PaymentStatusBadge status={r.status} daysLate={r.daysOverdue} />), value: (r) => r.status },
    { key: "overdue", header: "Days overdue", align: "right", cell: (r) => (r.daysOverdue > 0 ? <span className={cn(r.daysOverdue >= 30 && "font-medium text-critical")}>{r.daysOverdue}</span> : "—"), value: (r) => r.daysOverdue },
    { key: "deposit", header: "Deposit", align: "right", cell: (r) => (r.depositHeld > 0 ? formatMoney(r.depositHeld) : "—"), value: (r) => r.depositHeld },
    { key: "expiry", header: "Contract ends", cell: (r) => (r.contractEnd ? <span className={cn(r.daysToExpiry !== null && r.daysToExpiry <= 30 && "text-warning-foreground")}>{formatDate(r.contractEnd)}{r.daysToExpiry !== null && r.daysToExpiry >= 0 ? ` · ${r.daysToExpiry}d` : ""}</span> : "—"), value: (r) => r.contractEnd },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) =>
        r.payment && (r.status === "overdue" || r.status === "partial" || r.status === "due") ? (
          <Button size="sm" variant={r.status === "overdue" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); recordPayment(r.payment!.id); }}>
            Record
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Rent roll"
        description={`${formatMonth(period)}${isCurrent ? " · month to date" : ""} · ${s.occupied} occupied, ${s.vacant} vacant`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setParams({ period: addPeriods(period, -1) })}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" className="min-w-40" onClick={() => setParams({ period: null })}>
              {formatMonth(period)}
            </Button>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setParams({ period: addPeriods(period, 1) })} disabled={period >= addPeriods(currentPeriod(), 3)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Expected rent" value={formatMoney(s.expected)} sublabel={`Rent roll ${formatMoney(s.rentRoll)}/month`} />
        <KpiCard label="Collected" value={formatMoney(s.collected)} sublabel={`for ${formatMonth(period)}`} tone="success" />
        <KpiCard label="Outstanding" value={s.outstanding > 0 ? formatMoney(s.outstanding) : "—"} tone={s.outstanding > 0 ? "critical" : "success"} sublabel={s.outstanding > 0 ? "past due, unpaid" : "Nothing past due"} />
        <KpiCard label="Collection rate" value={formatPercent(s.collectionRate)} tone={s.collectionRate < 0.8 ? "warning" : "success"} sublabel={isCurrent ? "of rent due so far" : "of rent due"} />
        <KpiCard label="Overdue tenants" value={s.overdueTenants} tone={s.overdueTenants > 0 ? "critical" : "success"} sublabel={s.overdueTenants > 0 ? `${formatMoney(s.overdueAmount)} between them` : "Everyone is paid up"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusChip>
          aria-label="Payment status"
          value={status}
          onChange={(v) => setParams({ status: v })}
          options={[
            { value: "all", label: "All" },
            { value: "unpaid", label: "Overdue or partial" },
            { value: "overdue", label: "Overdue" },
            { value: "partial", label: "Partial" },
            { value: "paid", label: "Paid" },
            { value: "due", label: "Due soon" },
            { value: "waived", label: "Waived" },
          ]}
        />
        <Chips<string>
          aria-label="Arrears age"
          value={String(overdueMin)}
          onChange={(v) => setParams({ overdue: v })}
          options={[
            { value: "0", label: "Any age" },
            { value: "30", label: "30+ days" },
            { value: "60", label: "60+ days" },
            { value: "90", label: "90+ days" },
          ]}
        />
        <Chips<Occupancy> aria-label="Occupancy" value={occupancy} onChange={(v) => setParams({ occupancy: v })} options={[{ value: "all", label: "All units" }, { value: "occupied", label: "Occupied" }, { value: "vacant", label: "Vacant" }]} />
        <Chips<string> aria-label="Contract" value={expiring ? "1" : "0"} onChange={(v) => setParams({ expiring: v })} options={[{ value: "0", label: "Any contract" }, { value: "1", label: "Expiring ≤ 60d" }]} />
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <DataTable
        rows={roll.rows}
        columns={columns}
        rowKey={(r) => r.unit.id}
        onRowClick={(r) => (r.payment ? openPayment(r.payment.id) : openUnitPage(r.unit.id))}
        rowClassName={(r) => (r.status === "overdue" ? "bg-critical-muted/30" : r.status === "vacant" ? "text-muted-foreground" : undefined)}
        searchable={(r) => `${r.property.name} ${r.unit.unitNumber} ${r.tenant?.fullName ?? ""} ${r.payment?.reference ?? ""}`}
        searchPlaceholder="Tenant, unit, reference…"
        exportName={`rent-roll-${period}`}
        pageSize={200}
        dense
        emptyTitle="No units match these filters"
        emptyIcon={Receipt}
        totals={(rows) => [
          `${rows.length} units`,
          "",
          `${rows.filter((r) => r.occupied).length} occupied`,
          formatMoney(rows.reduce((n, r) => n + r.rent, 0)),
          "",
          formatMoney(rows.reduce((n, r) => n + r.amountDue, 0)),
          formatMoney(rows.reduce((n, r) => n + r.amountPaid, 0)),
          formatMoney(rows.reduce((n, r) => n + r.outstanding, 0)),
          "",
          "",
          formatMoney(rows.reduce((n, r) => n + r.depositHeld, 0)),
          "",
          "",
        ]}
      />
    </div>
  );
}
