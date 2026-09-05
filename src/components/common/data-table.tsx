"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Inbox, Search, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { exportCsv, exportXlsx, type ExportCell } from "@/lib/export";
import { today } from "@/lib/date";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting and export; defaults to the cell's text. */
  value?: (row: T) => string | number | null;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  /** Hide from export. */
  noExport?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Client-side search over these fields. */
  searchable?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** File name (without extension) enables the export buttons. */
  exportName?: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  dense?: boolean;
  className?: string;
  /** Aggregate row rendered at the bottom (e.g. totals). */
  totals?: (rows: T[]) => ReactNode[];
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return textOf(props?.children);
  }
  return "";
}

function valueOf<T>(col: Column<T>, row: T): string | number | null {
  return col.value ? col.value(row) : textOf(col.cell(row));
}

/**
 * The table used by every list screen: sortable columns, search, paging,
 * CSV / Excel export and consistent empty states. Rows stay plain data —
 * callers decide what a row is and how each cell renders.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowClassName,
  searchable,
  searchPlaceholder = "Search…",
  pageSize = 50,
  emptyTitle = "Nothing here",
  emptyDescription,
  emptyIcon = Inbox,
  defaultSort,
  exportName,
  toolbar,
  footer,
  dense,
  className,
  totals,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const [limit, setLimit] = useState(pageSize);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q && searchable ? rows.filter((r) => searchable(r).toLowerCase().includes(q)) : rows.slice();
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        list = list.slice().sort((a, b) => {
          const va = valueOf(col, a);
          const vb = valueOf(col, b);
          if (va === null || va === undefined || va === "") return 1;
          if (vb === null || vb === undefined || vb === "") return -1;
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
          return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
        });
      }
    }
    return list;
  }, [rows, query, sort, columns, searchable]);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));
  };

  const doExport = (kind: "csv" | "xlsx") => {
    const cols = columns.filter((c) => !c.noExport);
    const headers = cols.map((c) => textOf(c.header));
    const data: ExportCell[][] = visible.map((r) => cols.map((c) => valueOf(c, r)));
    const name = `${exportName ?? "export"}-${today()}`;
    if (kind === "csv") exportCsv(name, headers, data);
    else exportXlsx(name, [{ name: exportName ?? "Export", columns: headers, rows: data }]);
  };

  const shown = visible.slice(0, limit);
  const showToolbar = searchable || exportName || toolbar;

  return (
    <div className={cn("space-y-3", className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {searchable && (
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(pageSize);
                }}
                placeholder={searchPlaceholder}
                aria-label="Search table"
                className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
              />
            </div>
          )}
          {exportName && (
            <div className={cn("flex items-center gap-1", !searchable && "ml-auto")}>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => doExport("csv")} aria-label="Export CSV">
                <Download className="size-3.5" /> CSV
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => doExport("xlsx")} aria-label="Export Excel">
                <Download className="size-3.5" /> Excel
              </Button>
            </div>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={emptyIcon} title={query ? "No rows match your search" : emptyTitle} description={query ? undefined : emptyDescription} compact={dense} />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {columns.map((c) => {
                    const active = sort?.key === c.key;
                    const sortable = c.sortable !== false;
                    return (
                      <th
                        key={c.key}
                        style={c.width ? { width: c.width } : undefined}
                        className={cn("px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.align === "center" && "text-center", c.headerClassName)}
                      >
                        {sortable ? (
                          <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
                            {c.header}
                            {active ? sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="tabular">
                {shown.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className={cn("border-t transition-colors", onRowClick && "cursor-pointer hover:bg-accent/60", rowClassName?.(r))}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-4 align-middle", dense ? "py-1.5" : "py-2.5", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="tabular border-t bg-muted/30 text-xs font-medium">
                  <tr>
                    {totals(visible).map((cell, i) => (
                      <td key={i} className={cn("px-4 py-2", columns[i]?.align === "right" && "text-right")}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(visible.length > limit || footer) && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>{visible.length > limit ? `Showing ${limit} of ${visible.length}` : footer}</span>
              {visible.length > limit && (
                <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + pageSize)}>
                  Show more
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
