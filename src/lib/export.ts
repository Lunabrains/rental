import * as XLSX from "xlsx";

import { downloadArrayBuffer } from "@/lib/import";

/**
 * Export helpers — every table in the app can leave as CSV or Excel. Values
 * are plain strings / numbers so the files open cleanly in any spreadsheet.
 */

export type ExportCell = string | number | null | undefined;

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: ExportCell[][];
}

function csvEscape(v: ExportCell): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: ExportCell[][]): string {
  return [columns.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(fileName: string, columns: string[], rows: ExportCell[][]): void {
  download(new Blob(["﻿" + toCsv(columns, rows)], { type: "text/csv;charset=utf-8" }), fileName.endsWith(".csv") ? fileName : `${fileName}.csv`);
}

export function exportXlsx(fileName: string, sheets: ExportSheet[]): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows.map((r) => r.map((c) => c ?? ""))]);
    ws["!cols"] = sheet.columns.map((c, i) => ({ wch: Math.min(48, Math.max(c.length + 2, ...sheet.rows.slice(0, 200).map((r) => String(r[i] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  downloadArrayBuffer(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

/** Print-to-PDF: opens the current view in a print dialog with the app chrome hidden. */
export function printView(): void {
  window.print();
}

export function stampedName(base: string, date: string): string {
  return `${base}-${date}`;
}
