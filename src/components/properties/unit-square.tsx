"use client";

import { shortName } from "@/lib/format";
import type { UnitCell } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface UnitSquareProps {
  cell: UnitCell;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  onClick: () => void;
}

/**
 * One unit on the building grid. Colours: WHITE = available, GREEN = rented,
 * RED = the tenant has an open complaint, ORANGE = تعهد بالإخلاء (the tenant
 * signed an undertaking to vacate). Shows unit number + tenant name only —
 * everything else lives in the drawer.
 */
export function UnitSquare({ cell, selected, highlighted, dimmed, onClick }: UnitSquareProps) {
  const { unit, tenant, state } = cell;
  const occupied = state === "rented" || state === "complaint" || state === "vacating";
  const other = state === "other";
  const label = occupied && tenant ? shortName(tenant.fullName) : other ? unit.status : "Available";
  const stateLabel = state === "complaint" ? "complaint" : state === "vacating" ? "تعهد بالإخلاء" : state === "rented" ? "rented" : state === "available" ? "available" : unit.status;

  return (
    <button
      type="button"
      onClick={onClick}
      data-unit={unit.unitNumber}
      data-state={state}
      aria-pressed={selected}
      aria-label={`${unit.unitNumber} — ${occupied && tenant ? tenant.fullName : label} · ${stateLabel}`}
      className={cn(
        "relative flex min-h-[68px] flex-col justify-between rounded-md border px-2.5 py-2 text-left outline-none transition-all duration-150",
        state === "rented" && "border-unit-rented-border bg-unit-rented text-unit-rented-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        state === "complaint" && "border-unit-complaint-border bg-unit-complaint text-unit-complaint-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        state === "vacating" && "border-unit-vacating-border bg-unit-vacating text-unit-vacating-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        state === "available" && "border-unit-available-border bg-unit-available text-unit-available-foreground",
        other && "border-dashed border-muted-foreground/40 bg-muted text-muted-foreground",
        "hover:-translate-y-px hover:shadow-md",
        selected && "z-10 scale-[1.04] shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-grid-panel",
        highlighted && !selected && "z-10 scale-[1.03] shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-grid-panel",
        dimmed && "opacity-[0.15] hover:opacity-40",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-grid-panel",
      )}
    >
      <span className={cn("tabular text-[11px] font-semibold leading-none tracking-wide", occupied ? "opacity-80" : "text-muted-foreground")}>{unit.unitNumber}</span>
      {state === "vacating" && cell.complaint && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-unit-complaint ring-1 ring-white/70" aria-hidden title="Open complaint too" />}
      <span className={cn("mt-2 truncate text-sm font-medium leading-tight", state === "available" && "text-muted-foreground", other && "capitalize")}>{label}</span>
    </button>
  );
}
