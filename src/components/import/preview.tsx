"use client";

import { useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";

import { NeutralPill } from "@/components/common/badges";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IMPORT_ORDER, SHEET_NAMES, type ImportEntity } from "@/lib/import/template";
import type { ImportPlan, PlannedRow, RowAction } from "@/lib/import/types";
import { cn } from "@/lib/utils";

const ACTION_STYLE: Record<RowAction, string> = {
  create: "bg-success-muted text-success border-success/20",
  update: "bg-info-muted text-info border-info/20",
  skip: "bg-critical-muted text-critical border-critical/20",
};

export function PlanSummary({ plan }: { plan: ImportPlan }) {
  const parts = IMPORT_ORDER.filter((e) => plan.rows[e].length > 0).map((e) => {
    const c = plan.counts[e];
    const bits = [c.create > 0 && `${c.create} new`, c.update > 0 && `${c.update} updated`, c.skip > 0 && `${c.skip} skipped`].filter(Boolean);
    return `${SHEET_NAMES[e]}: ${bits.join(", ")}`;
  });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
      {plan.warningCount > 0 && (
        <span className="inline-flex items-center gap-1 text-warning-foreground">
          <AlertTriangle className="size-3.5" /> {plan.warningCount} warning{plan.warningCount === 1 ? "" : "s"}
        </span>
      )}
      {plan.errorCount > 0 && (
        <span className="inline-flex items-center gap-1 text-critical">
          <XCircle className="size-3.5" /> {plan.errorCount} error{plan.errorCount === 1 ? "" : "s"} — those rows will be skipped
        </span>
      )}
    </div>
  );
}

export function PlanPreview({ plan }: { plan: ImportPlan }) {
  const entities = IMPORT_ORDER.filter((e) => plan.rows[e].length > 0);
  const [tab, setTab] = useState<ImportEntity>(entities[0] ?? "properties");
  if (entities.length === 0) return null;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as ImportEntity)}>
      <TabsList>
        {entities.map((e) => (
          <TabsTrigger key={e} value={e} className="gap-1.5">
            {SHEET_NAMES[e]}
            <span className="tabular text-xs text-muted-foreground">{plan.rows[e].length}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {entities.map((e) => (
        <TabsContent key={e} value={e} className="mt-3">
          <RowTable rows={plan.rows[e]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function RowTable({ rows }: { rows: PlannedRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const problem = rows.filter((r) => r.issues.length > 0);
  const visible = showAll || problem.length === 0 ? rows : problem;
  const MAX = 60;

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {problem.length > 0 && !showAll ? `${problem.length} row${problem.length === 1 ? "" : "s"} with warnings or errors` : `${rows.length} rows`}
        </span>
        {problem.length > 0 && problem.length < rows.length && (
          <button type="button" className="font-medium text-foreground hover:underline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show only rows with issues" : "Show all rows"}
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Record</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, MAX).map((r) => (
              <tr key={`${r.entity}-${r.rowNumber}`} className="border-b last:border-0">
                <td className="tabular px-3 py-2 text-muted-foreground">{r.rowNumber}</td>
                <td className="px-3 py-2 font-medium">{r.label || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-2">
                  <NeutralPill className={cn(ACTION_STYLE[r.action])}>{r.action}</NeutralPill>
                </td>
                <td className="px-3 py-2">
                  {r.issues.length === 0 ? (
                    <span className="text-xs text-muted-foreground">OK</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {r.issues.map((i, n) => (
                        <li key={n} className={cn("flex items-start gap-1.5 text-xs", i.level === "error" ? "text-critical" : "text-warning-foreground")}>
                          {i.level === "error" ? <XCircle className="mt-0.5 size-3 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
                          <span>{i.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
            {visible.length > MAX && (
              <tr>
                <td colSpan={4} className="px-3 py-2 text-center text-xs text-muted-foreground">
                  … and {visible.length - MAX} more rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
