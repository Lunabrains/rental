"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Hammer, Pause, Pencil, Play, Plus, Receipt, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { DataTable } from "@/components/common/data-table";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/states";
import { StatusBadge } from "@/components/common/status-badge";
import { Timeline } from "@/components/common/timeline";
import { DocumentPreview } from "@/components/documents/document-preview";
import { ProgressBar } from "@/components/operations/renovations-page";
import { expenseColumns } from "@/components/properties/building-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentRow } from "@/components/units/documents-tab";
import { Field } from "@/components/units/tenant-tab";
import { addRenovationTask, canTransitionRenovation, removeRenovationTask, setRenovationStatus, toggleRenovationTask } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { formatDate, formatMoney, formatPercent, labelize } from "@/lib/format";
import { getRenovationDetails, getRenovationImpact, type TimelineEvent } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { RenovationStatus, StoredDocument } from "@/types";

/** Project page (plan §Phase 11): budget vs actual, tasks, contractor, photos, and the return on a unit renovation. */
export function RenovationPage({ renovationId }: { renovationId: string }) {
  const { store, run } = useStoreContext();
  const { editRenovation, completeRenovation, addExpense, editExpense, openUnitPage, openSupplier } = useActions();
  const d = useMemo(() => getRenovationDetails(store, renovationId), [store, renovationId]);
  const impact = useMemo(() => getRenovationImpact(store, renovationId), [store, renovationId]);
  const [preview, setPreview] = useState<StoredDocument | null>(null);
  const [task, setTask] = useState("");

  if (!d || !impact) {
    return (
      <EmptyState
        icon={Hammer}
        title="Project not found"
        action={
          <Button asChild variant="outline">
            <Link href="/renovations">All projects</Link>
          </Button>
        }
      />
    );
  }
  const r = d.renovation;
  const live = r.status === "planned" || r.status === "in_progress" || r.status === "on_hold";

  function move(status: RenovationStatus) {
    try {
      const { undo } = run(setRenovationStatus(r.id, status));
      toast.success(`${r.title} — ${labelize(status)}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the status");
    }
  }
  function addTask() {
    if (!task.trim()) return;
    try {
      run(addRenovationTask(r.id, { title: task }));
      setTask("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the task");
    }
  }
  const book = () => addExpense({ propertyId: r.propertyId, unitId: r.unitId, supplierId: r.contractorSupplierId, renovationId: r.id, category: "renovation", classification: "capex", description: `${r.title} — ` });

  const timeline: TimelineEvent[] = [
    ...d.expenses.map((e) => ({ id: `e-${e.expense.id}`, at: e.expense.expenseDate, title: e.expense.description, detail: `${formatMoney(e.expense.amount)} · ${e.supplier?.name ?? labelize(e.expense.category)} · ${labelize(e.expense.paymentStatus)}`, tone: "default" as const, kind: "expense" as const })),
    ...store.activity.filter((a) => a.renovationId === r.id).map((a) => ({ id: `a-${a.id}`, at: a.at, title: a.message, detail: "", tone: "info" as const, kind: "activity" as const })),
    ...d.documents.map((doc) => ({ id: `d-${doc.id}`, at: doc.uploadedAt, title: `Photo / document — ${doc.title}`, detail: labelize(doc.category), tone: "default" as const, kind: "document" as const })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

  const variancePct = d.variancePct;
  const scheduleTone = d.delayed ? "critical" : impact.slipDays !== null && impact.slipDays > 0 ? "warning" : "default";

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Renovations", href: "/renovations" }, { label: r.title }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.title}
            <StatusBadge value={r.status} dot />
            {d.delayed && <StatusBadge value="delayed" label={`Delayed ${Math.abs(d.daysToTarget)}d`} />}
            {d.variance > 0 && live && <StatusBadge value="over_budget" label="Over budget" />}
          </span>
        }
        description={`${labelize(r.projectType)} · ${d.property.name}${d.unit ? ` · unit ${d.unit.unitNumber}` : " · building-wide"}${d.contractor ? ` · ${d.contractor.name}` : ""} · ${formatDate(r.startDate)} → ${formatDate(r.actualEndDate ?? r.targetEndDate)}${r.description ? ` · ${r.description}` : ""}`}
        actions={
          <>
            <Button variant="outline" onClick={() => editRenovation(r.id)}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="outline" onClick={book}>
              <Receipt className="size-4" /> Book cost
            </Button>
            {r.status === "planned" && <Button onClick={() => move("in_progress")}><Play className="size-4" /> Start</Button>}
            {r.status === "in_progress" && <Button variant="outline" onClick={() => move("on_hold")}><Pause className="size-4" /> Hold</Button>}
            {r.status === "on_hold" && <Button onClick={() => move("in_progress")}><Play className="size-4" /> Resume</Button>}
            {(r.status === "in_progress" || r.status === "on_hold") && <Button onClick={() => completeRenovation(r.id)}><Check className="size-4" /> Complete</Button>}
            {live && canTransitionRenovation(r.status, "cancelled") && <Button variant="ghost" onClick={() => move("cancelled")}><X className="size-4" /> Cancel</Button>}
            {r.status === "completed" && <Button variant="ghost" onClick={() => move("in_progress")}>Reopen</Button>}
            {r.status === "cancelled" && <Button variant="ghost" onClick={() => move("planned")}>Restore</Button>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Spent vs budget" value={`${formatMoney(r.actualCost)} / ${formatMoney(r.budget)}`} sublabel={variancePct === null ? "No budget set" : d.variance > 0 ? `${formatMoney(d.variance)} over (${formatPercent(variancePct)})` : `${formatMoney(-d.variance)} remaining`} tone={d.variance > 0 ? "critical" : r.budget > 0 && r.actualCost / r.budget > 0.9 && live ? "warning" : "default"} />
        <KpiCard label="Progress" value={`${r.progressPercent}%`} sublabel={d.tasksTotal > 0 ? `${d.tasksDone} of ${d.tasksTotal} tasks done` : "Set by tasks or edited manually"} tone={r.status === "completed" ? "success" : "default"} />
        <KpiCard label="Schedule" value={r.status === "completed" && impact.slipDays !== null ? (impact.slipDays > 0 ? `${impact.slipDays}d late` : impact.slipDays < 0 ? `${-impact.slipDays}d early` : "On time") : d.delayed ? `${Math.abs(d.daysToTarget)}d over` : `${d.daysToTarget}d left`} sublabel={`${impact.scheduleDays}-day plan · ${impact.elapsedDays} days elapsed`} tone={scheduleTone} />
        {d.unit ? (
          <KpiCard label="Return" value={impact.annualReturn !== null ? formatPercent(impact.annualReturn) : "—"} sublabel={impact.monthlyUplift !== null ? `${impact.monthlyUplift >= 0 ? "+" : ""}${formatMoney(impact.monthlyUplift)}/month${impact.afterIsProjected ? " (projected)" : ""}${impact.paybackMonths !== null ? ` · payback ${impact.paybackMonths} months` : ""}` : "Set the asking rent to estimate"} tone={impact.annualReturn !== null && impact.annualReturn >= 0.1 ? "success" : "default"} />
        ) : (
          <KpiCard label="Cost per unit" value={impact.costPerUnit !== null ? formatMoney(impact.costPerUnit) : "—"} sublabel="Spread across the building's units" />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Tasks" description={d.tasksTotal > 0 ? `${d.tasksDone}/${d.tasksTotal} done` : "Break the works into steps — progress follows the list"} flush>
            {r.tasks.length > 0 && (
              <ul className="divide-y">
                {r.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <button type="button" disabled={!live} onClick={() => run(toggleRenovationTask(r.id, t.id))} className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded border", t.done ? "border-success bg-success text-white" : "hover:bg-accent", !live && "cursor-default")} aria-pressed={t.done} aria-label={t.done ? "Mark not done" : "Mark done"}>
                      {t.done && <Check className="size-3.5" />}
                    </button>
                    <span className={cn("flex-1", t.done && "text-muted-foreground line-through")}>{t.title}</span>
                    {t.dueDate && <span className="text-xs text-muted-foreground">{formatDate(t.dueDate)}</span>}
                    {live && !t.done && <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground" aria-label="Remove task" onClick={() => run(removeRenovationTask(r.id, t.id))}><Trash2 className="size-3.5" /></Button>}
                  </li>
                ))}
              </ul>
            )}
            {live && (
              <div className={cn("flex gap-2 px-4 py-3", r.tasks.length > 0 && "border-t")}>
                <Input value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a task" onKeyDown={(e) => e.key === "Enter" && addTask()} />
                <Button variant="outline" onClick={addTask} disabled={!task.trim()}><Plus className="size-4" /> Add</Button>
              </div>
            )}
            <div className="border-t px-4 py-2">
              <ProgressBar value={r.progressPercent} tone={r.status === "completed" ? "success" : d.delayed ? "warning" : "default"} className="w-full" />
            </div>
          </SectionCard>
          <SectionCard title="Costs" description={`${d.expenses.length} CapEx expense${d.expenses.length === 1 ? "" : "s"} · ${formatMoney(r.actualCost)} — excluded from operating results`} action={<Button size="sm" variant="outline" onClick={book}><Receipt className="size-3.5" /> Book cost</Button>} flush>
            <div className="p-3">
              <DataTable rows={d.expenses} columns={expenseColumns} rowKey={(x) => x.expense.id} onRowClick={(x) => editExpense(x.expense.id)} dense emptyTitle="Nothing booked yet" emptyDescription="Invoices booked against the project roll up into the spent figure." />
            </div>
          </SectionCard>
        </div>
        <div className="space-y-5">
          {d.unit && (
            <SectionCard title="Unit impact" description="What the works do to the rent — before, after, and the empty weeks in between">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Rent before">{impact.rentBefore !== null ? `${formatMoney(impact.rentBefore)}/mo` : "—"}</Field>
                <Field label={impact.afterIsProjected ? "Asking rent after" : "Rent after"}>{impact.rentAfter !== null ? `${formatMoney(impact.rentAfter)}/mo` : "—"}</Field>
                <Field label="Annual uplift">{impact.annualUplift !== null ? <span className={cn(impact.annualUplift > 0 ? "text-success" : "text-muted-foreground")}>{impact.annualUplift >= 0 ? "+" : ""}{formatMoney(impact.annualUplift)}</span> : "—"}</Field>
                <Field label="Payback">{impact.paybackMonths !== null ? `${impact.paybackMonths} months` : "—"}</Field>
                <Field label="Empty during works">{impact.vacantDays !== null ? `${impact.vacantDays} days` : "—"}</Field>
                <Field label="Rent forgone (est.)">{impact.vacancyCost !== null && impact.vacancyCost > 0 ? formatMoney(impact.vacancyCost) : "—"}</Field>
                <Field label="Condition">{labelize(d.unit.condition)}</Field>
                <Field label="Unit status"><StatusBadge value={d.unit.status} /></Field>
              </dl>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => openUnitPage(d.unit!.id)}>Open unit {d.unit.unitNumber}</Button>
              </div>
            </SectionCard>
          )}
          <SectionCard title="Contractor">
            {d.contractor ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Name"><button type="button" className="hover:underline" onClick={() => openSupplier(d.contractor!.id)}>{d.contractor.name}</button></Field>
                <Field label="Category">{labelize(d.contractor.category)}</Field>
                <Field label="Phone">{d.contractor.phone || "—"}</Field>
                <Field label="Email">{d.contractor.email || "—"}</Field>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No contractor assigned — edit the project to pick one.</p>
            )}
            {r.notes && <p className="mt-3 whitespace-pre-line rounded-md bg-muted/50 p-3 text-sm">{r.notes}</p>}
          </SectionCard>
          <SectionCard title="Photos & documents" description={`${d.documents.length} on file`} flush>
            {d.documents.length > 0 && (
              <ul className="divide-y">
                {d.documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onPreview={setPreview} />
                ))}
              </ul>
            )}
            <div className={cn("px-4 py-3", d.documents.length > 0 && "border-t")}>
              <AttachmentUploader compact links={{ renovationId: r.id, propertyId: r.propertyId, unitId: r.unitId ?? undefined, supplierId: r.contractorSupplierId ?? undefined }} category="photo" label="Add before / after photos or quotes" />
            </div>
          </SectionCard>
          <SectionCard title="History">
            <Timeline events={timeline} limit={30} />
          </SectionCard>
        </div>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
