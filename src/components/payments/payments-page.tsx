"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CreditCard, Search } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { PaymentStatusBadge } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { getPayments } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/types";

type StatusFilter = "open" | "overdue" | "partial" | "due" | "scheduled" | "paid" | "waived" | "all";

const OPEN: PaymentStatus[] = ["overdue", "partial", "due"];
const PAGE = 100;

export function PaymentsPage() {
  const store = useStore();
  const { openUnitHere, recordPayment } = useActions();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const status = ((params.get("status") as StatusFilter) ?? "open") as StatusFilter;
  const propertyId = params.get("property") ?? "all";

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "all" || (k === "status" && v === "open")) sp.delete(k);
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
    const q = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (propertyId !== "all" && r.payment.propertyId !== propertyId) return false;
      if (q && !`${r.tenant.fullName} ${r.unit.unitNumber} ${r.property.name} ${r.payment.reference ?? ""}`.toLowerCase().includes(q)) return false;
      if (status === "all") return true;
      if (status === "open") return OPEN.includes(r.payment.status);
      return r.payment.status === status;
    });
    // Open items: most overdue first; everything else: by due date.
    return status === "open" || status === "overdue" || status === "partial"
      ? list.sort((a, b) => b.payment.daysLate - a.payment.daysLate || (a.payment.dueDate < b.payment.dueDate ? -1 : 1))
      : status === "due" || status === "scheduled"
        ? list.sort((a, b) => (a.payment.dueDate < b.payment.dueDate ? -1 : 1))
        : list;
  }, [rows, status, propertyId, query]);

  const outstanding = filtered.reduce((n, r) => n + r.outstanding, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payments"
        description={`${counts.overdue} overdue · ${counts.partial} partial · ${counts.due} due soon${outstanding > 0 ? ` · ${formatMoney(outstanding)} outstanding in view` : ""}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusFilter>
          aria-label="Status"
          value={status}
          onChange={(v) => {
            setLimit(PAGE);
            setParams({ status: v });
          }}
          options={[
            { value: "open", label: "Needs action", count: counts.open },
            { value: "overdue", label: "Overdue", count: counts.overdue },
            { value: "partial", label: "Partial", count: counts.partial },
            { value: "due", label: "Due soon", count: counts.due },
            { value: "scheduled", label: "Scheduled", count: counts.scheduled },
            { value: "paid", label: "Paid", count: counts.paid },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
        <Select value={propertyId} onValueChange={(v) => setParams({ property: v })}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Building" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buildings</SelectItem>
            {store.properties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tenant, unit, reference…"
            className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments match" description={status === "open" ? "Every rent is settled — nothing needs action." : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Tenant</th>
                  <th className="px-4 py-2.5 font-medium">Building · Unit</th>
                  <th className="px-4 py-2.5 font-medium">Period</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Paid</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="tabular">
                {filtered.slice(0, limit).map((r) => {
                  const p = r.payment;
                  const actionable = OPEN.includes(p.status);
                  return (
                    <tr
                      key={p.id}
                      className={cn("cursor-pointer border-t transition-colors hover:bg-accent/60", p.status === "overdue" && "bg-critical-muted/30")}
                      onClick={() => (actionable ? recordPayment(p.id) : openUnitHere(r.unit.id, "payments"))}
                    >
                      <td className="px-4 py-2.5 font-medium">{r.tenant.fullName}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.property.name} · {r.unit.unitNumber}
                      </td>
                      <td className="px-4 py-2.5">{formatMonth(p.periodMonth)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatDate(p.dueDate)}</td>
                      <td className="px-4 py-2.5 text-right">{formatMoney(p.amountDue)}</td>
                      <td className={cn("px-4 py-2.5 text-right", r.outstanding > 0 && p.dueDate < store.loadedAt.slice(0, 10) ? "font-medium text-critical" : "text-muted-foreground")}>
                        {r.outstanding > 0 ? formatMoney(r.outstanding) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <PaymentStatusBadge status={p.status} daysLate={p.daysLate} />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{p.paidDate ? formatDate(p.paidDate) : "—"}</td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {actionable && (
                          <Button size="sm" variant={p.status === "overdue" ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => recordPayment(p.id)}>
                            Record
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > limit && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>
                Showing {limit} of {filtered.length}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
