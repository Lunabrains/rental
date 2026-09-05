"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ChevronRight, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { toast } from "sonner";

import { Chips } from "@/components/common/chips";
import { PropertySelect } from "@/components/common/entity-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/data/store-context";
import { currentPeriod, today } from "@/lib/date";
import { exportCsv, exportXlsx, printView, stampedName, type ExportCell } from "@/lib/export";
import { formatDate, formatMoney } from "@/lib/format";
import { buildAllReports, buildReport, REPORT_KEYS, REPORT_META, type ReportKey } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Horizon = "30" | "60" | "90" | "180";

/** Reports (plan §Phase 17): every table the owner may need on paper or in a spreadsheet, filtered, totalled and exportable. */
export function ReportsPage() {
  const store = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const key = (REPORT_KEYS.includes(params.get("report") as ReportKey) ? params.get("report") : "rent_roll") as ReportKey;
  const propertyId = params.get("property");
  const month = params.get("month") ?? currentPeriod();
  const year = params.get("year") ?? today().slice(0, 4);
  const days = (params.get("days") as Horizon | null) ?? "90";
  const meta = REPORT_META[key];

  function setParams(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "all" || (k === "report" && v === "rent_roll") || (k === "month" && v === currentPeriod()) || (k === "year" && v === today().slice(0, 4)) || (k === "days" && v === "90")) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/reports${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }

  const opts = useMemo(() => ({ propertyId: propertyId ?? undefined, period: meta.period === "month" ? month : meta.period === "year" ? year : undefined, days: Number(days) }), [propertyId, meta.period, month, year, days]);
  const report = useMemo(() => buildReport(store, key, opts), [store, key, opts]);
  const stamp = `${key.replace(/_/g, "-")}${propertyId ? `-${propertyId}` : ""}${meta.period === "month" ? `-${month}` : meta.period === "year" ? `-${year}` : ""}`;
  const scopeLabel = propertyId ? store.properties.find((p) => p.id === propertyId)?.name ?? "" : "All buildings";

  function csv() {
    exportCsv(stampedName(stamp, today()), report.columns, report.rows);
  }
  function xlsx() {
    exportXlsx(stampedName(stamp, today()), [{ name: report.title, columns: report.columns, rows: report.totals ? [...report.rows, report.totals] : report.rows }]);
  }
  function workbook() {
    const all = buildAllReports(store, opts);
    exportXlsx(stampedName(`portfolio-reports${propertyId ? `-${propertyId}` : ""}`, today()), all.map((r) => ({ name: r.title, columns: r.columns, rows: r.totals ? [...r.rows, r.totals] : r.rows })));
    toast.success(`Workbook exported — ${all.length} sheets`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description={`${scopeLabel} · as of ${formatDate(today())} · CSV and Excel exports, or print to PDF`}
        actions={
          <Button variant="outline" onClick={workbook}>
            <FileSpreadsheet className="size-4" /> Export everything (Excel)
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)] print:block">
        <nav className="space-y-1 print:hidden" aria-label="Reports">
          {REPORT_KEYS.map((k) => (
            <button key={k} type="button" onClick={() => setParams({ report: k })} className={cn("flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60", k === key && "bg-accent font-medium")} aria-current={k === key ? "page" : undefined}>
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block">{REPORT_META[k].title}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{REPORT_META[k].description}</span>
              </span>
              {k === key && <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </nav>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="w-48">
              <PropertySelect value={propertyId} onChange={(id) => setParams({ property: id })} allowAll />
            </div>
            {meta.period === "month" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Month <Input type="month" value={month} onChange={(e) => setParams({ month: e.target.value || null })} className="h-9 w-40" />
              </label>
            )}
            {meta.period === "year" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Year <Input type="number" min={2000} max={2100} value={year} onChange={(e) => setParams({ year: e.target.value || null })} className="h-9 w-24 tabular" />
              </label>
            )}
            {meta.period === "days" && <Chips<Horizon> aria-label="Horizon" value={days} onChange={(v) => setParams({ days: v })} options={[{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }]} />}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={csv} disabled={report.rows.length === 0}><Download className="size-4" /> CSV</Button>
              <Button variant="outline" size="sm" onClick={xlsx} disabled={report.rows.length === 0}><FileSpreadsheet className="size-4" /> Excel</Button>
              <Button variant="outline" size="sm" onClick={() => printView()}><Printer className="size-4" /> Print / PDF</Button>
            </div>
          </div>
          <SectionCard title={report.title} description={`${report.description} · ${report.rows.length} row${report.rows.length === 1 ? "" : "s"}${meta.period === "month" ? ` · ${month}` : meta.period === "year" ? ` · ${year}` : meta.period === "days" ? ` · next ${days} days` : ""}`} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {report.columns.map((c, i) => (
                      <th key={c} className={cn("px-3 py-2 font-medium", report.moneyColumns.includes(i) || typeof report.rows[0]?.[i] === "number" ? "text-right" : "text-left")}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y tabular">
                  {report.rows.length === 0 && (
                    <tr>
                      <td colSpan={report.columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing to report for these filters.</td>
                    </tr>
                  )}
                  {report.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-accent/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className={cn("px-3 py-1.5 whitespace-nowrap", (report.moneyColumns.includes(ci) || typeof cell === "number") && "text-right")}>{format(cell, report.moneyColumns.includes(ci))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {report.totals && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      {report.totals.map((cell, ci) => (
                        <td key={ci} className={cn("px-3 py-2 whitespace-nowrap", (report.moneyColumns.includes(ci) || typeof cell === "number") && "text-right")}>{format(cell, report.moneyColumns.includes(ci))}</td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function format(cell: ExportCell, money: boolean): string {
  if (cell === null || cell === undefined || cell === "") return "—";
  if (typeof cell === "number") return money ? formatMoney(cell) : String(cell);
  return String(cell);
}
