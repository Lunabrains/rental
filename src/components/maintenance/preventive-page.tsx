"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CalendarClock, Pencil, Plus } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect, SupplierSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney } from "@/lib/format";
import { getPreventivePlans, type PlanRow, type PlanState } from "@/lib/queries";
import { cn } from "@/lib/utils";

type StateChip = "all" | PlanState;

/** Preventive maintenance (plan §Phase 8): every recurring service, when it is due, what it costs. */
export function PreventivePage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { addPlan, editPlan, logService, createWorkOrder, openAsset } = useActions();
  const propertyId = params.get("property");
  const supplierId = params.get("supplier");
  const state = (params.get("state") as StateChip | null) ?? "all";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/maintenance/preventive${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const all = useMemo(() => getPreventivePlans(store, { propertyId: propertyId ?? undefined, supplierId: supplierId ?? undefined }), [store, propertyId, supplierId]);
  const rows = useMemo(() => (state === "all" ? all : all.filter((r) => r.state === state)), [all, state]);
  const counts = { all: all.length, overdue: all.filter((r) => r.state === "overdue").length, due_soon: all.filter((r) => r.state === "due_soon").length, scheduled: all.filter((r) => r.state === "scheduled").length, paused: all.filter((r) => r.state === "paused").length };
  const next90 = all.filter((r) => r.state !== "paused" && r.daysUntil <= 90);
  const budget90 = next90.reduce((n, r) => n + (r.plan.estimatedCost ?? 0), 0);

  const columns: Column<PlanRow>[] = [
    { key: "type", header: "Service", cell: (r) => <span className="font-medium">{r.plan.maintenanceType}</span>, value: (r) => r.plan.maintenanceType },
    { key: "asset", header: "Asset", cell: (r) => (r.asset ? <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); openAsset(r.asset!.id); }}>{r.asset.name}</button> : <span className="text-muted-foreground">Building</span>), value: (r) => r.asset?.name ?? "" },
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "every", header: "Every", cell: (r) => `${r.plan.recurrenceMonths} mo`, value: (r) => r.plan.recurrenceMonths },
    { key: "last", header: "Last done", cell: (r) => formatDate(r.plan.lastServiceDate), value: (r) => r.plan.lastServiceDate ?? "" },
    { key: "next", header: "Next due", cell: (r) => <span className={cn(r.state === "overdue" && "font-medium text-critical", r.state === "due_soon" && "text-warning-foreground")}>{formatDate(r.plan.nextServiceDate)} · {r.daysUntil < 0 ? `${Math.abs(r.daysUntil)}d late` : `${r.daysUntil}d`}</span>, value: (r) => r.plan.nextServiceDate },
    { key: "state", header: "State", cell: (r) => <StatusBadge value={r.state} />, value: (r) => r.state },
    { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—", value: (r) => r.supplier?.name ?? "" },
    { key: "cost", header: "Est. cost", align: "right", cell: (r) => (r.plan.estimatedCost ? formatMoney(r.plan.estimatedCost) : "—"), value: (r) => r.plan.estimatedCost ?? 0 },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.state !== "paused" && (
            <Button size="sm" variant={r.state === "overdue" || r.state === "due_soon" ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => logService(r.plan.id)}>
              Log service
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => createWorkOrder({ propertyId: r.property.id, assetId: r.asset?.id ?? null, title: r.plan.maintenanceType, category: r.asset?.assetType === "elevator" ? "elevator" : r.asset?.assetType === "generator" ? "generator" : r.asset?.assetType === "hvac" ? "hvac" : "other", supplierId: r.supplier?.id ?? null, source: "preventive", preventivePlanId: r.plan.id })}>
            Work order
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => editPlan(r.plan.id)}>
            <Pencil className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Preventive maintenance"
        description={`${counts.overdue} overdue · ${counts.due_soon} due within 30 days · ${formatMoney(budget90)} of services in the next 90 days`}
        actions={
          <Button onClick={() => addPlan({ propertyId })}>
            <Plus className="size-4" /> New plan
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? "critical" : "success"} sublabel="Past their due date" href="/maintenance/preventive?state=overdue" />
        <KpiCard label="Due soon" value={counts.due_soon} tone={counts.due_soon > 0 ? "warning" : "success"} sublabel="Within the reminder window" href="/maintenance/preventive?state=due_soon" icon={CalendarClock} />
        <KpiCard label="Scheduled" value={counts.scheduled} sublabel={`${counts.paused} paused`} />
        <KpiCard label="Next 90 days" value={next90.length} sublabel={`${formatMoney(budget90)} estimated`} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<StateChip> aria-label="State" value={state} onChange={(v) => setParams({ state: v })} options={[{ value: "all", label: "All", count: counts.all }, { value: "overdue", label: "Overdue", count: counts.overdue }, { value: "due_soon", label: "Due soon", count: counts.due_soon }, { value: "scheduled", label: "Scheduled", count: counts.scheduled }, { value: "paused", label: "Paused", count: counts.paused }]} />
        <div className="w-44">
          <SupplierSelect value={supplierId} onChange={(id) => setParams({ supplier: id })} allowAll />
        </div>
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.plan.id} dense pageSize={100} exportName="preventive-plans" defaultSort={{ key: "next", dir: "asc" }} searchable={(r) => `${r.plan.maintenanceType} ${r.asset?.name ?? ""} ${r.property.name} ${r.supplier?.name ?? ""}`} emptyTitle="No preventive plans" emptyIcon={CalendarClock} rowClassName={(r) => (r.state === "overdue" ? "bg-critical-muted/30" : r.state === "due_soon" ? "bg-warning-muted/30" : r.state === "paused" ? "opacity-60" : undefined)} />
    </div>
  );
}
