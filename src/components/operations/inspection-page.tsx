"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Camera, Check, ClipboardCheck, Plus, Trash2, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { DataTable } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { DocumentPreview } from "@/components/documents/document-preview";
import { ReadingDialog } from "@/components/finance/utilities-page";
import { workOrderColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { addInspectionItem, cancelInspection, recordInspectionItem, removeInspectionItem, returnAllKeys, returnKey } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney, labelize } from "@/lib/format";
import { getInspectionDetails, type MeterRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { InspectionItem, ItemResult, StoredDocument, WorkOrderCategory } from "@/types";

const RESULTS: { value: ItemResult; label: string; tone: string }[] = [
  { value: "pass", label: "Pass", tone: "data-[on=true]:bg-success data-[on=true]:text-white" },
  { value: "attention", label: "Attention", tone: "data-[on=true]:bg-warning data-[on=true]:text-white" },
  { value: "fail", label: "Fail", tone: "data-[on=true]:bg-critical data-[on=true]:text-white" },
];

function categoryFor(area: string): WorkOrderCategory {
  const a = area.toLowerCase();
  if (a.includes("bath") || a.includes("kitchen") || a.includes("water")) return "plumbing";
  if (a.includes("electric")) return "electrical";
  if (a.includes("elevator")) return "elevator";
  if (a.includes("generator")) return "generator";
  if (a.includes("fire") || a.includes("security")) return "security";
  if (a.includes("wall") || a.includes("living") || a.includes("bedroom")) return "painting";
  if (a.includes("clean")) return "cleaning";
  return "other";
}

/** Inspection page (plan §Phase 10): record the checklist item by item, compare with the previous report, raise follow-ups, and run the move-out steps. */
export function InspectionPage({ inspectionId }: { inspectionId: string }) {
  const { store, run } = useStoreContext();
  const { completeInspection, createWorkOrder, openWorkOrder, openTenant, openUnitPage, openDeposit, openAsset, issueKey, scheduleInspection } = useActions();
  const d = useMemo(() => getInspectionDetails(store, inspectionId), [store, inspectionId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);
  const [reading, setReading] = useState<MeterRow | null>(null);
  const [newArea, setNewArea] = useState("");
  const [newItem, setNewItem] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  if (!d) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Inspection not found"
        action={
          <Button asChild variant="outline">
            <Link href="/inspections">All inspections</Link>
          </Button>
        }
      />
    );
  }
  const i = d.inspection;
  const closed = i.status === "completed" || i.status === "cancelled";
  const isMove = i.type === "move_in" || i.type === "move_out";
  const keysOut = d.keys.filter((k) => k.key.status === "issued");
  const where = `${d.property.name}${d.unit ? ` · ${d.unit.unitNumber}` : d.asset ? ` · ${d.asset.name}` : ""}`;

  function record(item: InspectionItem, patch: { result?: ItemResult; notes?: string | null; followUpRequired?: boolean }) {
    try {
      run(recordInspectionItem(i.id, item.id, patch));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the item");
    }
  }
  function saveNote(item: InspectionItem) {
    record(item, { notes: noteDraft });
    setNoteFor(null);
  }
  function addItem() {
    if (!newItem.trim()) return;
    try {
      run(addInspectionItem(i.id, { area: newArea, item: newItem }));
      setNewItem("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the item");
    }
  }
  function raise(item: InspectionItem) {
    createWorkOrder({ propertyId: i.propertyId, unitId: i.unitId, assetId: i.assetId, tenantId: i.tenantId, inspectionId: i.id, inspectionItemId: item.id, title: `${item.area} — ${item.item}`, description: item.notes ?? `Found during the ${labelize(i.type)} inspection on ${formatDate(i.completedDate ?? i.scheduledDate)}.`, category: categoryFor(item.area), priority: item.result === "fail" ? "high" : "normal", source: "inspection" });
  }
  function cancel() {
    try {
      const { undo } = run(cancelInspection(i.id));
      toast.success("Inspection cancelled", { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    }
  }
  function returnKeys() {
    try {
      const all = i.tenantId !== null && keysOut.every((k) => k.key.tenantId === i.tenantId);
      const { result, undo } = all ? run(returnAllKeys(i.tenantId!)) : run(returnKey(keysOut[0].key.id));
      const n = Array.isArray(result) ? result.length : 1;
      toast.success(`${n} key${n === 1 ? "" : "s"} returned`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not return the keys");
    }
  }

  const groups = new Map<string, InspectionItem[]>();
  for (const it of i.items) groups.set(it.area, [...(groups.get(it.area) ?? []), it]);
  const pct = d.progress.total > 0 ? Math.round((d.progress.recorded / d.progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Inspections", href: "/inspections" }, { label: `${labelize(i.type)} · ${where}` }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {labelize(i.type)} inspection
            <StatusBadge value={d.overdue ? "overdue" : i.status} label={d.overdue ? "Overdue" : undefined} dot />
            {i.overallResult && <StatusBadge value={i.overallResult} />}
          </span>
        }
        description={`${where} · ${i.status === "completed" ? `completed ${formatDate(i.completedDate)}` : `scheduled ${formatDate(i.scheduledDate)}`} · ${i.inspector}${d.tenant ? ` · ${d.tenant.fullName}` : ""}`}
        actions={
          <>
            {d.unit && <Button variant="outline" onClick={() => openUnitPage(d.unit!.id)}>Unit</Button>}
            {d.asset && <Button variant="outline" onClick={() => openAsset(d.asset!.id)}>Asset</Button>}
            {!closed && (
              <Button variant="ghost" onClick={cancel}>
                <X className="size-4" /> Cancel
              </Button>
            )}
            {!closed && (
              <Button onClick={() => completeInspection(i.id)} disabled={d.progress.recorded === 0}>
                <Check className="size-4" /> Complete
              </Button>
            )}
            {i.status === "completed" && d.followUps > 0 && (
              <Button onClick={() => raise(i.items.find((it) => it.followUpRequired && !it.workOrderId)!)}>
                <Wrench className="size-4" /> Raise follow-up
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Progress" value={`${d.progress.recorded}/${d.progress.total}`} sublabel={`${pct}% recorded`} tone={closed ? "default" : pct === 100 ? "success" : "warning"} />
        <KpiCard label="Failed" value={d.progress.fail} tone={d.progress.fail > 0 ? "critical" : "success"} sublabel={`${d.progress.attention} need attention`} />
        <KpiCard label="Follow-ups" value={d.followUps} tone={d.followUps > 0 ? "warning" : "success"} sublabel={d.workOrders.length > 0 ? `${d.workOrders.length} work order${d.workOrders.length === 1 ? "" : "s"} raised` : "No work orders yet"} />
        {isMove && d.deposit ? (
          <KpiCard label="Deposit" value={formatMoney(d.deposit.amountHeld)} sublabel={`${labelize(d.deposit.status)}${d.deposit.deductions.length > 0 ? ` · ${d.deposit.deductions.length} deduction${d.deposit.deductions.length === 1 ? "" : "s"}` : ""}`} href={`/finance/deposits?tenant=${d.deposit.tenantId}`} />
        ) : (
          <KpiCard label="Reference" value={d.reference ? formatDate(d.reference.inspection.completedDate) : "—"} sublabel={d.reference ? `${labelize(d.reference.inspection.type)} · ${labelize(d.reference.inspection.overallResult ?? "pass")}` : "No earlier report to compare"} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Checklist" description={closed ? "Recorded results — items can still be annotated" : "Tap a result for each item; failed items are flagged for follow-up"} flush>
            {[...groups.entries()].map(([area, items]) => (
              <div key={area}>
                <p className="border-b bg-muted/40 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{area}</p>
                <ul className="divide-y">
                  {items.map((item) => {
                    const cmp = d.comparison.find((c) => c.area === item.area && c.item === item.item);
                    return (
                      <li key={item.id} className={cn("px-4 py-2", item.result === "fail" && "bg-critical-muted/20", item.result === "attention" && "bg-warning-muted/20")}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 text-sm">
                            {item.item}
                            {cmp?.before && cmp.before !== "na" && <span className={cn("ml-2 text-xs", cmp.deteriorated ? "text-critical" : "text-muted-foreground")}>{cmp.deteriorated ? "worse than " : "was "}{labelize(cmp.before)}{d.reference ? ` (${formatDate(d.reference.inspection.completedDate)})` : ""}</span>}
                          </span>
                          <span className="inline-flex overflow-hidden rounded-md border">
                            {RESULTS.map((r) => (
                              <button key={r.value} type="button" disabled={i.status === "cancelled"} data-on={item.result === r.value} onClick={() => record(item, { result: item.result === r.value ? "na" : r.value })} className={cn("px-2 py-1 text-xs hover:bg-accent disabled:cursor-default", r.tone)}>
                                {r.label}
                              </button>
                            ))}
                          </span>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setNoteFor(item.id); setNoteDraft(item.notes ?? ""); }}>{item.notes ? "Edit note" : "Note"}</Button>
                          {item.workOrderId ? (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openWorkOrder(item.workOrderId!)}>Work order</Button>
                          ) : item.followUpRequired ? (
                            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => raise(item)}><Wrench className="size-3" /> Raise</Button>
                          ) : item.result === "attention" ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => record(item, { followUpRequired: true })}>Needs follow-up</Button>
                          ) : null}
                          {!closed && item.result === "na" && !item.workOrderId && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground" aria-label="Remove item" onClick={() => run(removeInspectionItem(i.id, item.id))}><Trash2 className="size-3.5" /></Button>
                          )}
                        </div>
                        {noteFor === item.id ? (
                          <div className="mt-2 flex gap-2">
                            <Input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="What was found" autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveNote(item); if (e.key === "Escape") setNoteFor(null); }} />
                            <Button size="sm" onClick={() => saveNote(item)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
                          </div>
                        ) : item.notes ? (
                          <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {!closed && (
              <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                <Input value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="Area" className="w-32" />
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item not on the template" className="min-w-48 flex-1" onKeyDown={(e) => e.key === "Enter" && addItem()} />
                <Button variant="outline" onClick={addItem} disabled={!newItem.trim()}><Plus className="size-4" /> Add</Button>
              </div>
            )}
          </SectionCard>

          {d.workOrders.length > 0 && (
            <SectionCard title="Work orders raised" flush>
              <div className="p-3">
                <DataTable rows={d.workOrders} columns={workOrderColumns.filter((c) => c.key !== "where")} rowKey={(r) => r.workOrder.id} onRowClick={(r) => openWorkOrder(r.workOrder.id)} dense />
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-5">
          {isMove && (
            <SectionCard title={i.type === "move_out" ? "Move-out steps" : "Move-in steps"} description="Everything that closes the tenancy properly">
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <StepMark done={i.status === "completed"} />
                  <span className="flex-1">Condition report{d.reference ? ` compared with the ${labelize(d.reference.inspection.type)} report of ${formatDate(d.reference.inspection.completedDate)}` : ""}{d.comparison.some((c) => c.deteriorated) ? ` — ${d.comparison.filter((c) => c.deteriorated).length} item${d.comparison.filter((c) => c.deteriorated).length === 1 ? "" : "s"} worse than before` : ""}</span>
                </li>
                <li className="flex items-start gap-2">
                  <StepMark done={i.type === "move_out" ? keysOut.length === 0 : keysOut.length > 0} />
                  <span className="flex-1">
                    {i.type === "move_out" ? (keysOut.length === 0 ? "All keys returned" : `${keysOut.length} key${keysOut.length === 1 ? "" : "s"} still out: ${keysOut.map((k) => `${labelize(k.key.type)} ${k.key.identifier}`).join(", ")}`) : keysOut.length > 0 ? `${keysOut.length} key${keysOut.length === 1 ? "" : "s"} issued` : "Keys not issued yet"}
                  </span>
                  {i.type === "move_out" && keysOut.length > 0 && <Button size="sm" variant="outline" onClick={returnKeys}>Return keys</Button>}
                  {i.type === "move_in" && d.keys.some((k) => k.key.status !== "issued" && k.key.status !== "lost") && <Button size="sm" variant="outline" onClick={() => issueKey(d.keys.find((k) => k.key.status !== "issued" && k.key.status !== "lost")!.key.id, i.tenantId)}>Issue key</Button>}
                </li>
                <li className="flex items-start gap-2">
                  <StepMark done={i.items.some((it) => it.area === "Meters" && it.result === "pass")} />
                  <span className="flex-1">
                    {i.type === "move_out" ? "Closing" : "Opening"} readings{d.meters.length > 0 ? ` — ${d.meters.map((m) => `${labelize(m.meter.utilityType)}${m.lastReading ? ` ${m.lastReading.currentReading} on ${formatDate(m.lastReading.readingDate)}` : " (no reading)"}`).join(", ")}` : " — no meters on this unit"}
                  </span>
                  {d.meters.map((m) => (
                    <Button key={m.meter.id} size="sm" variant="outline" onClick={() => setReading(m)}>Read {labelize(m.meter.utilityType)}</Button>
                  ))}
                </li>
                {d.parking.length > 0 && i.type === "move_out" && (
                  <li className="flex items-start gap-2">
                    <StepMark done={false} />
                    <span className="flex-1">Parking {d.parking.map((p) => p.space.spaceNumber).join(", ")} still assigned — release it from the register when the car is gone</span>
                    <Button asChild size="sm" variant="outline"><Link href={`/parking?unit=${i.unitId}`}>Parking</Link></Button>
                  </li>
                )}
                {d.deposit && (
                  <li className="flex items-start gap-2">
                    <StepMark done={i.type === "move_out" ? d.deposit.status === "settled" : d.deposit.amountReceived >= d.deposit.amountExpected} />
                    <span className="flex-1">
                      {i.type === "move_out" ? `Deposit ${labelize(d.deposit.status)} — ${formatMoney(d.deposit.amountHeld)} held${d.deposit.deductions.length > 0 ? `, ${formatMoney(d.deposit.deductions.reduce((n, x) => n + x.amount, 0))} deducted` : ""}${d.progress.fail + d.progress.attention > 0 && d.deposit.status !== "settled" ? " — add deductions for the damage found above" : ""}` : `Deposit ${formatMoney(d.deposit.amountReceived)} of ${formatMoney(d.deposit.amountExpected)} received`}
                    </span>
                    <Button size="sm" variant={i.type === "move_out" && i.status === "completed" && d.deposit.status !== "settled" ? "default" : "outline"} onClick={() => openDeposit(d.deposit!.id)}>{i.type === "move_out" ? "Deposit" : "Receive"}</Button>
                  </li>
                )}
              </ol>
            </SectionCard>
          )}

          <SectionCard title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Building"><Link href={`/properties/${d.property.id}`} className="hover:underline">{d.property.name}</Link></Field>
              <Field label="Unit">{d.unit ? <button type="button" className="hover:underline" onClick={() => openUnitPage(d.unit!.id)}>{d.unit.unitNumber}</button> : "—"}</Field>
              <Field label="Tenant">{d.tenant ? <button type="button" className="hover:underline" onClick={() => openTenant(d.tenant!.id)}>{d.tenant.fullName}</button> : "—"}</Field>
              <Field label="Contract">{d.contract ? `${formatDate(d.contract.startDate)} → ${formatDate(d.contract.moveOutDate ?? d.contract.endDate)}` : "—"}</Field>
              <Field label="Scheduled">{formatDate(i.scheduledDate)}</Field>
              <Field label="Completed">{formatDate(i.completedDate)}</Field>
              <Field label="Inspector">{i.inspector}</Field>
              <Field label="Reference">{d.reference ? <Link href={`/inspections/${d.reference.inspection.id}`} className="hover:underline">{labelize(d.reference.inspection.type)} · {formatDate(d.reference.inspection.completedDate)}</Link> : "—"}</Field>
            </dl>
            {i.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-muted/50 p-3 text-sm">{i.notes}</p>}
            {!closed && d.unit && i.type !== "move_out" && i.type !== "move_in" && (
              <p className="mt-3 text-xs text-muted-foreground">
                Need a tenancy checklist instead? <button type="button" className="underline" onClick={() => scheduleInspection({ unitId: d.unit!.id, propertyId: d.property.id, type: "move_out" })}>Schedule a move-out</button>.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Photos" description={`${d.photos.length} attached`} flush>
            {d.photos.length > 0 && (
              <ul className="divide-y">
                {d.photos.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onPreview={setPreview} />
                ))}
              </ul>
            )}
            <div className={cn("px-4 py-3", d.photos.length > 0 && "border-t")}>
              <AttachmentUploader compact photos links={{ inspectionId: i.id, unitId: i.unitId ?? undefined, propertyId: i.propertyId, tenantId: i.tenantId ?? undefined }} category="photo" label="Add photos" />
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Camera className="size-3.5" /> Photos stay attached to the unit file and the tenant.</p>
            </div>
          </SectionCard>
        </div>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
      {reading && <ReadingDialog meter={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

function StepMark({ done }: { done: boolean }) {
  return <span className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border", done ? "border-success bg-success text-white" : "text-transparent")}><Check className="size-3" /></span>;
}
