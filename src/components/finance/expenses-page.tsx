"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CalendarPlus, Check, Paperclip, Pencil, Plus, Receipt, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { AttachmentUploader } from "@/components/common/attachment-uploader";
import { Chips } from "@/components/common/chips";
import { DataTable, type Column } from "@/components/common/data-table";
import { EnumSelect, PropertySelect, SupplierSelect } from "@/components/common/entity-select";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { ImportButton } from "@/components/import/import-button";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { DocumentPreview } from "@/components/documents/document-preview";
import { Button } from "@/components/ui/button";
import { deleteExpense, markExpensePaid, restoreExpense, scheduleNextOccurrence, updateExpense } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { addPeriods, currentPeriod, today } from "@/lib/date";
import { formatDate, formatMoney, formatMonth, formatPercent, labelize } from "@/lib/format";
import { getExpenseTrend, getExpenses, summarizeExpenses, type ExpenseRow } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ExpenseClassification, type ExpensePaymentStatus, type StoredDocument } from "@/types";

type Range = "month" | "last_month" | "quarter" | "year" | "all";
type StatusChip = "all" | ExpensePaymentStatus | "deleted";

function rangeOf(range: Range): { from?: string; to?: string; period?: string; label: string } {
  const period = currentPeriod();
  switch (range) {
    case "month":
      return { period, label: formatMonth(period) };
    case "last_month":
      return { period: addPeriods(period, -1), label: formatMonth(addPeriods(period, -1)) };
    case "quarter":
      return { from: `${addPeriods(period, -2)}-01`, to: today(), label: "Last 3 months" };
    case "year":
      return { period: period.slice(0, 4), label: period.slice(0, 4) };
    default:
      return { label: "All time" };
  }
}

/** Expense management (plan §Phase 5): the ledger of everything the buildings cost. */
export function ExpensesPage() {
  const { store, run } = useStoreContext();
  const { addExpense, editExpense } = useActions();
  const router = useRouter();
  const params = useSearchParams();
  const [preview, setPreview] = useState<StoredDocument | null>(null);

  const range = (params.get("range") as Range | null) ?? "month";
  const status = (params.get("status") as StatusChip | null) ?? "all";
  const propertyId = params.get("property");
  const supplierId = params.get("supplier");
  const category = params.get("category") as ExpenseCategory | null;
  const classification = params.get("type") as ExpenseClassification | null;

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "range" && v === "month")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/finance/expenses${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const r = rangeOf(range);
  const rows = useMemo(
    () =>
      getExpenses(store, {
        propertyId: propertyId ?? undefined,
        supplierId: supplierId ?? undefined,
        category: category ?? undefined,
        classification: classification ?? undefined,
        period: r.period,
        from: r.from,
        to: r.to,
        status: status === "all" || status === "deleted" ? undefined : status,
        includeDeleted: status === "deleted",
      }).filter((x) => (status === "deleted" ? x.expense.deleted : !x.expense.deleted)),
    [store, propertyId, supplierId, category, classification, r.period, r.from, r.to, status],
  );
  const summary = useMemo(() => summarizeExpenses(rows), [rows]);
  const trend = useMemo(() => getExpenseTrend(store, 6, propertyId ?? undefined), [store, propertyId]);
  const lastMonth = trend[trend.length - 2];
  const thisMonth = trend[trend.length - 1];

  const act = (fn: () => { undo: (() => void) | null }, message: string) => {
    try {
      const { undo } = fn();
      toast.success(message, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const columns: Column<ExpenseRow>[] = [
    { key: "date", header: "Date", cell: (x) => formatDate(x.expense.expenseDate), value: (x) => x.expense.expenseDate },
    { key: "description", header: "Description", cell: (x) => <span className="flex items-center gap-1.5"><span className="font-medium">{x.expense.description}</span>{x.expense.recurring && <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{labelize(x.expense.recurrence ?? "recurring")}</span>}</span>, value: (x) => x.expense.description },
    { key: "building", header: "Building · Unit", cell: (x) => <span className="text-muted-foreground">{x.property.name}{x.unit ? ` · ${x.unit.unitNumber}` : ""}</span>, value: (x) => `${x.property.name} ${x.unit?.unitNumber ?? ""}` },
    { key: "category", header: "Category", cell: (x) => labelize(x.expense.category), value: (x) => x.expense.category },
    { key: "supplier", header: "Supplier", cell: (x) => x.supplier?.name ?? <span className="text-muted-foreground">—</span>, value: (x) => x.supplier?.name ?? "" },
    { key: "type", header: "Type", cell: (x) => <StatusBadge value={x.expense.classification} />, value: (x) => x.expense.classification },
    { key: "amount", header: "Amount", align: "right", cell: (x) => <span className="font-medium">{formatMoney(x.expense.amount)}</span>, value: (x) => x.expense.amount },
    { key: "status", header: "Status", cell: (x) => <StatusBadge value={x.expense.paymentStatus} label={x.overdueDays > 0 ? `Unpaid · ${x.overdueDays}d late` : x.expense.paymentStatus === "paid" && x.expense.paidDate ? `Paid ${formatDate(x.expense.paidDate)}` : undefined} />, value: (x) => x.expense.paymentStatus },
    { key: "invoice", header: "Invoice", cell: (x) => (x.document ? <button type="button" className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={(e) => { e.stopPropagation(); setPreview(x.document); }}><Paperclip className="size-3" /> {x.expense.invoiceNumber ?? "file"}</button> : <span className="text-xs text-muted-foreground">{x.expense.invoiceNumber ?? "—"}</span>), value: (x) => x.expense.invoiceNumber },
    {
      key: "act",
      header: "",
      sortable: false,
      noExport: true,
      cell: (x) => (
        <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {x.expense.deleted ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => act(() => run(restoreExpense(x.expense.id)), "Expense restored")}>
              <RotateCcw className="size-3.5" /> Restore
            </Button>
          ) : (
            <>
              {x.expense.paymentStatus !== "paid" && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" title="Mark paid today" onClick={() => act(() => run(markExpensePaid(x.expense.id)), `Marked paid — ${x.expense.description}`)}>
                  <Check className="size-3.5" /> Paid
                </Button>
              )}
              {!x.document && (
                <AttachmentUploader compact links={{ expenseId: x.expense.id, propertyId: x.expense.propertyId, unitId: x.expense.unitId, supplierId: x.expense.supplierId }} category="invoice" label="" className="h-7 px-2 text-xs" onAdded={(doc) => run(updateExpense(x.expense.id, { documentId: doc.id }))} />
              )}
              {x.expense.recurring && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Schedule the next occurrence" onClick={() => act(() => run(scheduleNextOccurrence(x.expense.id)), "Next occurrence scheduled")}>
                  <CalendarPlus className="size-3.5" />
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" title="Edit" onClick={() => editExpense(x.expense.id)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-critical" title="Remove (kept in the audit log)" onClick={() => { if (window.confirm(`Remove "${x.expense.description}" (${formatMoney(x.expense.amount)})? It stays in the audit log and can be restored.`)) act(() => run(deleteExpense(x.expense.id)), "Expense removed"); }}>
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        description={`${r.label} · ${summary.count} expenses · ${formatMoney(summary.total)}`}
        actions={
          <>
            <ImportButton section="expenses" />
            <Button onClick={() => addExpense({ propertyId })}>
              <Plus className="size-4" /> Add expense
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Total · ${r.label}`} value={formatMoney(summary.total)} sublabel={`${formatMoney(summary.operating)} operating · ${formatMoney(summary.capex)} CapEx`} />
        <KpiCard label="Unpaid invoices" value={summary.unpaidCount} tone={summary.unpaidCount > 0 ? "warning" : "success"} sublabel={summary.unpaidCount > 0 ? `${formatMoney(summary.unpaid)} to pay` : "All settled"} />
        <KpiCard label="This month vs last" value={thisMonth ? formatMoney(thisMonth.operating) : "—"} sublabel={lastMonth && thisMonth ? `${thisMonth.operating >= lastMonth.operating ? "+" : "−"}${formatMoney(Math.abs(thisMonth.operating - lastMonth.operating))} vs ${formatMoney(lastMonth.operating)} operating` : undefined} tone={lastMonth && thisMonth && thisMonth.operating > lastMonth.operating * 1.2 ? "warning" : "default"} />
        <KpiCard label="Largest category" value={summary.byCategory[0] ? labelize(summary.byCategory[0].category) : "—"} sublabel={summary.byCategory[0] ? `${formatMoney(summary.byCategory[0].amount)} · ${formatPercent(summary.byCategory[0].share)} of the total` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Chips<Range> aria-label="Period" value={range} onChange={(v) => setParams({ range: v })} options={[{ value: "month", label: "This month" }, { value: "last_month", label: "Last month" }, { value: "quarter", label: "3 months" }, { value: "year", label: "This year" }, { value: "all", label: "All" }]} />
        <Chips<StatusChip> aria-label="Status" value={status} onChange={(v) => setParams({ status: v })} options={[{ value: "all", label: "All" }, { value: "unpaid", label: "Unpaid" }, { value: "scheduled", label: "Scheduled" }, { value: "paid", label: "Paid" }, { value: "deleted", label: "Removed" }]} />
        <div className="w-44">
          <EnumSelect values={EXPENSE_CATEGORIES} value={category} onChange={(v) => setParams({ category: v })} allowAll allLabel="All categories" />
        </div>
        <div className="w-36">
          <EnumSelect values={["operating", "capex"] as const} value={classification} onChange={(v) => setParams({ type: v })} allowAll allLabel="Operating + CapEx" labels={{ capex: "CapEx" }} />
        </div>
        <div className="w-44">
          <SupplierSelect value={supplierId} onChange={(id) => setParams({ supplier: id })} allowAll />
        </div>
        <div className="ml-auto w-48">
          <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(x) => x.expense.id}
          onRowClick={(x) => !x.expense.deleted && editExpense(x.expense.id)}
          rowClassName={(x) => cn(x.expense.deleted && "opacity-60", x.overdueDays > 0 && "bg-warning-muted/30")}
          searchable={(x) => `${x.expense.description} ${x.property.name} ${x.supplier?.name ?? ""} ${x.expense.invoiceNumber ?? ""} ${x.expense.category}`}
          searchPlaceholder="Description, supplier, invoice…"
          exportName="expenses"
          pageSize={100}
          dense
          emptyTitle="No expenses match"
          emptyIcon={Receipt}
          totals={(list) => ["", `${list.length} expenses`, "", "", "", "", formatMoney(list.reduce((n, x) => n + x.expense.amount, 0)), "", "", ""]}
        />
        <div className="space-y-4">
          <SectionCard title="By category" description={r.label}>
            {summary.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in this period.</p>
            ) : (
              <ul className="space-y-2">
                {summary.byCategory.slice(0, 8).map((c) => (
                  <li key={c.category} className="cursor-pointer text-sm" onClick={() => setParams({ category: category === c.category ? null : c.category })}>
                    <div className="flex items-center justify-between">
                      <span className={cn(category === c.category && "font-medium")}>{labelize(c.category)}</span>
                      <span className="tabular text-muted-foreground">{formatMoney(c.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-chart-4" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="By supplier" description={r.label}>
            {summary.bySupplier.length === 0 ? (
              <p className="text-sm text-muted-foreground">No supplier-linked expenses.</p>
            ) : (
              <ul className="divide-y">
                {summary.bySupplier.slice(0, 6).map((s) => (
                  <li key={s.supplier.id} className="flex cursor-pointer items-center justify-between py-1.5 text-sm" onClick={() => setParams({ supplier: supplierId === s.supplier.id ? null : s.supplier.id })}>
                    <span className={cn("truncate", supplierId === s.supplier.id && "font-medium")}>{s.supplier.name}</span>
                    <span className="tabular text-muted-foreground">{formatMoney(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
