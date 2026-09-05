"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Field, FlowDialog, MoneyInput } from "@/components/flows/flow-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteBudget, setBudget } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { budgetActual, budgetVariance } from "@/lib/derived/metrics";
import { currentPeriod } from "@/lib/date";
import { formatMoney, formatMonth, formatPercent, labelize } from "@/lib/format";
import { getBudgets, type BudgetRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/types";

type PeriodType = "month" | "year";

/**
 * Budget vs actual (plan §Phase 6): monthly or yearly budgets per building and
 * expense category, with the variance and over-budget flags the alert engine
 * uses.
 */
export function BudgetsPage() {
  const { store, run } = useStoreContext();
  const router = useRouter();
  const params = useSearchParams();
  const periodType = (params.get("type") as PeriodType | null) ?? "year";
  const year = currentPeriod().slice(0, 4);
  const period = params.get("period") ?? (periodType === "year" ? year : currentPeriod());
  const propertyId = params.get("property");
  const [editing, setEditing] = useState<{ budgetId?: string; category?: ExpenseCategory } | null>(null);

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all") sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/budgets${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const rows = useMemo(() => getBudgets(store, { propertyId: propertyId ?? undefined, period, periodType }), [store, propertyId, period, periodType]);
  const totals = useMemo(() => {
    const budget = rows.reduce((n, r) => n + r.budget.amount, 0);
    const actual = rows.reduce((n, r) => n + r.actual, 0);
    return { budget, actual, variance: budgetVariance(budget, actual, store.settings.thresholds.budgetOverPct), over: rows.filter((r) => r.variance.over).length };
  }, [rows, store.settings.thresholds.budgetOverPct]);

  // Categories with spend but no budget line — worth budgeting.
  const unbudgeted = useMemo(() => {
    if (!propertyId) return [];
    const have = new Set(rows.map((r) => r.budget.category));
    return EXPENSE_CATEGORIES.filter((c) => !have.has(c))
      .map((category) => ({ category, actual: budgetActual(store.expenses, { id: "", propertyId, periodType, period, category, amount: 0, notes: null }) }))
      .filter((x) => x.actual > 0)
      .sort((a, b) => b.actual - a.actual);
  }, [rows, store.expenses, propertyId, period, periodType]);

  const columns: Column<BudgetRow>[] = [
    { key: "building", header: "Building", cell: (r) => r.property.name, value: (r) => r.property.name },
    { key: "category", header: "Category", cell: (r) => <span className="font-medium">{labelize(r.budget.category)}</span>, value: (r) => r.budget.category },
    { key: "budget", header: "Budget", align: "right", cell: (r) => formatMoney(r.budget.amount), value: (r) => r.budget.amount },
    { key: "actual", header: "Actual", align: "right", cell: (r) => formatMoney(r.actual), value: (r) => r.actual },
    { key: "variance", header: "Difference", align: "right", cell: (r) => <span className={cn(r.variance.over ? "font-medium text-critical" : r.variance.variance > 0 ? "text-warning-foreground" : "text-success")}>{r.variance.variance > 0 ? "+" : ""}{formatMoney(r.variance.variance)}</span>, value: (r) => r.variance.variance },
    { key: "pct", header: "Variance %", align: "right", cell: (r) => (r.variance.variancePct === null ? "—" : `${r.variance.variancePct > 0 ? "+" : ""}${formatPercent(r.variance.variancePct)}`), value: (r) => r.variance.variancePct },
    { key: "used", header: "Used", cell: (r) => <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", r.variance.over ? "bg-critical" : r.actual / Math.max(1, r.budget.amount) > 0.85 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, (r.actual / Math.max(1, r.budget.amount)) * 100)}%` }} /></div>, value: (r) => r.actual / Math.max(1, r.budget.amount) },
    { key: "flag", header: "", sortable: false, noExport: true, cell: (r) => (r.variance.over ? <StatusBadge value="over" label="Over budget" tone="critical" /> : r.actual > r.budget.amount * 0.85 ? <StatusBadge value="near" label="Near limit" tone="warning" /> : <StatusBadge value="ok" label="On track" tone="success" />) },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (r) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing({ budgetId: r.budget.id })}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-critical" onClick={() => { if (window.confirm(`Remove the ${labelize(r.budget.category)} budget for ${r.budget.period}?`)) { const { undo } = run(deleteBudget(r.budget.id)); toast.success("Budget removed", { action: undo ? { label: "Undo", onClick: undo } : undefined }); } }}>
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Budgets"
        description={`${periodType === "year" ? period : formatMonth(period)} · ${rows.length} budget lines${totals.over > 0 ? ` · ${totals.over} over budget` : ""}`}
        actions={
          <Button onClick={() => setEditing({})} disabled={!propertyId && store.properties.length === 0}>
            <Plus className="size-4" /> Set budget
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Budgeted" value={formatMoney(totals.budget)} sublabel={`${rows.length} lines`} />
        <KpiCard label="Actual" value={formatMoney(totals.actual)} sublabel={totals.budget > 0 ? `${formatPercent(totals.actual / totals.budget)} of budget used` : "No budget set"} />
        <KpiCard label="Difference" value={`${totals.variance.variance > 0 ? "+" : ""}${formatMoney(totals.variance.variance)}`} tone={totals.variance.over ? "critical" : totals.variance.variance > 0 ? "warning" : "success"} sublabel={totals.variance.variancePct === null ? "—" : `${totals.variance.variancePct > 0 ? "+" : ""}${formatPercent(totals.variance.variancePct)}`} />
        <KpiCard label="Over budget" value={totals.over} tone={totals.over > 0 ? "critical" : "success"} sublabel={`Flagged above ${formatPercent(store.settings.thresholds.budgetOverPct)} over`} icon={Target} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Chips<PeriodType> aria-label="Budget period" value={periodType} onChange={(v) => setParams({ type: v, period: v === "year" ? year : currentPeriod() })} options={[{ value: "year", label: "Yearly" }, { value: "month", label: "Monthly" }]} />
        <Input type={periodType === "year" ? "number" : "month"} value={period} onChange={(e) => setParams({ period: e.target.value })} className="w-36" aria-label="Period" />
        <div className="ml-auto w-52">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <DataTable rows={rows} columns={columns} rowKey={(r) => r.budget.id} dense exportName={`budgets-${period}`} defaultSort={{ key: "variance", dir: "desc" }} emptyTitle="No budget lines for this period" emptyDescription="Set a budget per building and category to track variance and get over-budget alerts." emptyIcon={Target} rowClassName={(r) => (r.variance.over ? "bg-critical-muted/20" : undefined)} />

      {unbudgeted.length > 0 && (
        <div className="rounded-lg border border-dashed p-4">
          <p className="text-sm font-medium">Spend without a budget line</p>
          <p className="text-xs text-muted-foreground">These categories have expenses in {periodType === "year" ? period : formatMonth(period)} but no budget — click to add one.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unbudgeted.map((u) => (
              <Button key={u.category} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditing({ category: u.category })}>
                {labelize(u.category)} · {formatMoney(u.actual)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {editing && <BudgetDialog budgetId={editing.budgetId} defaults={{ propertyId: propertyId ?? store.properties[0]?.id ?? null, periodType, period, category: editing.category ?? "maintenance" }} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BudgetDialog({ budgetId, defaults, onClose }: { budgetId?: string; defaults: { propertyId: string | null; periodType: PeriodType; period: string; category: ExpenseCategory }; onClose: () => void }) {
  const { store, run } = useStoreContext();
  const existing = budgetId ? store.budgets.find((b) => b.id === budgetId) ?? null : null;
  const [propertyId, setPropertyId] = useState<string | null>(existing?.propertyId ?? defaults.propertyId);
  const [periodType, setPeriodType] = useState<PeriodType>(existing?.periodType ?? defaults.periodType);
  const [period, setPeriod] = useState(existing?.period ?? defaults.period);
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? defaults.category);
  const [amount, setAmount] = useState(existing?.amount ?? 0);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const actual = propertyId ? budgetActual(store.expenses, { id: "", propertyId, periodType, period, category, amount: 0, notes: null }) : 0;
  const valid = propertyId !== null && amount >= 0 && /^\d{4}(-\d{2})?$/.test(period);

  function submit() {
    if (!valid || !propertyId) return;
    try {
      const { result, undo } = run(setBudget({ propertyId, periodType, period, category, amount, notes }));
      toast.success(`Budget ${existing ? "updated" : "set"} — ${labelize(result.category)} ${formatMoney(result.amount)}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the budget");
    }
  }

  return (
    <FlowDialog open onOpenChange={(o) => !o && onClose()} title={existing ? "Edit budget" : "Set budget"} description="One line per building, category and period" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={!valid}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Building" htmlFor="bd-property">
          <PropertySelect id="bd-property" value={propertyId} onChange={setPropertyId} disabled={!!existing} />
        </Field>
        <Field label="Category" htmlFor="bd-category">
          <EnumSelect id="bd-category" values={EXPENSE_CATEGORIES} value={category} onChange={(v) => v && setCategory(v)} disabled={!!existing} />
        </Field>
        <Field label="Period type">
          <Chips<PeriodType> value={periodType} onChange={(v) => { setPeriodType(v); setPeriod(v === "year" ? period.slice(0, 4) : `${period.slice(0, 4)}-${currentPeriod().slice(5)}`); }} options={[{ value: "year", label: "Yearly" }, { value: "month", label: "Monthly" }]} />
        </Field>
        <Field label="Period" htmlFor="bd-period">
          <Input id="bd-period" type={periodType === "year" ? "number" : "month"} value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!!existing} />
        </Field>
        <Field label="Budget amount" htmlFor="bd-amount" hint={`Actual so far: ${formatMoney(actual)}`}>
          <MoneyInput id="bd-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Notes" htmlFor="bd-notes">
          <Input id="bd-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </FlowDialog>
  );
}
