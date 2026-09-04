export { parseWorkbook } from "./parse";
export { planImport } from "./validate";
export { applyImport, summarize } from "./apply";
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
