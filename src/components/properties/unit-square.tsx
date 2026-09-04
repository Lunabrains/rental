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
 * One unit on the building grid. Sacred colours: WHITE = available,
 * RED = rented. Shows unit number + tenant name only — everything else lives
 * in the drawer.
 */
export function UnitSquare({ cell, selected, highlighted, dimmed, onClick }: UnitSquareProps) {
  const { unit, tenant } = cell;
  const rented = unit.status === "rented";
  const other = unit.status === "maintenance" || unit.status === "reserved";
  const label = rented && tenant ? shortName(tenant.fullName) : other ? unit.status : "Available";

  return (
    <button
      type="button"
      onClick={onClick}
      data-unit={unit.unitNumber}
      aria-pressed={selected}
      aria-label={`${unit.unitNumber} — ${rented && tenant ? tenant.fullName : label}`}
      className={cn(
        "relative flex min-h-[68px] flex-col justify-between rounded-md border px-2.5 py-2 text-left outline-none transition-all duration-150",
        rented && "border-unit-rented-border bg-unit-rented text-unit-rented-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]",
        !rented && !other && "border-unit-available-border bg-unit-available text-unit-available-foreground",
        other && "border-dashed border-muted-foreground/40 bg-muted text-muted-foreground",
        "hover:-translate-y-px hover:shadow-md",
        selected && "z-10 scale-[1.04] shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-grid-panel",
        highlighted && !selected && "z-10 scale-[1.03] shadow-lg ring-2 ring-foreground ring-offset-2 ring-offset-grid-panel",
        dimmed && "opacity-[0.15] hover:opacity-40",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-grid-panel",
      )}
    >
      <span className={cn("tabular text-[11px] font-semibold leading-none tracking-wide", rented ? "text-unit-rented-foreground/80" : "text-muted-foreground")}>
        {unit.unitNumber}
      </span>
      <span className={cn("mt-2 truncate text-sm font-medium leading-tight", !rented && !other && "text-muted-foreground", other && "capitalize")}>{label}</span>
    </button>
  );
}
