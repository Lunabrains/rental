import * as XLSX from "xlsx";

import { COLUMNS, IMPORT_ORDER, PAYMENTS_SHEET, README_SHEET, SHEET_NAMES, type ImportEntity } from "./template";
import type { ParsedSheet, ParsedWorkbook, RawRow } from "./types";

/** Header → template key: case/space/dash-insensitive, so "Unit Number" matches `unit_number`. */
function normaliseHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function sheetByName(wb: XLSX.WorkBook, wanted: string): XLSX.WorkSheet | null {
  const target = normaliseHeader(wanted);
  for (const name of wb.SheetNames) {
    if (normaliseHeader(name) === target) return wb.Sheets[name];
  }
  return null;
}

function isBlankRow(values: unknown[]): boolean {
  return values.every((v) => v === null || v === undefined || String(v).trim() === "");
}

function parseSheet(entity: ImportEntity, ws: XLSX.WorkSheet | null): ParsedSheet {
  if (!ws) return { present: false, headers: [], rows: [] };

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (aoa.length === 0) return { present: true, headers: [], rows: [] };

  const headerRow = aoa[0].map(normaliseHeader);
  const known = new Set(COLUMNS[entity].map((c) => c.key));
  const headers = headerRow.filter((h) => known.has(h));

  const rows: RawRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i];
    if (!line || isBlankRow(line)) continue;
    const values: Record<string, unknown> = {};
    headerRow.forEach((h, col) => {
      if (!known.has(h)) return;
      const v = line[col];
      values[h] = typeof v === "string" ? v.trim() : v;
    });
    rows.push({ entity, rowNumber: i + 1, values });
  }

  return { present: true, headers, rows };
}

export function parseWorkbook(buffer: ArrayBuffer, fileName: string): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheets = Object.fromEntries(
    IMPORT_ORDER.map((entity) => [entity, parseSheet(entity, sheetByName(wb, SHEET_NAMES[entity]))]),
  ) as Record<ImportEntity, ParsedSheet>;

  const recognised = new Set([...Object.values(SHEET_NAMES), PAYMENTS_SHEET, README_SHEET].map(normaliseHeader));
  const unknownSheets = wb.SheetNames.filter((n) => !recognised.has(normaliseHeader(n)));

  return {
    fileName,
    sheets,
    hasPaymentsSheet: sheetByName(wb, PAYMENTS_SHEET) !== null,
    unknownSheets,
  };
}
