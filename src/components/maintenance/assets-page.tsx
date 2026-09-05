"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ClipboardList, Plus, Printer } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { printQrLabels } from "@/components/maintenance/qr-code";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { getAssets, type AssetRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ASSET_STATUSES, ASSET_TYPES, type AssetStatus, type AssetType } from "@/types";

type ServiceChip = "all" | "overdue" | "due_soon" | "scheduled" | "none";

/** Asset registry (plan §Phase 8): what equipment exists, its state, service and cost. */
export function AssetsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openAsset, addAsset } = useActions();
  const propertyId = params.get("property");
  const type = params.get("type") as AssetType | null;
  const status = params.get("status") as AssetStatus | null;
  const service = (params.get("service") as ServiceChip | null) ?? "all";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/assets${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getAssets(store, { propertyId: propertyId ?? undefined, type: type ?? undefined, status: status ?? undefined, serviceState: service === "all" ? undefined : service }), [store, propertyId, type, status, service]);
  const all = useMemo(() => getAssets(store, { propertyId: propertyId ?? undefined }), [store, propertyId]);
  const kpis = {
    total: all.length,
    out: all.filter((a) => a.asset.status === "out_of_service").length,
    degraded: all.filter((a) => a.asset.status === "degraded").length,
    overdue: all.filter((a) => a.serviceState === "overdue").length,
    dueSoon: all.filter((a) => a.serviceState === "due_soon").length,
    warranty: all.filter((a) => a.warrantyDays !== null && a.warrantyDays >= 0 && a.warrantyDays <= 60).length,
    spend: all.reduce((n, a) => n + a.totalSpend, 0),
  };

  const columns: Column<AssetRow>[] = [
    { key: "name", header: "Asset", cell: (r) => <span className="font-medium">{r.asset.name}</span>, value: (r) => r.asset.name },
    { key: "type", header: "Type", cell: (r) => labelize(r.asset.assetType), value: (r) => r.asset.assetType },
    { key: "building", header: "Building", cell: (r) => `${r.property.name}${r.unit ? ` · ${r.unit.unitNumber}` : ""}`, value: (r) => r.property.name },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.asset.status} dot />, value: (r) => r.asset.status },
    { key: "next", header: "Next service", cell: (r) => (r.asset.nextServiceDate ? <span className={cn(r.serviceState === "overdue" && "font-medium text-critical", r.serviceState === "due_soon" && "text-warning-foreground")}>{formatDate(r.asset.nextServiceDate)}{r.daysToService !== null ? ` · ${r.daysToService < 0 ? `${Math.abs(r.daysToService)}d late` : `${r.daysToService}d`}` : ""}</span> : <span className="text-muted-foreground">no plan</span>), value: (r) => r.asset.nextServiceDate ?? "" },
    { key: "last", header: "Last service", cell: (r) => formatDate(r.asset.lastServiceDate), value: (r) => r.asset.lastServiceDate ?? "" },
    { key: "warranty", header: "Warranty", cell: (r) => (r.asset.warrantyExpiry ? <span className={cn(r.warrantyDays !== null && r.warrantyDays < 0 && "text-muted-foreground line-through", r.warrantyDays !== null && r.warrantyDays >= 0 && r.warrantyDays <= 60 && "text-warning-foreground")}>{formatDate(r.asset.warrantyExpiry)}</span> : "—"), value: (r) => r.asset.warrantyExpiry ?? "" },
    { key: "supplier", header: "Supplier", cell: (r) => r.supplier?.name ?? "—", value: (r) => r.supplier?.name ?? "" },
    { key: "open", header: "Open WOs", align: "right", cell: (r) => (r.openOrders > 0 ? <span className="font-medium text-warning-foreground">{r.openOrders}</span> : "0"), value: (r) => r.openOrders },
    { key: "spend", header: "Total spend", align: "right", cell: (r) => (r.totalSpend > 0 ? formatMoney(r.totalSpend) : "—"), value: (r) => r.totalSpend },
    { key: "qr", header: "QR", cell: (r) => <span className="font-mono text-[10px] text-muted-foreground">{r.asset.qrCode}</span>, value: (r) => r.asset.qrCode },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Assets"
        description={`${kpis.total} registered · ${formatMoney(kpis.spend)} maintenance spend all time`}
        actions={
          <>
            <Button variant="outline" onClick={() => printQrLabels(rows.map((r) => ({ code: r.asset.qrCode, name: r.asset.name, building: r.property.name, type: labelize(r.asset.assetType) })))} disabled={rows.length === 0}>
              <Printer className="size-4" /> Print QR labels
            </Button>
            <Button onClick={() => addAsset(propertyId)}>
              <Plus className="size-4" /> Register asset
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Out of service" value={kpis.out} tone={kpis.out > 0 ? "critical" : "success"} sublabel={kpis.degraded > 0 ? `${kpis.degraded} degraded` : "None degraded"} href="/assets?status=out_of_service" />
        <KpiCard label="Service overdue" value={kpis.overdue} tone={kpis.overdue > 0 ? "critical" : "success"} sublabel={`${kpis.dueSoon} due within 30 days`} href="/assets?service=overdue" />
        <KpiCard label="Warranty ending" value={kpis.warranty} tone={kpis.warranty > 0 ? "warning" : "default"} sublabel="Within 60 days" />
        <KpiCard label="Registered" value={kpis.total} sublabel={`${new Set(all.map((a) => a.asset.assetType)).size} types across ${new Set(all.map((a) => a.property.id)).size} buildings`} icon={ClipboardList} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<ServiceChip> aria-label="Service state" value={service} onChange={(v) => setParams({ service: v })} options={[{ value: "all", label: "All" }, { value: "overdue", label: "Service overdue" }, { value: "due_soon", label: "Due soon" }, { value: "scheduled", label: "Scheduled" }, { value: "none", label: "No plan" }]} />
        <div className="w-44">
          <EnumSelect values={ASSET_TYPES} value={type} onChange={(v) => setParams({ type: v })} allowAll allLabel="All types" labels={{ hvac: "HVAC", cctv: "CCTV" }} />
        </div>
        <div className="w-40">
          <EnumSelect values={ASSET_STATUSES} value={status} onChange={(v) => setParams({ status: v })} allowAll allLabel="Any status" />
        </div>
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.asset.id} onRowClick={(r) => openAsset(r.asset.id)} rowClassName={(r) => (r.asset.status === "out_of_service" ? "bg-critical-muted/30" : r.serviceState === "overdue" ? "bg-warning-muted/30" : undefined)} searchable={(r) => `${r.asset.name} ${r.asset.assetType} ${r.property.name} ${r.asset.manufacturer ?? ""} ${r.asset.serialNumber ?? ""} ${r.asset.qrCode}`} searchPlaceholder="Name, type, serial, QR…" exportName="assets" pageSize={100} emptyTitle="No assets match" emptyIcon={ClipboardList} />
    </div>
  );
}
