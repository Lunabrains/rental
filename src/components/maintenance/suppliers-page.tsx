"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Plus, Truck } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ScoreBadge } from "@/components/common/score";
import { StarRating } from "@/components/maintenance/supplier-dialog";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatPercent, labelize } from "@/lib/format";
import { getSuppliers, type SupplierRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SUPPLIER_CATEGORIES, type SupplierCategory } from "@/types";

type ActiveChip = "active" | "all" | "inactive";

/** Supplier directory (plan §Phase 9): who does what, how well, and what they cost. */
export function SuppliersPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openSupplier, addSupplier } = useActions();
  const category = params.get("category") as SupplierCategory | null;
  const active = (params.get("active") as ActiveChip | null) ?? "active";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "active" && v === "active")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/suppliers${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const all = useMemo(() => getSuppliers(store), [store]);
  const rows = useMemo(() => all.filter((r) => (!category || r.supplier.category === category) && (active === "all" || (active === "active") === r.supplier.active)), [all, category, active]);
  const scored = all.filter((r) => r.score !== null);
  const kpis = {
    active: all.filter((r) => r.supplier.active).length,
    openJobs: all.reduce((n, r) => n + r.openJobs, 0),
    spend: all.reduce((n, r) => n + r.totalSpend, 0),
    weak: scored.filter((r) => (r.score ?? 100) < 60).length,
    best: scored[0] ?? null,
  };

  const columns: Column<SupplierRow>[] = [
    { key: "name", header: "Supplier", cell: (r) => <span className={cn("font-medium", !r.supplier.active && "text-muted-foreground")}>{r.supplier.name}{r.supplier.company && r.supplier.company !== r.supplier.name ? <span className="block text-xs font-normal text-muted-foreground">{r.supplier.company}</span> : null}</span>, value: (r) => r.supplier.name },
    { key: "category", header: "Category", cell: (r) => labelize(r.supplier.category), value: (r) => r.supplier.category },
    { key: "score", header: "Performance", cell: (r) => <ScoreBadge score={r.score} label={r.scoreLabel} components={r.components} size="sm" caption={r.score === null ? "Needs at least 2 completed jobs" : undefined} />, value: (r) => r.score ?? -1 },
    { key: "rating", header: "Your rating", cell: (r) => (r.supplier.rating !== null ? <StarRating value={r.supplier.rating} size="sm" /> : <span className="text-muted-foreground">—</span>), value: (r) => r.supplier.rating ?? 0 },
    { key: "jobs", header: "Jobs", align: "right", cell: (r) => (r.jobs > 0 ? `${r.completedJobs}/${r.jobs}` : "—"), value: (r) => r.jobs },
    { key: "open", header: "Open", align: "right", cell: (r) => (r.openJobs > 0 ? <span className="font-medium text-warning-foreground">{r.openJobs}</span> : "0"), value: (r) => r.openJobs },
    { key: "response", header: "Avg response", align: "right", cell: (r) => (r.avgResponseDays !== null ? `${r.avgResponseDays.toFixed(1)}d` : "—"), value: (r) => r.avgResponseDays ?? 999 },
    { key: "completion", header: "Avg completion", align: "right", cell: (r) => (r.avgCompletionDays !== null ? `${r.avgCompletionDays.toFixed(1)}d` : "—"), value: (r) => r.avgCompletionDays ?? 999 },
    { key: "repeat", header: "Repeat rate", align: "right", cell: (r) => (r.repeatIssueRate !== null ? <span className={cn(r.repeatIssueRate > 0.2 && "text-critical")}>{formatPercent(r.repeatIssueRate)}</span> : "—"), value: (r) => r.repeatIssueRate ?? 0 },
    { key: "variance", header: "Cost vs quote", align: "right", cell: (r) => (r.costVariance !== null ? <span className={cn(r.costVariance > 1.15 && "text-critical", r.costVariance < 0.95 && "text-success")}>{r.costVariance >= 1 ? "+" : ""}{formatPercent(r.costVariance - 1)}</span> : "—"), value: (r) => r.costVariance ?? 1 },
    { key: "spend", header: "Total spend", align: "right", cell: (r) => (r.totalSpend > 0 ? formatMoney(r.totalSpend) : "—"), value: (r) => r.totalSpend },
    { key: "last", header: "Last job", cell: (r) => formatDate(r.lastJobAt), value: (r) => r.lastJobAt ?? "" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Suppliers"
        description={`${kpis.active} active · ${formatMoney(kpis.spend)} paid all time · scores are computed from response time, completion time, cost accuracy and repeat issues`}
        actions={
          <Button onClick={() => addSupplier(category ?? undefined)}>
            <Plus className="size-4" /> Add supplier
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Best performer" value={kpis.best ? kpis.best.supplier.name : "—"} sublabel={kpis.best ? `${kpis.best.score}/100 · ${labelize(kpis.best.supplier.category)}` : "Not enough completed jobs yet"} tone="success" href={kpis.best ? `/suppliers/${kpis.best.supplier.id}` : undefined} />
        <KpiCard label="Under-performing" value={kpis.weak} tone={kpis.weak > 0 ? "warning" : "success"} sublabel="Score below 60 — review before the next job" />
        <KpiCard label="Open jobs" value={kpis.openJobs} sublabel="Assigned work orders in progress" href="/maintenance?status=open" />
        <KpiCard label="Active suppliers" value={kpis.active} sublabel={`${all.length - kpis.active} inactive`} icon={Truck} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<ActiveChip> aria-label="Status" value={active} onChange={(v) => setParams({ active: v })} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "all", label: "All" }]} />
        <div className="w-48">
          <EnumSelect values={SUPPLIER_CATEGORIES} value={category} onChange={(v) => setParams({ category: v })} allowAll allLabel="All categories" labels={{ hvac: "HVAC" }} />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.supplier.id} onRowClick={(r) => openSupplier(r.supplier.id)} rowClassName={(r) => (r.score !== null && r.score < 60 ? "bg-warning-muted/30" : undefined)} searchable={(r) => `${r.supplier.name} ${r.supplier.company ?? ""} ${r.supplier.category} ${r.supplier.services.join(" ")} ${r.supplier.phone} ${r.supplier.email}`} searchPlaceholder="Name, service, phone…" exportName="suppliers" pageSize={100} emptyTitle="No suppliers match" emptyIcon={Truck} />
    </div>
  );
}
