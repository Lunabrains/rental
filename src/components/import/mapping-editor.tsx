"use client";

import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react";

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IMPORT_ORDER, SHEET_NAMES, type ImportEntity } from "@/lib/import/template";
import { mappingIssues, remapSheet, targetsFor, type SheetMapping, type WorkbookScan } from "@/lib/import/mapping";
import { cn } from "@/lib/utils";

const SKIP = "__skip__";
const IGNORE = "__ignore__";

function sampleOf(rows: unknown[][], index: number): string {
  const seen: string[] = [];
  for (const r of rows) {
    const v = r[index];
    if (v === null || v === undefined || String(v).trim() === "") continue;
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (!seen.includes(s)) seen.push(s.length > 28 ? `${s.slice(0, 27)}…` : s);
    if (seen.length === 2) break;
  }
  return seen.join(" · ");
}

/**
 * One card per tab: what it contains and which system field each column
 * feeds. Auto-detected choices are shown; anything can be changed.
 */
export function MappingEditor({ scan, mappings, onChange }: { scan: WorkbookScan; mappings: SheetMapping[]; onChange: (next: SheetMapping[]) => void }) {
  const issues = mappingIssues(mappings);

  function update(i: number, next: SheetMapping) {
    onChange(mappings.map((m, j) => (j === i ? next : m)));
  }

  return (
    <div className="space-y-4">
      {mappings.map((m, i) => {
        const sheet = scan.sheets.find((s) => s.name === m.sheet);
        if (!sheet) return null;
        const mine = issues.filter((x) => x.sheet === m.sheet);
        const errors = mine.filter((x) => x.level === "error");
        const targets = m.entity ? targetsFor(m.entity) : [];
        const used = new Set(m.columns.map((c) => c.target).filter(Boolean));
        return (
          <div key={m.sheet} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{m.sheet}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {sheet.rows.length} rows · {sheet.headers.length} columns
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  {m.detected === "preset" && (
                    <>
                      <Sparkles className="size-3" /> Mapped the way you did last time
                    </>
                  )}
                  {m.detected === "name" && "Recognised from the tab name"}
                  {m.detected === "headers" && "Guessed from the column headers — check it"}
                  {m.detected === "manual" && "Set by you"}
                  {m.detected === "none" && !m.entity && "Not recognised — pick what this tab contains, or skip it"}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Contains</span>
                <Select value={m.entity ?? SKIP} onValueChange={(v) => update(i, remapSheet(sheet, m, v === SKIP ? null : (v as ImportEntity)))}>
                  <SelectTrigger size="sm" className="w-44 bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SKIP}>Skip this tab</SelectItem>
                    <SelectSeparator />
                    {IMPORT_ORDER.map((e) => (
                      <SelectItem key={e} value={e}>
                        {SHEET_NAMES[e]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <span className={cn("inline-flex items-center gap-1 text-xs", errors.length > 0 ? "text-critical" : m.entity ? "text-success" : "text-muted-foreground")}>
                {errors.length > 0 ? <XCircle className="size-3.5" /> : m.entity ? <CheckCircle2 className="size-3.5" /> : null}
                {errors.length > 0 ? `${errors.length} to fix` : m.entity ? "Ready" : "Skipped"}
              </span>
            </div>

            {m.entity && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-1.5 text-start font-medium">Column in file</th>
                      <th className="px-3 py-1.5 text-start font-medium">Sample values</th>
                      <th className="px-3 py-1.5 text-start font-medium">Goes to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.columns.map((c) => (
                      <tr key={c.index} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-medium" dir="auto">
                          {c.header}
                        </td>
                        <td className="max-w-[16rem] truncate px-3 py-1.5 text-muted-foreground" dir="auto">
                          {sampleOf(sheet.rows, c.index) || <span className="italic">empty</span>}
                        </td>
                        <td className="px-3 py-1">
                          <Select value={c.target ?? IGNORE} onValueChange={(v) => update(i, { ...m, detected: "manual", columns: m.columns.map((x) => (x.index === c.index ? { ...x, target: v === IGNORE ? null : v } : x)) })}>
                            <SelectTrigger size="sm" className={cn("w-56 bg-card", !c.target && "text-muted-foreground")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={IGNORE}>Ignore this column</SelectItem>
                              <SelectGroup>
                                <SelectLabel>Fields</SelectLabel>
                                {targets.filter((t) => !t.virtual).map((t) => (
                                  <SelectItem key={t.key} value={t.key} disabled={used.has(t.key) && c.target !== t.key}>
                                    {t.key}
                                    {t.required && <span className="ms-1 text-[10px] uppercase text-muted-foreground">required</span>}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              {targets.some((t) => t.virtual) && (
                                <SelectGroup>
                                  <SelectLabel>Derived from</SelectLabel>
                                  {targets.filter((t) => t.virtual).map((t) => (
                                    <SelectItem key={t.key} value={t.key} disabled={used.has(t.key) && c.target !== t.key}>
                                      {t.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mine.length > 0 && (
              <ul className="space-y-1 border-t px-3 py-2 text-xs">
                {mine.map((x, j) => (
                  <li key={j} className={cn("flex items-start gap-1.5", x.level === "error" ? "text-critical" : "text-warning-foreground")}>
                    {x.level === "error" ? <XCircle className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    {x.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
