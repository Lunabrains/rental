"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CalendarCheck, Check, ClipboardCheck, LogIn, LogOut, Plus } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { formatDate, labelize } from "@/lib/format";
import { getInspections, getMoves, type InspectionRow, type MoveRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { INSPECTION_TYPES, type InspectionType } from "@/types";

type StatusChip = "open" | "overdue" | "completed" | "all";

export const inspectionColumns: Column<InspectionRow>[] = [
  { key: "date", header: "Date", cell: (r) => formatDate(r.inspection.completedDate ?? r.inspection.scheduledDate), value: (r) => r.inspection.completedDate ?? r.inspection.scheduledDate },
  { key: "type", header: "Type", cell: (r) => labelize(r.inspection.type), value: (r) => r.inspection.type },
  { key: "where", header: "Where", cell: (r) => `${r.property.name}${r.unit ? ` · ${r.unit.unitNumber}` : r.asset ? ` · ${r.asset.name}` : ""}`, value: (r) => `${r.property.name} ${r.unit?.unitNumber ?? ""}` },
  { key: "tenant", header: "Tenant", cell: (r) => r.tenant?.fullName ?? "—", value: (r) => r.tenant?.fullName ?? "" },
  { key: "status", header: "Status", cell: (r) => <StatusBadge value={r.overdue ? "overdue" : r.inspection.status} label={r.overdue ? "Overdue" : undefined} />, value: (r) => (r.overdue ? "overdue" : r.inspection.status) },
  { key: "result", header: "Result", cell: (r) => (r.inspection.overallResult ? <StatusBadge value={r.inspection.overallResult} /> : "—"), value: (r) => r.inspection.overallResult ?? "" },
  { key: "items", header: "Items", cell: (r) => `${r.inspection.items.length}${r.failed > 0 ? ` · ${r.failed} failed` : ""}${r.attention > 0 ? ` · ${r.attention} attention` : ""}`, value: (r) => r.inspection.items.length },
  { key: "followups", header: "Follow-ups open", align: "right", cell: (r) => (r.followUps > 0 ? <span className="font-medium text-warning-foreground">{r.followUps}</span> : "—"), value: (r) => r.followUps },
  { key: "inspector", header: "Inspector", cell: (r) => r.inspection.inspector, value: (r) => r.inspection.inspector },
];

/** Inspections board (plan §Phase 10): scheduled, overdue and completed walk-throughs plus the move-in / move-out checklists. */
export function InspectionsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const { openInspection, scheduleInspection } = useActions();
  const propertyId = params.get("property");
  const type = params.get("type") as InspectionType | null;
  const status = (params.get("status") as StatusChip | null) ?? "open";

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "status" && v === "open")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/inspections${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const all = useMemo(() => getInspections(store, { propertyId: propertyId ?? undefined, type: type ?? undefined }), [store, propertyId, type]);
  const rows = useMemo(() => all.filter((r) => (status === "all" ? true : status === "overdue" ? r.overdue : status === "completed" ? r.inspection.status === "completed" : r.inspection.status === "scheduled" || r.inspection.status === "in_progress")), [all, status]);
  const moves = useMemo(() => getMoves(store).filter((m) => !propertyId || m.property.id === propertyId), [store, propertyId]);
  const counts = {
    open: all.filter((r) => r.inspection.status === "scheduled" || r.inspection.status === "in_progress").length,
    overdue: all.filter((r) => r.overdue).length,
    completed: all.filter((r) => r.inspection.status === "completed").length,
    followUps: all.reduce((n, r) => n + r.followUps, 0),
    next14: all.filter((r) => (r.inspection.status === "scheduled" || r.inspection.status === "in_progress") && !r.overdue && r.inspection.scheduledDate <= addDays(14)).length,
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inspections"
        description={`${counts.open} open · ${counts.overdue} overdue · ${counts.followUps} failed item${counts.followUps === 1 ? "" : "s"} without a work order`}
        actions={
          <Button onClick={() => scheduleInspection({ propertyId })}>
            <Plus className="size-4" /> Schedule inspection
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? "critical" : "success"} sublabel={`Past the ${store.settings.thresholds.inspectionOverdueDays}-day grace`} href="/inspections?status=overdue" />
        <KpiCard label="Next 14 days" value={counts.next14} sublabel="Scheduled walk-throughs" icon={CalendarCheck} />
        <KpiCard label="Follow-ups open" value={counts.followUps} tone={counts.followUps > 0 ? "warning" : "success"} sublabel="Failed items without a work order" />
        <KpiCard label="Moves in progress" value={moves.length} sublabel={`${moves.filter((m) => m.kind === "move_out").length} out · ${moves.filter((m) => m.kind === "move_in").length} in`} tone={moves.some((m) => m.inspection === null && m.daysUntil <= 7) ? "warning" : "default"} />
      </div>

      {moves.length > 0 && (
        <SectionCard title="Move-in / move-out checklists" description="Every step that protects the deposit and the unit — scheduled from the contract" flush>
          <ul className="divide-y">
            {moves.map((m) => (
              <MoveItem key={`${m.kind}-${m.contract.id}`} m={m} />
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Chips<StatusChip> aria-label="Status" value={status} onChange={(v) => setParams({ status: v })} options={[{ value: "open", label: "Open", count: counts.open }, { value: "overdue", label: "Overdue", count: counts.overdue }, { value: "completed", label: "Completed", count: counts.completed }, { value: "all", label: "All" }]} />
        <div className="w-44">
          <EnumSelect values={INSPECTION_TYPES} value={type} onChange={(v) => setParams({ type: v })} allowAll allLabel="All types" />
        </div>
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <DataTable rows={rows} columns={inspectionColumns} rowKey={(r) => r.inspection.id} onRowClick={(r) => openInspection(r.inspection.id)} rowClassName={(r) => (r.overdue ? "bg-critical-muted/30" : r.inspection.overallResult === "fail" ? "bg-warning-muted/30" : undefined)} searchable={(r) => `${r.inspection.type} ${r.property.name} ${r.unit?.unitNumber ?? ""} ${r.tenant?.fullName ?? ""} ${r.inspection.inspector}`} exportName="inspections" pageSize={50} emptyTitle="No inspections match" emptyIcon={ClipboardCheck} />
    </div>
  );
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function MoveItem({ m }: { m: MoveRow }) {
  const { openInspection, scheduleInspection, openTenant, openDeposit } = useActions();
  const done = m.steps.filter((s) => s.done).length;
  const Icon = m.kind === "move_out" ? LogOut : LogIn;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Icon className={cn("size-4 shrink-0", m.kind === "move_out" ? "text-warning-foreground" : "text-info-foreground")} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <button type="button" className="hover:underline" onClick={() => openTenant(m.tenant.id)}>{m.tenant.fullName}</button>
          <span className="text-muted-foreground"> · {m.property.name} {m.unit.unitNumber} · {m.kind === "move_out" ? "leaving" : "moving in"} {m.daysUntil < 0 ? `${Math.abs(m.daysUntil)} days ago` : m.daysUntil === 0 ? "today" : `in ${m.daysUntil} days`} ({formatDate(m.date)})</span>
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {m.steps.map((s) => (
            <li key={s.label} className={cn("inline-flex items-center gap-1", s.done ? "text-success" : "text-muted-foreground")}>
              {s.done ? <Check className="size-3" /> : <span className="inline-block size-3 rounded-full border" />}
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <span className="text-xs tabular text-muted-foreground">{done}/{m.steps.length}</span>
      {m.inspection ? (
        <Button size="sm" variant="outline" onClick={() => openInspection(m.inspection!.inspection.id)}>Open checklist</Button>
      ) : (
        <Button size="sm" onClick={() => scheduleInspection({ contractId: m.contract.id, type: m.kind })}>Schedule {m.kind === "move_out" ? "move-out" : "move-in"}</Button>
      )}
      {m.kind === "move_out" && m.deposit && m.deposit.status !== "settled" && m.inspection?.inspection.status === "completed" && (
        <Button size="sm" variant="outline" onClick={() => openDeposit(m.deposit!.id)}>Settle deposit</Button>
      )}
    </li>
  );
}
