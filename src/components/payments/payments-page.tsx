"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { CreditCard } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { PaymentStatusBadge } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { PageHeader } from "@/components/common/page-header";
import { PaymentsDashboard } from "@/components/payments/payments-dashboard";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { getPayments, type PaymentRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/types";

type StatusFilter = "open" | "overdue" | "partial" | "due" | "scheduled" | "paid" | "waived" | "all";
type View = "ledger" | "overview";

const OPEN: PaymentStatus[] = ["overdue", "partial", "due"];

/** Payments: the ledger everyone knows, plus the dashboard view for money at risk. */
export function PaymentsPage() {
  const store = useStore();
  const { openPayment, recordPayment } = useActions();
  const router = useRouter();
  const params = useSearchParams();

  const view: View = params.get("view") === "overview" ? "overview" : "ledger";
  const status = ((params.get("status") as StatusFilter) ?? "open") as StatusFilter;
  const propertyId = params.get("property");

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "all" || (k === "status" && v === "open") || (k === "view" && v === "ledger")) sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/payments${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const rows = useMemo(() => getPayments(store), [store]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { open: 0, overdue: 0, partial: 0, due: 0, scheduled: 0, paid: 0, waived: 0, all: rows.length };
    for (const r of rows) {
      c[r.payment.status]++;
      if (OPEN.includes(r.payment.status)) c.open++;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => {
      if (propertyId && r.payment.propertyId !== propertyId) return false;
      if (status === "all") return true;
      if (status === "open") return OPEN.includes(r.payment.status);
      return r.payment.status === status;
    });
    return status === "open" || status === "overdue" || status === "partial"
      ? list.sort((a, b) => b.payment.daysLate - a.payment.daysLate || (a.payment.dueDate < b.payment.dueDate ? -1 : 1))
      : status === "due" || status === "scheduled"
        ? list.sort((a, b) => (a.payment.dueDate < b.payment.dueDate ? -1 : 1))
        : list;
  }, [rows, status, propertyId]);

  const outstanding = filtered.reduce((n, r) => n + r.outstanding, 0);

  const columns: Column<PaymentRow>[] = [
    { key: "tenant", header: "Tenant", cell: (r) => <span className="font-medium">{r.tenant.fullName}</span>, value: (r) => r.tenant.fullName },
    { key: "where", header: "Building · Unit", cell: (r) => <span className="text-muted-foreground">{r.property.name} · {r.unit.unitNumber}</span>, value: (r) => `${r.property.name} ${r.unit.unitNumber}` },
    { key: "period", header: "Period", cell: (r) => formatMonth(r.payment.periodMonth), value: (r) => r.payment.periodMonth },
    { key: "due", header: "Due", cell: (r) => <span className="text-muted-foreground">{formatDate(r.payment.dueDate)}</span>, value: (r) => r.payment.dueDate },
    { key: "amount", header: "Amount", align: "right", cell: (r) => formatMoney(r.payment.amountDue), value: (r) => r.payment.amountDue },
    { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => <span className={cn(r.outstanding > 0 && r.payment.dueDate < store.loadedAt.slice(0, 10) ? "font-medium text-critical" : "text-muted-foreground")}>{r.outstanding > 0 && r.payment.status !== "waived" ? formatMoney(r.outstanding) : "—"}</span>, value: (r) => r.outstanding },
    { key: "status", header: "Status", cell: (r) => <PaymentStatusBadge status={r.payment.status} daysLate={r.payment.daysLate} />, value: (r) => r.payment.status },
    { key: "paid", header: "Paid", cell: (r) => <span className="text-muted-foreground">{r.payment.paidDate ? formatDate(r.payment.paidDate) : "—"}</span>, value: (r) => r.payment.paidDate },
    { key: "method", header: "Method", cell: (r) => <span className="text-muted-foreground">{r.payment.method ? r.payment.method.replace("_", " ") : "—"}</span>, value: (r) => r.payment.method },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) =>
        OPEN.includes(r.payment.status) ? (
          <Button size="sm" variant={r.payment.status === "overdue" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); recordPayment(r.payment.id); }}>
            Record
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description={`${counts.overdue} overdue · ${counts.partial} partial · ${counts.due} due soon${view === "ledger" && outstanding > 0 ? ` · ${formatMoney(outstanding)} outstanding in view` : ""}`}
        actions={
          <Chips<View> aria-label="View" value={view} onChange={(v) => setParams({ view: v })} options={[{ value: "ledger", label: "Ledger" }, { value: "overview", label: "Overview" }]} />
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {view === "ledger" && (
          <Chips<StatusFilter>
            aria-label="Status"
            value={status}
            onChange={(v) => setParams({ status: v })}
            options={[
              { value: "open", label: "Needs action", count: counts.open },
              { value: "overdue", label: "Overdue", count: counts.overdue },
              { value: "partial", label: "Partial", count: counts.partial },
              { value: "due", label: "Due soon", count: counts.due },
              { value: "scheduled", label: "Scheduled", count: counts.scheduled },
              { value: "paid", label: "Paid", count: counts.paid },
              { value: "waived", label: "Waived", count: counts.waived },
              { value: "all", label: "All", count: counts.all },
            ]}
          />
        )}
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      {view === "overview" ? (
        <PaymentsDashboard propertyId={propertyId ?? undefined} />
      ) : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.payment.id}
          onRowClick={(r) => openPayment(r.payment.id)}
          rowClassName={(r) => (r.payment.status === "overdue" ? "bg-critical-muted/30" : undefined)}
          searchable={(r) => `${r.tenant.fullName} ${r.unit.unitNumber} ${r.property.name} ${r.payment.reference ?? ""}`}
          searchPlaceholder="Tenant, unit, reference…"
          exportName="payments"
          pageSize={100}
          emptyTitle="No payments match"
          emptyDescription={status === "open" ? "Every rent is settled — nothing needs action." : undefined}
          emptyIcon={CreditCard}
        />
      )}
    </div>
  );
}
