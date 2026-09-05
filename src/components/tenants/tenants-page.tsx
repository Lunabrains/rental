"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search, UserPlus, Users } from "lucide-react";

import { NeutralPill } from "@/components/common/badges";
import { StatusBadge } from "@/components/common/status-badge";
import { Chips } from "@/components/common/chips";
import { useActions } from "@/components/actions/action-provider";
import { ImportButton } from "@/components/import/import-button";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/states";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { getTenants } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Filter = "current" | "former" | "all";

export function TenantsPage() {
  const { addTenantRecord } = useActions();
  const store = useStore();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("current");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => getTenants(store), [store]);
  const counts = useMemo(
    () => ({ current: rows.filter((r) => r.current).length, former: rows.filter((r) => !r.current).length, all: rows.length }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (filter === "current" && !r.current) return false;
      if (filter === "former" && r.current) return false;
      if (!q) return true;
      const t = r.tenant;
      return (
        t.fullName.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.idNumber.toLowerCase().includes(q) ||
        (digits.length >= 4 && t.phone.replace(/\D/g, "").includes(digits)) ||
        (r.current ? `${r.current.property.name} ${r.current.unit.unitNumber}`.toLowerCase().includes(q) : false)
      );
    });
  }, [rows, filter, query]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tenants"
        description={`${counts.current} current · ${counts.former} former`}
        actions={
          <>
            <ImportButton section="tenants" />
            <Button onClick={() => addTenantRecord()}>
              <UserPlus className="size-4" /> Add tenant
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Chips<Filter>
          aria-label="Tenants"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "current", label: "Current", count: counts.current },
            { value: "former", label: "Former", count: counts.former },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, ID, unit…"
            className="h-9 w-64 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No tenants match" />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Tenant</th>
                  <th className="px-4 py-2.5 font-medium">Phone</th>
                  <th className="px-4 py-2.5 font-medium">Building · Unit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rent</th>
                  <th className="px-4 py-2.5 font-medium">Contract ends</th>
                  <th className="px-4 py-2.5 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2.5 text-right font-medium">Late</th>
                  <th className="px-4 py-2.5 font-medium">Reliability</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => {
                  const t = r.tenant;
                  return (
                    <tr key={t.id} className="cursor-pointer border-t transition-colors hover:bg-accent/60" onClick={() => router.push(`/tenants/${t.id}`)}>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{initials(t.fullName)}</span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{t.fullName}</span>
                            <span className="block truncate text-xs text-muted-foreground">{t.email}</span>
                          </span>
                          {r.hasOverdue && <NeutralPill className="bg-critical-muted text-critical border-critical/20">overdue</NeutralPill>}
                          {!r.current && <NeutralPill>former</NeutralPill>}
                        </span>
                      </td>
                      <td className="tabular px-4 py-2.5 text-muted-foreground">{t.phone}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.current ? `${r.current.property.name} · ${r.current.unit.unitNumber}` : "—"}</td>
                      <td className="tabular px-4 py-2.5 text-right">{r.current ? formatMoney(r.current.contract.monthlyRent) : "—"}</td>
                      <td className={cn("tabular px-4 py-2.5", r.current && r.current.daysRemaining <= 30 && "text-warning-foreground")}>
                        {r.current ? `${formatDate(r.current.contract.endDate)} · ${r.current.daysRemaining}d` : "—"}
                      </td>
                      <td className={cn("tabular px-4 py-2.5 text-right", r.outstanding > 0 ? "font-medium text-critical" : "text-muted-foreground")}>{r.outstanding > 0 ? formatMoney(r.outstanding) : "—"}</td>
                      <td className={cn("tabular px-4 py-2.5 text-right", r.lateCount >= 3 ? "font-medium text-critical" : "text-muted-foreground")}>{r.lateCount > 0 ? `${r.lateCount}×` : "—"}</td>
                      <td className="px-4 py-2.5">{r.reliabilityScore === null ? <span className="text-xs text-muted-foreground">—</span> : <StatusBadge value={r.reliabilityLabel} label={`${r.reliabilityScore} · ${r.reliabilityLabel}`} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
