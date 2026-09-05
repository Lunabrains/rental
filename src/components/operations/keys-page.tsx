"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { markKeyLost, returnKey } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, labelize } from "@/lib/format";
import { getKeyStats, getKeys, type KeyRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { KEY_TYPES, type KeyStatus, type KeyType } from "@/types";

type StatusChip = "all" | KeyStatus;

/** Key register (plan §Phase 10): who holds which key, what is back, what is lost. */
export function KeysPage() {
  const { store, run } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const { addKey, editKey, issueKey, openTenant, openUnitPage } = useActions();
  const propertyId = params.get("property");
  const unitId = params.get("unit");
  const type = params.get("type") as KeyType | null;
  const status = (params.get("status") as StatusChip | null) ?? "all";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/keys${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getKeys(store, { propertyId: propertyId ?? undefined, unitId: unitId ?? undefined, type: type ?? undefined, status: status === "all" ? undefined : status }), [store, propertyId, unitId, type, status]);
  const stats = useMemo(() => getKeyStats(store, propertyId ?? undefined), [store, propertyId]);
  const unit = unitId ? store.units.find((u) => u.id === unitId) : null;

  function doReturn(r: KeyRow) {
    try {
      const { undo } = run(returnKey(r.key.id));
      toast.success(`${labelize(r.key.type)} ${r.key.identifier} returned`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not return the key");
    }
  }
  function doLost(r: KeyRow) {
    try {
      const { undo } = run(markKeyLost(r.key.id));
      toast.warning(`${labelize(r.key.type)} ${r.key.identifier} recorded as lost`, { description: "An alert suggests changing the lock.", action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the key");
    }
  }

  const columns: Column<KeyRow>[] = [
    { key: "id", header: "Key", cell: (r) => <span className="font-medium">{r.key.identifier}</span>, value: (r) => r.key.identifier },
    { key: "type", header: "Type", cell: (r) => labelize(r.key.type), value: (r) => r.key.type },
    { key: "where", header: "Building / unit", cell: (r) => (r.unit ? <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); openUnitPage(r.unit!.id); }}>{r.property.name} · {r.unit.unitNumber}</button> : r.property.name), value: (r) => `${r.property.name} ${r.unit?.unitNumber ?? ""}` },
    { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.key.status} dot />, value: (r) => r.key.status },
    { key: "holder", header: "Held by", cell: (r) => (r.key.status === "issued" ? (r.tenant ? <button type="button" className="hover:underline" onClick={(e) => { e.stopPropagation(); openTenant(r.tenant!.id); }}>{r.tenant.fullName}</button> : r.key.assignedTo ?? "—") : r.key.status === "lost" && r.key.assignedTo ? <span className="text-muted-foreground">last: {r.key.assignedTo}</span> : "—"), value: (r) => r.key.assignedTo ?? "" },
    { key: "issued", header: "Issued", cell: (r) => formatDate(r.key.issuedDate), value: (r) => r.key.issuedDate ?? "" },
    { key: "returned", header: "Returned", cell: (r) => formatDate(r.key.returnedDate), value: (r) => r.key.returnedDate ?? "" },
    { key: "notes", header: "Notes", cell: (r) => <span className="line-clamp-1 text-xs text-muted-foreground">{r.key.notes ?? ""}</span>, value: (r) => r.key.notes ?? "" },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {(r.key.status === "in_office" || r.key.status === "returned") && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => issueKey(r.key.id)}>Issue</Button>}
          {r.key.status === "issued" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doReturn(r)}>Return</Button>}
          {r.key.status !== "lost" && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => doLost(r)}>Lost</Button>}
          {r.key.status === "lost" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doReturn(r)}>Found</Button>}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => editKey(r.key.id)}><Pencil className="size-3.5" /></Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Keys & access"
        description={`${stats.issued} out · ${stats.available} in the office · ${stats.lost} lost${unit ? ` · showing unit ${unit.unitNumber}` : ""}`}
        actions={
          <Button onClick={() => addKey({ propertyId, unitId })}>
            <Plus className="size-4" /> Add key
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Lost" value={stats.lost} tone={stats.lost > 0 ? "critical" : "success"} sublabel="Consider changing the lock" href="/keys?status=lost" />
        <KpiCard label="Issued" value={stats.issued} sublabel="With tenants, contractors or staff" href="/keys?status=issued" />
        <KpiCard label="In office" value={stats.available} sublabel="Available to issue" />
        <KpiCard label="Registered" value={stats.total} sublabel={`${new Set(store.keys.filter((k) => !propertyId || k.propertyId === propertyId).map((k) => k.propertyId)).size} buildings`} icon={KeyRound} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusChip> aria-label="Status" value={status} onChange={(v) => setParams({ status: v })} options={[{ value: "all", label: "All" }, { value: "issued", label: "Issued" }, { value: "in_office", label: "In office" }, { value: "returned", label: "Returned" }, { value: "lost", label: "Lost" }]} />
        <div className="w-44">
          <EnumSelect values={KEY_TYPES} value={type} onChange={(v) => setParams({ type: v })} allowAll allLabel="All types" />
        </div>
        {unit && <Button variant="ghost" size="sm" onClick={() => setParams({ unit: null })}>Clear unit filter</Button>}
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id, unit: null })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.key.id} dense pageSize={100} exportName="keys" rowClassName={(r) => cn(r.key.status === "lost" && "bg-critical-muted/30")} searchable={(r) => `${r.key.identifier} ${r.key.type} ${r.property.name} ${r.unit?.unitNumber ?? ""} ${r.key.assignedTo ?? ""} ${r.tenant?.fullName ?? ""}`} emptyTitle="No keys registered" emptyIcon={KeyRound} />
    </div>
  );
}
