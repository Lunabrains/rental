"use client";

import { useMemo } from "react";

import { useActions } from "@/components/actions/action-provider";
import { UnitStatusBadge } from "@/components/common/badges";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import type { StatusFilter } from "@/components/properties/grid-toolbar";
import { useStore } from "@/lib/data/store-context";
import { indexStore } from "@/lib/data/store";
import { isOpenWorkOrder, outstandingRent } from "@/lib/derived/metrics";
import { formatDate, formatMoney } from "@/lib/format";
import type { FloorRow, UnitCell } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface UnitListRow {
  cell: UnitCell;
  outstanding: number;
  openWorkOrders: number;
  rent: number;
}

/** The building's units as a table — the "Units" tab per the plan's §Phase 2. */
export function UnitList({ propertyId, floors, highlightIds, floorFilter, status, onSelect }: { propertyId: string; floors: FloorRow[]; highlightIds: Set<string> | null; floorFilter: number | null; status: StatusFilter; onSelect: (unitId: string) => void }) {
  const store = useStore();
  const { openUnitPage } = useActions();

  const rows = useMemo<UnitListRow[]>(() => {
    const idx = indexStore(store);
    return floors
      .filter((f) => floorFilter === null || f.floor === floorFilter)
      .flatMap((f) => f.units)
      .filter((c) => (status === "available" ? c.unit.status !== "rented" : true))
      .filter((c) => !highlightIds || highlightIds.size === 0 || highlightIds.has(c.unit.id))
      .map((cell) => ({
        cell,
        outstanding: cell.contract ? outstandingRent(idx.paymentsByContract.get(cell.contract.id) ?? []) : 0,
        openWorkOrders: (idx.workOrdersByUnit.get(cell.unit.id) ?? []).filter(isOpenWorkOrder).length,
        rent: cell.contract?.monthlyRent ?? cell.unit.askingRent,
      }));
  }, [store, floors, floorFilter, status, highlightIds]);

  const columns: Column<UnitListRow>[] = [
    { key: "unit", header: "Unit", cell: (r) => <span className="font-medium">{r.cell.unit.unitNumber}</span>, value: (r) => r.cell.unit.unitNumber },
    { key: "floor", header: "Floor", cell: (r) => r.cell.unit.floor, value: (r) => r.cell.unit.floor },
    { key: "layout", header: "Layout", cell: (r) => `${r.cell.unit.bedrooms} BR · ${r.cell.unit.sizeSqm} m²`, value: (r) => r.cell.unit.bedrooms },
    { key: "status", header: "Status", cell: (r) => <UnitStatusBadge status={r.cell.unit.status} />, value: (r) => r.cell.unit.status },
    { key: "tenant", header: "Tenant", cell: (r) => r.cell.tenant?.fullName ?? <span className="text-muted-foreground">{r.cell.daysVacant !== null ? `vacant ${r.cell.daysVacant}d` : "—"}</span>, value: (r) => r.cell.tenant?.fullName ?? "" },
    { key: "rent", header: "Rent", align: "right", cell: (r) => (r.cell.contract ? formatMoney(r.cell.contract.monthlyRent) : <span className="text-muted-foreground">asking {formatMoney(r.cell.unit.askingRent)}</span>), value: (r) => r.rent },
    { key: "expiry", header: "Contract ends", cell: (r) => (r.cell.contract ? <span className={cn(r.cell.expiringInDays !== null && r.cell.expiringInDays <= 30 && "text-warning-foreground")}>{formatDate(r.cell.contract.endDate)}{r.cell.expiringInDays !== null ? ` · ${r.cell.expiringInDays}d` : ""}</span> : "—"), value: (r) => r.cell.contract?.endDate ?? null },
    { key: "outstanding", header: "Outstanding", align: "right", cell: (r) => (r.outstanding > 0 ? <span className="font-medium text-critical">{formatMoney(r.outstanding)}</span> : "—"), value: (r) => r.outstanding },
    { key: "maintenance", header: "Maintenance", cell: (r) => (r.openWorkOrders > 0 ? <StatusBadge value="open" label={`${r.openWorkOrders} open`} /> : <span className="text-muted-foreground">—</span>), value: (r) => r.openWorkOrders },
    { key: "condition", header: "Condition", cell: (r) => <StatusBadge value={r.cell.unit.condition} /> },
    { key: "open", header: "", cell: (r) => <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={(e) => { e.stopPropagation(); openUnitPage(r.cell.unit.id); }}>360°</button>, sortable: false, noExport: true },
  ];

  return <DataTable rows={rows} columns={columns} rowKey={(r) => r.cell.unit.id} onRowClick={(r) => onSelect(r.cell.unit.id)} defaultSort={{ key: "unit", dir: "asc" }} pageSize={60} exportName={`units-${propertyId}`} emptyTitle="No units match" dense />;
}
