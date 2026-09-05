"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Gauge, Plus } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect, UnitSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Field, FlowDialog } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { addMeter, recordReading } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { today } from "@/lib/date";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { getMeters, type MeterRow } from "@/lib/queries";
import { BILLING_METHODS, UTILITY_TYPES, type BillingMethod, type UtilityType } from "@/types";

/** Utilities (plan §Phase 6): meters, readings, consumption and the expenses they book. */
export function UtilitiesPage() {
  const { store } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const { openUnitPage } = useActions();
  const propertyId = params.get("property");
  const type = params.get("type") as UtilityType | null;
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"meter" | "reading" | null>(null);

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/utilities${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const meters = useMemo(() => getMeters(store, { propertyId: propertyId ?? undefined, type: type ?? undefined }), [store, propertyId, type]);
  const current = meters.find((m) => m.meter.id === selected) ?? meters[0] ?? null;
  const totals = useMemo(() => {
    const lastMonth = meters.map((m) => m.trend[m.trend.length - 1]).filter(Boolean);
    return { meters: meters.length, buildingLevel: meters.filter((m) => !m.unit).length, amount: lastMonth.reduce((n, t) => n + (t.amount ?? 0), 0), missing: meters.filter((m) => !m.lastReading || m.lastReading.readingDate < today().slice(0, 7) + "-01").length };
  }, [meters]);

  const columns: Column<MeterRow>[] = [
    { key: "number", header: "Meter", cell: (m) => <span className="font-medium">{m.meter.meterNumber}</span>, value: (m) => m.meter.meterNumber },
    { key: "type", header: "Utility", cell: (m) => <StatusBadge value={m.meter.utilityType} tone="neutral" />, value: (m) => m.meter.utilityType },
    { key: "where", header: "Building · Unit", cell: (m) => `${m.property.name}${m.unit ? ` · ${m.unit.unitNumber}` : " · common"}`, value: (m) => `${m.property.name} ${m.unit?.unitNumber ?? ""}` },
    { key: "billing", header: "Billing", cell: (m) => `${labelize(m.meter.billingMethod)}${m.meter.unitRate ? ` · ${formatMoney(m.meter.unitRate)}/${m.meter.unitLabel}` : ""}`, value: (m) => m.meter.billingMethod },
    { key: "last", header: "Last reading", cell: (m) => (m.lastReading ? `${m.lastReading.currentReading.toLocaleString("en-US")} · ${formatDate(m.lastReading.readingDate)}` : <span className="text-warning-foreground">none</span>), value: (m) => m.lastReading?.readingDate ?? "" },
    { key: "used", header: "Last consumption", align: "right", cell: (m) => (m.lastReading ? `${m.lastReading.consumption.toLocaleString("en-US")} ${m.meter.unitLabel}` : "—"), value: (m) => m.lastReading?.consumption ?? 0 },
    { key: "amount", header: "Last amount", align: "right", cell: (m) => (m.lastReading?.calculatedAmount ? formatMoney(m.lastReading.calculatedAmount) : "—"), value: (m) => m.lastReading?.calculatedAmount ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Utilities"
        description={`${totals.meters} meters · ${totals.buildingLevel} building-level`}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog("meter")}>
              <Plus className="size-4" /> Add meter
            </Button>
            <Button onClick={() => setDialog("reading")} disabled={!current}>
              <Gauge className="size-4" /> Record reading
            </Button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Meters" value={totals.meters} sublabel={`${totals.meters - totals.buildingLevel} on units`} />
        <KpiCard label="Latest readings cost" value={formatMoney(totals.amount)} sublabel="Sum of the last reading on each metered meter" />
        <KpiCard label="No reading this month" value={totals.missing} tone={totals.missing > 0 ? "warning" : "success"} sublabel="Meters still to read" />
        <KpiCard label="Common-area electricity" value={formatMoney(meters.filter((m) => !m.unit && m.meter.utilityType === "electricity").reduce((n, m) => n + (m.lastReading?.calculatedAmount ?? 0), 0))} sublabel="Last reading, all buildings" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-44">
          <EnumSelect values={UTILITY_TYPES} value={type} onChange={(v) => setParams({ type: v })} allowAll allLabel="All utilities" />
        </div>
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <DataTable rows={meters} columns={columns} rowKey={(m) => m.meter.id} onRowClick={(m) => setSelected(m.meter.id)} rowClassName={(m) => (m.meter.id === current?.meter.id ? "bg-accent/50" : undefined)} dense pageSize={100} exportName="meters" searchable={(m) => `${m.meter.meterNumber} ${m.property.name} ${m.unit?.unitNumber ?? ""} ${m.meter.utilityType}`} emptyTitle="No meters yet" emptyIcon={Gauge} />
        {current && (
          <SectionCard
            title={`${current.meter.meterNumber} · ${labelize(current.meter.utilityType)}`}
            description={`${current.property.name}${current.unit ? ` · unit ${current.unit.unitNumber}` : " · common areas"} · ${current.readings.length} readings · ${current.totalConsumption.toLocaleString("en-US")} ${current.meter.unitLabel} total`}
            action={current.unit ? <Button size="sm" variant="ghost" onClick={() => openUnitPage(current.unit!.id, "utilities")}>Unit</Button> : undefined}
            flush
          >
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Previous</th>
                  <th className="px-4 py-2 text-right font-medium">Current</th>
                  <th className="px-4 py-2 text-right font-medium">Used</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {current.readings.slice().reverse().map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-1.5">{formatDate(r.readingDate)}{r.meterReset && <span className="ml-1 text-[10px] text-muted-foreground">reset</span>}{r.note && <span className="ml-1 text-[10px] text-muted-foreground">· {r.note}</span>}</td>
                    <td className="px-4 py-1.5 text-right text-muted-foreground">{r.previousReading.toLocaleString("en-US")}</td>
                    <td className="px-4 py-1.5 text-right">{r.currentReading.toLocaleString("en-US")}</td>
                    <td className="px-4 py-1.5 text-right font-medium">{r.consumption.toLocaleString("en-US")} {current.meter.unitLabel}</td>
                    <td className="px-4 py-1.5 text-right">{r.calculatedAmount === null ? "—" : formatMoney(r.calculatedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
        )}
      </div>
      {dialog === "meter" && <MeterDialog defaultPropertyId={propertyId ?? store.properties[0]?.id ?? null} onClose={() => setDialog(null)} />}
      {dialog === "reading" && current && <ReadingDialog meter={current} onClose={() => setDialog(null)} />}
    </div>
  );
}

function MeterDialog({ defaultPropertyId, onClose }: { defaultPropertyId: string | null; onClose: () => void }) {
  const { run } = useStoreContext();
  const [propertyId, setPropertyId] = useState<string | null>(defaultPropertyId);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [utilityType, setUtilityType] = useState<UtilityType>("electricity");
  const [meterNumber, setMeterNumber] = useState("");
  const [billing, setBilling] = useState<BillingMethod>("metered");
  const [rate, setRate] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const valid = propertyId !== null && meterNumber.trim().length > 0;

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = run(addMeter({ propertyId, unitId, utilityType, meterNumber, billingMethod: billing, unitRate: rate ? Number(rate) : null, unitLabel: unitLabel || undefined }));
      toast.success(`Meter ${result.meterNumber} added`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the meter");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title="Add meter" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Add meter</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="mt-property"><PropertySelect id="mt-property" value={propertyId} onChange={(id) => { setPropertyId(id); setUnitId(null); }} /></Field>
        <Field label="Unit (blank = building)" htmlFor="mt-unit"><UnitSelect id="mt-unit" propertyId={propertyId} value={unitId} onChange={setUnitId} allowNone /></Field>
        <Field label="Utility" htmlFor="mt-type"><EnumSelect id="mt-type" values={UTILITY_TYPES} value={utilityType} onChange={(v) => v && setUtilityType(v)} /></Field>
        <Field label="Meter number" htmlFor="mt-number"><Input id="mt-number" value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} placeholder="EDL-BH-403" autoFocus /></Field>
        <Field label="Billing" htmlFor="mt-billing"><EnumSelect id="mt-billing" values={BILLING_METHODS} value={billing} onChange={(v) => v && setBilling(v)} /></Field>
        <Field label="Rate per unit" htmlFor="mt-rate" hint="Optional — used to cost each reading"><Input id="mt-rate" type="number" step="0.01" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.11" /></Field>
        <Field label="Unit label" htmlFor="mt-label"><Input id="mt-label" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder={utilityType === "water" ? "m³" : "kWh"} /></Field>
      </div>
    </FlowDialog>
  );
}

export function ReadingDialog({ meter, onClose }: { meter: MeterRow; onClose: () => void }) {
  const { run } = useStoreContext();
  const [date, setDate] = useState(today());
  const [current, setCurrent] = useState<string>("");
  const [reset, setReset] = useState(false);
  const [book, setBook] = useState(meter.meter.unitRate !== null && !meter.unit);
  const [note, setNote] = useState("");
  const previous = meter.lastReading?.currentReading ?? 0;
  const value = Number(current);
  const consumption = current === "" ? null : reset ? value : value - previous;
  const amount = consumption !== null && meter.meter.unitRate !== null ? Math.round(Math.max(0, consumption) * meter.meter.unitRate * 100) / 100 : null;
  const valid = current !== "" && Number.isFinite(value) && value >= 0 && (reset || value >= previous);

  function submit() {
    if (!valid) return;
    try {
      const { result, undo } = run(recordReading({ meterId: meter.meter.id, readingDate: date, currentReading: value, meterReset: reset, note: note || null, bookExpense: book }));
      toast.success(`Reading recorded — ${result.consumption.toLocaleString("en-US")} ${meter.meter.unitLabel}${result.calculatedAmount ? ` · ${formatMoney(result.calculatedAmount)}` : ""}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the reading");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={`Record reading — ${meter.meter.meterNumber}`} description={`${meter.property.name}${meter.unit ? ` · ${meter.unit.unitNumber}` : ""} · previous ${previous.toLocaleString("en-US")}${meter.lastReading ? ` on ${formatDate(meter.lastReading.readingDate)}` : ""}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Save reading</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reading date" htmlFor="rd-date"><Input id="rd-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Current reading" htmlFor="rd-value" hint={consumption !== null ? `${Math.max(0, consumption).toLocaleString("en-US")} ${meter.meter.unitLabel}${amount !== null ? ` · ${formatMoney(amount)}` : ""}` : undefined}>
          <Input id="rd-value" type="number" min={0} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus className={valid || current === "" ? "" : "border-critical"} />
        </Field>
        <div className="flex items-center gap-3">
          <Switch id="rd-reset" checked={reset} onCheckedChange={setReset} />
          <label htmlFor="rd-reset" className="text-sm">Meter was reset / replaced</label>
        </div>
        {meter.meter.unitRate !== null && (
          <div className="flex items-center gap-3">
            <Switch id="rd-book" checked={book} onCheckedChange={setBook} />
            <label htmlFor="rd-book" className="text-sm">Book {amount !== null ? formatMoney(amount) : "the amount"} as an expense</label>
          </div>
        )}
        <Field label="Note" htmlFor="rd-note" className="sm:col-span-2"><Input id="rd-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      </div>
      {!valid && current !== "" && !reset && value < previous && <p className="text-xs text-critical">The reading is lower than the previous one. Mark a reset if the meter was replaced.</p>}
    </FlowDialog>
  );
}
