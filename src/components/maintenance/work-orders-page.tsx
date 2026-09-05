"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { Plus, Wrench } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable } from "@/components/common/data-table";
import { EnumSelect, PropertySelect, SupplierSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { PriorityBadge, StatusBadge } from "@/components/common/status-badge";
import { workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatMoney } from "@/lib/format";
import { getMaintenanceSummary, getWorkOrders, type WorkOrderRow, type WorkOrderStatusFilter } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, type WorkOrderCategory, type WorkOrderPriority, type WorkOrderStatus } from "@/types";

type View = "table" | "board";
type StatusChip = WorkOrderStatusFilter | "all";
const BOARD_COLUMNS: { status: WorkOrderStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "assigned", label: "Assigned" },
  { status: "awaiting_quote", label: "Awaiting quote" },
  { status: "awaiting_approval", label: "Awaiting approval" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
];

/** Work-order board (plan §Phase 7): table or Kanban, filters, every open issue in one place. */
export function WorkOrdersPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { createWorkOrder, openWorkOrder, workOrderStatus } = useActions();

  const view: View = params.get("view") === "board" ? "board" : "table";
  const status = (params.get("status") as StatusChip | null) ?? "open";
  const propertyId = params.get("property");
  const supplierId = params.get("supplier");
  const category = params.get("category") as WorkOrderCategory | null;
  const priority = params.get("priority") as WorkOrderPriority | null;
  const overdue = params.get("overdue") === "1";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "status" && v === "open") || (k === "view" && v === "table") || v === "0") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/maintenance${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(
    () => getWorkOrders(store, { propertyId: propertyId ?? undefined, supplierId: supplierId ?? undefined, category: category ?? undefined, priority: priority ?? undefined, status: view === "board" ? undefined : status === "all" ? undefined : status, overdueOnly: overdue }),
    [store, propertyId, supplierId, category, priority, status, overdue, view],
  );
  const summary = useMemo(() => getMaintenanceSummary(store, propertyId ?? undefined), [store, propertyId]);
  const counts = useMemo(() => {
    const all = getWorkOrders(store, { propertyId: propertyId ?? undefined });
    return { open: all.filter((r) => r.isOpen).length, closed_all: all.filter((r) => !r.isOpen).length, all: all.length, awaiting_approval: all.filter((r) => r.workOrder.status === "awaiting_approval").length, in_progress: all.filter((r) => r.workOrder.status === "in_progress").length };
  }, [store, propertyId]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Work orders"
        description={`${summary.open} open · ${summary.emergencies} emergency · ${summary.awaitingApproval} awaiting approval · avg resolution ${summary.avgResolutionDays ?? "—"} days`}
        actions={
          <>
            <Chips<View> aria-label="View" value={view} onChange={(v) => setParams({ view: v })} options={[{ value: "table", label: "Table" }, { value: "board", label: "Board" }]} />
            <Button onClick={() => createWorkOrder({ propertyId })}>
              <Plus className="size-4" /> New work order
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Open" value={summary.open} tone={summary.emergencies > 0 ? "critical" : summary.open > 0 ? "warning" : "success"} sublabel={summary.emergencies > 0 ? `${summary.emergencies} emergency` : summary.overdue > 0 ? `${summary.overdue} open too long` : "Under control"} href="/maintenance?overdue=1" icon={Wrench} />
        <KpiCard label="Awaiting your approval" value={summary.awaitingApproval} tone={summary.awaitingApproval > 0 ? "warning" : "default"} sublabel="Quotes to review" href="/maintenance?status=awaiting_approval" />
        <KpiCard label="Spend this month" value={formatMoney(summary.spendThisMonth)} sublabel={`${formatMoney(summary.spendLast30)} in the last 30 days`} />
        <KpiCard label="Repeat issues" value={summary.repeatIssues} tone={summary.repeatIssues > 0 ? "warning" : "success"} sublabel="Same place, same problem, within 90 days" href="/alerts?category=maintenance" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {view === "table" && (
          <Chips<StatusChip>
            aria-label="Status"
            value={status}
            onChange={(v) => setParams({ status: v })}
            options={[
              { value: "open", label: "Open", count: counts.open },
              { value: "awaiting_approval", label: "Awaiting approval", count: counts.awaiting_approval },
              { value: "in_progress", label: "In progress", count: counts.in_progress },
              { value: "closed_all", label: "Completed", count: counts.closed_all },
              { value: "all", label: "All", count: counts.all },
            ]}
          />
        )}
        <Chips<string> aria-label="Overdue" value={overdue ? "1" : "0"} onChange={(v) => setParams({ overdue: v })} options={[{ value: "0", label: "Any age" }, { value: "1", label: "Open too long" }]} />
        <div className="w-40">
          <EnumSelect values={WORK_ORDER_CATEGORIES} value={category} onChange={(v) => setParams({ category: v })} allowAll allLabel="All categories" labels={{ hvac: "HVAC" }} />
        </div>
        <div className="w-36">
          <EnumSelect values={WORK_ORDER_PRIORITIES} value={priority} onChange={(v) => setParams({ priority: v })} allowAll allLabel="Any priority" />
        </div>
        <div className="w-44">
          <SupplierSelect value={supplierId} onChange={(id) => setParams({ supplier: id })} allowAll />
        </div>
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      {view === "table" ? (
        <DataTable
          rows={rows}
          columns={workOrderColumns}
          rowKey={(r) => r.workOrder.id}
          onRowClick={(r) => openWorkOrder(r.workOrder.id)}
          rowClassName={(r) => (r.workOrder.priority === "emergency" && r.isOpen ? "bg-critical-muted/30" : r.overdue ? "bg-warning-muted/30" : undefined)}
          searchable={(r) => `${r.workOrder.number} ${r.workOrder.title} ${r.property.name} ${r.unit?.unitNumber ?? ""} ${r.asset?.name ?? ""} ${r.supplier?.name ?? ""}`}
          searchPlaceholder="Number, issue, unit, supplier…"
          exportName="work-orders"
          pageSize={50}
          emptyTitle="No work orders match"
          emptyIcon={Wrench}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {BOARD_COLUMNS.map((col) => {
            const cards = rows.filter((r) => r.workOrder.status === col.status);
            return (
              <div key={col.status} className="flex min-h-40 flex-col rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
                  <span>{col.label}</span>
                  <span className="tabular rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{cards.length}</span>
                </div>
                <div className="flex-1 space-y-2 p-2">
                  {cards.map((r) => (
                    <BoardCard key={r.workOrder.id} row={r} onOpen={() => openWorkOrder(r.workOrder.id)} onAdvance={() => workOrderStatus(r.workOrder.id)} />
                  ))}
                  {cards.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">Nothing here</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BoardCard({ row, onOpen, onAdvance }: { row: WorkOrderRow; onOpen: () => void; onAdvance: () => void }) {
  const w = row.workOrder;
  return (
    <div className={cn("cursor-pointer rounded-md border bg-card p-2.5 text-xs shadow-xs transition-shadow hover:shadow-sm", w.priority === "emergency" && "border-critical/40", row.overdue && w.priority !== "emergency" && "border-warning/40")} onClick={onOpen}>
      <div className="flex items-start justify-between gap-1">
        <span className="font-mono text-[10px] text-muted-foreground">{w.number}</span>
        <PriorityBadge priority={w.priority} />
      </div>
      <div className="mt-1 font-medium leading-snug">{w.title}</div>
      <div className="mt-1 text-muted-foreground">
        {row.property.name}
        {row.unit ? ` · ${row.unit.unitNumber}` : row.asset ? ` · ${row.asset.name}` : ""}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">{row.supplier?.name ?? "Unassigned"}</span>
        <span className={cn("tabular shrink-0", row.overdue && "font-medium text-critical")}>{row.ageDays}d</span>
      </div>
      {(w.status === "awaiting_approval" || w.status === "in_progress" || w.status === "assigned" || w.status === "open") && (
        <button type="button" className="mt-2 w-full rounded border bg-background py-1 text-[11px] font-medium hover:bg-accent" onClick={(e) => { e.stopPropagation(); onAdvance(); }}>
          {w.status === "awaiting_approval" ? "Approve / decide" : w.status === "in_progress" ? "Complete" : "Advance"}
        </button>
      )}
      {row.cost > 0 && <div className="mt-1.5 text-right text-muted-foreground"><StatusBadge value={w.status} className="hidden" />{formatMoney(row.cost)}</div>}
    </div>
  );
}
