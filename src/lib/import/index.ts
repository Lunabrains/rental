export { parseWorkbook } from "./parse";
export { planImport } from "./validate";
export { applyImport, summarize } from "./apply";
export { scanWorkbook, suggestMappings, remapSheet, autoMapColumns, targetsFor, mappingIssues, buildParsedWorkbook, rememberMappings, forgetPresets, isTemplateShaped, detectEntity, VIRTUAL_KEYS, type WorkbookScan, type SheetScan, type SheetMapping, type ColumnMap, type MappingIssue, type BuildResult } from "./mapping";
export {
  buildTemplateWorkbook,
  buildWorkbook,
  workbookToArrayBuffer,
  COLUMNS,
  IMPORT_ORDER,
  SHEET_NAMES,
  type ImportEntity,
  type ColumnSpec,
} from "./template";
export type * from "./types";

/** Browser-only: trigger a download of an xlsx ArrayBuffer. */
export function downloadArrayBuffer(buffer: ArrayBuffer, fileName: string): void {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
