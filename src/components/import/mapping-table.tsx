import { Check, Minus } from "lucide-react";

import { COLUMNS, IMPORT_ORDER, SHEET_NAMES, type ImportEntity } from "@/lib/import/template";
import type { ParsedWorkbook } from "@/lib/import/types";
import { cn } from "@/lib/utils";

/**
 * Read-only column mapping. v1 assumes template headers; the table exists so
 * the UI is ready for AI-assisted mapping of arbitrary sheets later.
 */
export function MappingTable({ parsed }: { parsed: ParsedWorkbook }) {
  const present = IMPORT_ORDER.filter((e) => parsed.sheets[e].present);
  if (present.length === 0) {
    return <p className="text-sm text-muted-foreground">No recognised tabs found. Expected: {Object.values(SHEET_NAMES).join(", ")}.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {present.map((entity) => (
        <EntityMapping key={entity} entity={entity} headers={parsed.sheets[entity].headers} rowCount={parsed.sheets[entity].rows.length} />
      ))}
    </div>
  );
}

function EntityMapping({ entity, headers, rowCount }: { entity: ImportEntity; headers: string[]; rowCount: number }) {
  const found = new Set(headers);
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">{SHEET_NAMES[entity]}</span>
        <span className="text-xs text-muted-foreground">{rowCount} rows</span>
      </div>
      <ul className="divide-y">
        {COLUMNS[entity].map((c) => {
          const ok = found.has(c.key);
          return (
            <li key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className={cn("flex size-4 items-center justify-center rounded-full", ok ? "bg-success-muted text-success" : c.required ? "bg-critical-muted text-critical" : "bg-muted text-muted-foreground")}>
                {ok ? <Check className="size-3" /> : <Minus className="size-3" />}
              </span>
              <code className="font-mono text-[11px]">{c.key}</code>
              {c.required && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">required</span>}
              <span className="ml-auto text-muted-foreground">{ok ? `→ ${c.key}` : "not in file"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
