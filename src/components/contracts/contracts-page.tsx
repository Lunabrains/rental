"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { ContractStatusBadge, NeutralPill } from "@/components/common/badges";
import { Chips } from "@/components/common/chips";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/data/store-context";
import { isOccupying } from "@/lib/derived/recompute";
import { formatDate, formatMoney } from "@/lib/format";
import { getContracts } from "@/lib/queries";
import { cn } from "@/lib/utils";

type StatusFilter = "active" | "expiring" | "expired" | "history" | "all";
type Window = "30" | "60" | "90";

export function ContractsPage() {
  const store = useStore();
  const { openUnitHere, renewContract } = useActions();
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState("");

  const expiringParam = params.get("expiring");
  const status: StatusFilter = expiringParam ? "expiring" : ((params.get("status") as StatusFilter) ?? "active");
  const window: Window = (["30", "60", "90"].includes(expiringParam ?? "") ? expiringParam : "30") as Window;
  const propertyId = params.get("property") ?? "all";

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "all") sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/contracts${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  const rows = useMemo(() => getContracts(store), [store]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const c = r.contract;
      if (propertyId !== "all" && c.propertyId !== propertyId) return false;
      if (q && !`${r.tenant.fullName} ${c.contractNumber} ${r.unit.unitNumber} ${r.property.name}`.toLowerCase().includes(q)) return false;
      switch (status) {
        case "active":
          return isOccupying(c);
        case "expiring":
          return isOccupying(c) && r.daysRemaining >= 0 && r.daysRemaining <= Number(window);
        case "expired":
          return c.status === "expired" || (isOccupying(c) && r.daysRemaining < 0);
        case "history":
          return c.status === "renewed" || c.status === "terminated";
        default:
          return true;
      }
    });
  }, [rows, status, window, propertyId, query]);

  const counts = useMemo(() => {
    const active = rows.filter((r) => isOccupying(r.contract));
    return {
      active: active.length,
      expiring: active.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= Number(window)).length,
      expired: rows.filter((r) => r.contract.status === "expired" || (isOccupying(r.contract) && r.daysRemaining < 0)).length,
      history: rows.filter((r) => r.contract.status === "renewed" || r.contract.status === "terminated").length,
      all: rows.length,
    };
  }, [rows, window]);

  return (
    <div className="space-y-5">
      <PageHeader title="Contracts" description={`${counts.active} active · ${counts.expiring} ending within ${window} days`} />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusFilter>
          aria-label="Status"
          value={status}
          onChange={(v) => setParams({ status: v === "active" ? null : v, expiring: v === "expiring" ? window : null })}
          options={[
            { value: "active", label: "Active", count: counts.active },
            { value: "expiring", label: `Expiring ${window}d`, count: counts.expiring },
            { value: "expired", label: "Expired", count: counts.expired },
            { value: "history", label: "History", count: counts.history },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
        {status === "expiring" && (
          <Select value={window} onValueChange={(v) => setParams({ expiring: v })}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["30", "60", "90"] as Window[]).map((w) => (
                <SelectItem key={w} value={w}>
                  Within {w} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
            placeholder="Tenant, contract no…"
            className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No contracts match" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Tenant</th>
                  <th className="px-4 py-2.5 font-medium">Building · Unit</th>
                  <th className="px-4 py-2.5 font-medium">Contract</th>
                  <th className="px-4 py-2.5 font-medium">Term</th>
                  <th className="px-4 py-2.5 text-right font-medium">Days left</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rent</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((r) => {
                  const c = r.contract;
                  const occupying = isOccupying(c);
                  return (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-t transition-colors hover:bg-accent/60"
                      onClick={() => openUnitHere(r.unit.id, "contract")}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{r.tenant.fullName}</span>
                          {r.hasOverdue && <NeutralPill className="bg-critical-muted text-critical border-critical/20">also overdue</NeutralPill>}
                          {r.reliable && !r.hasOverdue && occupying && <NeutralPill className="bg-success-muted text-success border-success/20">reliable — renew early</NeutralPill>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {r.property.name} · {r.unit.unitNumber}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.contractNumber}</td>
                      <td className="tabular px-4 py-2.5 text-muted-foreground">
                        {formatDate(c.startDate)} → {formatDate(c.endDate)}
                      </td>
                      <td className={cn("tabular px-4 py-2.5 text-right font-medium", occupying && r.daysRemaining <= 7 && "text-critical", occupying && r.daysRemaining > 7 && r.daysRemaining <= 30 && "text-warning-foreground")}>
                        {occupying ? (r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d over` : r.daysRemaining) : "—"}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">{formatMoney(c.monthlyRent)}</td>
                      <td className="px-4 py-2.5">
                        <ContractStatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {occupying && (
                          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => renewContract(c.id)}>
                            Renew
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 200 && <div className="border-t px-4 py-2 text-xs text-muted-foreground">Showing 200 of {filtered.length}. Narrow the filters to see the rest.</div>}
        </div>
      )}
    </div>
  );
}
