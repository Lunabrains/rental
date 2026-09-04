"use client";

import { cn } from "@/lib/utils";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface ChipsProps<T extends string> {
  value: T;
  options: ChipOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

/** Single-select filter chips — the row above every table. */
export function Chips<T extends string>({ value, options, onChange, className, "aria-label": ariaLabel }: ChipsProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn("tabular rounded-full px-1.5 py-px text-[10px]", active ? "bg-primary-foreground/20" : "bg-muted")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
