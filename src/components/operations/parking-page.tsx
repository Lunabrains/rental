"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Car, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { releaseParking } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatMoney } from "@/lib/format";
import { getParking, getParkingStats, type ParkingRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { ParkingStatus } from "@/types";

type StatusChip = "all" | ParkingStatus;

/** Parking register (plan §Phase 10): every space, who has it, what it earns. */
export function ParkingPage() {
  const { store, run } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const { addParking, editParking, assignParking, openTenant, openUnitPage } = useActions();
  const propertyId = params.get("property");
  const unitId = params.get("unit");
  const status = (params.get("status") as StatusChip | null) ?? "all";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/parking${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getParking(store, { propertyId: propertyId ?? undefined, unitId: unitId ?? undefined, status: status === "all" ? undefined : status }), [store, propertyId, unitId, status]);
  const stats = useMemo(() => getParkingStats(store, propertyId ?? undefined), [store, propertyId]);
  const unit = unitId ? store.units.find((u) => u.id === unitId) : null;

  function release(r: ParkingRow) {
    try {
      const { undo } = run(releaseParking(r.space.id));
      toast.success(`Parking ${r.space.spaceNumber} released`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not release the space");
    }
  }

  const columns: Column<ParkingRow>[] = [
    { key: "space", header: "Space", cell: (r) => <span className="font-medium">{r.space.spaceNumber}</span>, value: (r) => r.space.spaceNumber },
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.space.status} dot />, value: (r) => r.space.status },
    { key: "unit", header: "Unit", cell: (r) => (r.unit ? <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); openUnitPage(r.unit!.id); }}>{r.unit.unitNumber}</button> : "—"), value: (r) => r.unit?.unitNumber ?? "" },
    { key: "tenant", header: "Tenant", cell: (r) => (r.tenant ? <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); openTenant(r.tenant!.id); }}>{r.tenant.fullName}</button> : "—"), value: (r) => r.tenant?.fullName ?? "" },
    { key: "plate", header: "Plate", cell: (r) => r.space.vehiclePlate ?? "—", value: (r) => r.space.vehiclePlate ?? "" },
    { key: "fee", header: "Fee", align: "right", cell: (r) => (r.space.status === "assigned" ? (r.space.paid && r.space.monthlyFee > 0 ? `${formatMoney(r.space.monthlyFee)}/mo` : <span className="text-muted-foreground">included</span>) : r.space.monthlyFee > 0 ? <span className="text-muted-foreground">{formatMoney(r.space.monthlyFee)}/mo</span> : "—"), value: (r) => r.space.monthlyFee },
    { key: "notes", header: "Notes", cell: (r) => <span className="line-clamp-1 text-xs text-muted-foreground">{r.space.notes ?? ""}</span>, value: (r) => r.space.notes ?? "" },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {(r.space.status === "free" || r.space.status === "reserved") && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => assignParking(r.space.id)}>Assign</Button>}
          {(r.space.status === "assigned" || r.space.status === "reserved") && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => release(r)}>Release</Button>}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => editParking(r.space.id)}><Pencil className="size-3.5" /></Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Parking"
        description={`${stats.assigned} of ${stats.total} assigned · ${formatMoney(stats.monthlyFees)}/month in separate fees${unit ? ` · showing unit ${unit.unitNumber}` : ""}`}
        actions={
          <Button onClick={() => addParking(propertyId)}>
            <Plus className="size-4" /> Add space
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Free" value={stats.free} tone={stats.free > 0 ? "success" : "default"} sublabel={`${stats.reserved} reserved · ${stats.unavailable} unavailable`} href="/parking?status=free" />
        <KpiCard label="Assigned" value={stats.assigned} sublabel={`${stats.unpaidAssigned} included in rent`} href="/parking?status=assigned" />
        <KpiCard label="Monthly fees" value={formatMoney(stats.monthlyFees)} sublabel="Spaces charged separately" />
        <KpiCard label="Spaces" value={stats.total} sublabel={`${stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0}% occupied`} icon={Car} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusChip> aria-label="Status" value={status} onChange={(v) => setParams({ status: v })} options={[{ value: "all", label: "All" }, { value: "assigned", label: "Assigned" }, { value: "free", label: "Free" }, { value: "reserved", label: "Reserved" }, { value: "unavailable", label: "Unavailable" }]} />
        {unit && <Button variant="ghost" size="sm" onClick={() => setParams({ unit: null })}>Clear unit filter</Button>}
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id, unit: null })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.space.id} dense pageSize={100} exportName="parking" rowClassName={(r) => cn(r.space.status === "free" && "bg-success-muted/20")} searchable={(r) => `${r.space.spaceNumber} ${r.property.name} ${r.unit?.unitNumber ?? ""} ${r.tenant?.fullName ?? ""} ${r.space.vehiclePlate ?? ""}`} emptyTitle="No parking spaces" emptyIcon={Car} />
    </div>
  );
}
