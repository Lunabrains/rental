"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Field, FlowDialog, MoneyInput } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCommonCharge, deleteCommonCharge, setAllocationPaid } from "@/lib/commands";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { currentPeriod } from "@/lib/date";
import { allocateCharge } from "@/lib/import/apply";
import { formatDate, formatMoney, formatMonth, formatPercent, labelize } from "@/lib/format";
import { getCommonCharges, type ChargeRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALLOCATION_METHODS, type AllocationMethod } from "@/types";

const CATEGORIES = ["elevator", "cleaning", "generator", "security", "water", "electricity", "gardening", "insurance", "other"];

/** Common charges (plan §Phase 6): building costs split across units with a configurable method. */
export function ChargesPage() {
  const { store, run } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const { openUnitPage } = useActions();
  const propertyId = params.get("property");
  const period = params.get("period");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/charges${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getCommonCharges(store, { propertyId: propertyId ?? undefined, period: period ?? undefined }), [store, propertyId, period]);
  const current = rows.find((r) => r.charge.id === selected) ?? rows[0] ?? null;
  const totals = useMemo(() => ({ total: rows.reduce((n, r) => n + r.charge.totalAmount, 0), paid: rows.reduce((n, r) => n + r.paidAmount, 0), unpaid: rows.reduce((n, r) => n + r.unpaidAmount, 0) }), [rows]);

  const columns: Column<ChargeRow>[] = [
    { key: "period", header: "Month", cell: (r) => formatMonth(r.charge.period), value: (r) => r.charge.period },
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "category", header: "Charge", cell: (r) => <span className="font-medium">{labelize(r.charge.category)}</span>, value: (r) => r.charge.category },
    { key: "method", header: "Allocation", cell: (r) => labelize(r.charge.allocationMethod), value: (r) => r.charge.allocationMethod },
    { key: "total", header: "Total", align: "right", cell: (r) => formatMoney(r.charge.totalAmount), value: (r) => r.charge.totalAmount },
    { key: "units", header: "Units", align: "right", cell: (r) => r.allocations.length, value: (r) => r.allocations.length },
    { key: "paid", header: "Collected", align: "right", cell: (r) => <span className={cn(r.unpaidAmount > 0 ? "text-warning-foreground" : "text-success")}>{formatMoney(r.paidAmount)} · {r.paidCount}/{r.allocations.length}</span>, value: (r) => r.paidAmount },
    { key: "progress", header: "", sortable: false, noExport: true, cell: (r) => <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${r.charge.totalAmount > 0 ? (r.paidAmount / r.charge.totalAmount) * 100 : 0}%` }} /></div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Common charges"
        description={`${rows.length} charges · ${formatMoney(totals.unpaid)} still to collect`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New charge
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Charged" value={formatMoney(totals.total)} sublabel={`${rows.length} charges in view`} icon={Layers} />
        <KpiCard label="Collected" value={formatMoney(totals.paid)} sublabel={totals.total > 0 ? `${formatPercent(totals.paid / totals.total)} of charges` : "—"} tone="success" />
        <KpiCard label="Outstanding" value={formatMoney(totals.unpaid)} tone={totals.unpaid > 0 ? "warning" : "success"} sublabel="Per-unit shares not yet paid" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input type="month" value={period ?? ""} onChange={(e) => setParams({ period: e.target.value })} className="w-40" aria-label="Month" />
        {period && <Button variant="ghost" size="sm" onClick={() => setParams({ period: null })}>All months</Button>}
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.charge.id} onRowClick={(r) => setSelected(r.charge.id)} rowClassName={(r) => (r.charge.id === current?.charge.id ? "bg-accent/50" : undefined)} dense pageSize={60} exportName="common-charges" emptyTitle="No common charges" emptyDescription="Create a charge to split a building cost across its units." emptyIcon={Layers} />
        {current && (
          <SectionCard
            title={`${labelize(current.charge.category)} · ${formatMonth(current.charge.period)}`}
            description={`${current.property.name} · ${formatMoney(current.charge.totalAmount)} split ${labelize(current.charge.allocationMethod).toLowerCase()} across ${current.allocations.length} units${current.charge.notes ? ` · ${current.charge.notes}` : ""}`}
            action={
              current.paidCount === 0 ? (
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-critical" onClick={() => { if (window.confirm("Remove this charge?")) { const { undo } = run(deleteCommonCharge(current.charge.id)); toast.success("Charge removed", { action: undo ? { label: "Undo", onClick: undo } : undefined }); } }}>
                  <Trash2 className="size-4" />
                </Button>
              ) : undefined
            }
            flush
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Unit</th>
                  <th className="px-4 py-2 font-medium">Tenant</th>
                  <th className="px-4 py-2 text-right font-medium">Share</th>
                  <th className="px-4 py-2 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {current.allocations.map((a) => (
                  <tr key={a.unitId} className="border-t">
                    <td className="px-4 py-1.5"><button type="button" className="font-medium hover:underline" onClick={() => openUnitPage(a.unit.id)}>{a.unit.unitNumber}</button></td>
                    <td className="px-4 py-1.5 text-muted-foreground">{a.tenant?.fullName ?? "vacant"}</td>
                    <td className="px-4 py-1.5 text-right">{formatMoney(a.amount)}</td>
                    <td className="px-4 py-1.5">
                      <button type="button" className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", a.paid ? "border-success/20 bg-success-muted text-success" : "border-border bg-muted text-muted-foreground hover:text-foreground")} onClick={() => run(setAllocationPaid(current.charge.id, a.unitId, !a.paid))}>
                        {a.paid ? <Check className="size-3" /> : null}
                        {a.paid ? `paid ${a.paidDate ? formatDate(a.paidDate) : ""}` : "mark paid"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>
      {creating && <ChargeDialog defaultPropertyId={propertyId ?? store.properties[0]?.id ?? null} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ChargeDialog({ defaultPropertyId, onClose }: { defaultPropertyId: string | null; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const [propertyId, setPropertyId] = useState<string | null>(defaultPropertyId);
  const [period, setPeriod] = useState(currentPeriod());
  const [category, setCategory] = useState("cleaning");
  const [total, setTotal] = useState(0);
  const [method, setMethod] = useState<AllocationMethod>("equal");
  const [notes, setNotes] = useState("");
  const units = useMemo(() => (propertyId ? (indexStore(store).unitsByProperty.get(propertyId) ?? []) : []), [store, propertyId]);
  const preview = useMemo(() => (propertyId && method !== "custom" ? allocateCharge(total, units, method) : []), [propertyId, total, units, method]);
  const valid = propertyId !== null && total > 0 && /^\d{4}-\d{2}$/.test(period) && category.trim().length > 0 && method !== "custom";

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = run(addCommonCharge({ propertyId, period, category, totalAmount: total, allocationMethod: method, notes }));
      toast.success(`Charge created — ${labelize(result.category)} ${formatMoney(result.totalAmount)} across ${result.allocations.length} units`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the charge");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title="New common charge" description="The allocation method is configurable — equal, by floor area or by bedrooms" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Create charge</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="cc-property"><PropertySelect id="cc-property" value={propertyId} onChange={setPropertyId} /></Field>
        <Field label="Month" htmlFor="cc-period"><Input id="cc-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <Field label="Charge" htmlFor="cc-category"><EnumSelect id="cc-category" values={CATEGORIES} value={category} onChange={(v) => v && setCategory(v)} /></Field>
        <Field label="Total amount" htmlFor="cc-total"><MoneyInput id="cc-total" value={total} onChange={setTotal} /></Field>
        <Field label="Allocation method" htmlFor="cc-method"><EnumSelect id="cc-method" values={ALLOCATION_METHODS.filter((m) => m !== "custom")} value={method} onChange={(v) => v && setMethod(v)} /></Field>
        <Field label="Notes" htmlFor="cc-notes"><Input id="cc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      </div>
      {preview.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          <table className="w-full text-xs">
            <tbody className="tabular">
              {preview.map((a) => {
                const u = units.find((x) => x.id === a.unitId)!;
                return (
                  <tr key={a.unitId} className="border-t first:border-0">
                    <td className="px-3 py-1">{u.unitNumber}</td>
                    <td className="px-3 py-1 text-muted-foreground">{method === "by_area" ? `${u.sizeSqm} m²` : method === "by_bedrooms" ? `${u.bedrooms} BR` : ""}</td>
                    <td className="px-3 py-1 text-right font-medium">{formatMoney(a.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FlowDialog>
  );
}
