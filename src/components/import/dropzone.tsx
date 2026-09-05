"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}

const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function Dropzone({ onFile, disabled, busy, className }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      onFile(file);
    },
    [onFile],
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none",
        over ? "border-brand bg-brand-muted/60" : "border-border bg-muted/30 hover:bg-muted/60",
        disabled && "cursor-not-allowed opacity-60",
        "focus-visible:ring-[3px] focus-visible:ring-ring/30",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <span className={cn("flex size-11 items-center justify-center rounded-full", over ? "bg-brand text-brand-foreground" : "bg-card text-muted-foreground shadow-xs")}>
        {busy ? <FileSpreadsheet className="size-5 animate-pulse" /> : <UploadCloud className="size-5" />}
      </span>
      <p className="mt-3 text-sm font-medium">{busy ? "Reading workbook…" : "Drop an .xlsx file here, or click to browse"}</p>
      <p className="mt-1 text-xs text-muted-foreground">The template or your own spreadsheet — columns are matched to the system and you can adjust the mapping. Nothing is written until you confirm.</p>
    </div>
  );
}
