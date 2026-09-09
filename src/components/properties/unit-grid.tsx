"use client";

import { UnitSquare } from "@/components/properties/unit-square";
import { floorLabel } from "@/lib/format";
import { cellMatches, type FloorRow, type UnitFilter } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface UnitGridProps {
  floors: FloorRow[];
  selectedUnitId: string | null;
  /** Unit ids matching the search; null when no search is active. */
  highlightIds: Set<string> | null;
  /** A filter dims the squares that do not match instead of hiding them — the building keeps its shape. */
  filter: UnitFilter;
  floorFilter: number | null;
  onSelect: (unitId: string) => void;
}

/**
 * The building elevation: floors stacked, highest on top, ground at the
 * bottom, on a slightly darker panel so white (available) squares read.
 */
export function UnitGrid({ floors, selectedUnitId, highlightIds, filter, floorFilter, onSelect }: UnitGridProps) {
  const maxPerRow = Math.max(1, ...floors.map((f) => f.units.length));
  const cols = Math.min(5, maxPerRow);

  return (
    <div className="rounded-lg border bg-grid-panel p-3 sm:p-4">
      <Legend />
      <div className="space-y-2">
        {floors.map((floor) => {
          const floorDimmed = floorFilter !== null && floor.floor !== floorFilter;
          return (
            <div key={floor.floor} className={cn("flex items-stretch gap-3 transition-opacity", floorDimmed && "opacity-30")}>
              <div className="flex w-12 shrink-0 flex-col items-end justify-center pr-1 text-right">
                <span className="tabular text-sm font-semibold leading-none">{floor.floor === 0 ? "G" : floor.floor}</span>
                <span className="mt-1 text-[10px] leading-none text-muted-foreground">{floor.floor === 0 ? "ground" : "floor"}</span>
              </div>
              <div
                className="grid flex-1 gap-2"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                aria-label={floorLabel(floor.floor)}
              >
                {floor.units.map((cell) => {
                  const matched = highlightIds ? highlightIds.has(cell.unit.id) : false;
                  const dimmed = (highlightIds !== null && highlightIds.size > 0 && !matched) || (filter !== "all" && !cellMatches(cell, filter));
                  return (
                    <UnitSquare
                      key={cell.unit.id}
                      cell={cell}
                      selected={cell.unit.id === selectedUnitId}
                      highlighted={matched}
                      dimmed={dimmed && cell.unit.id !== selectedUnitId}
                      onClick={() => onSelect(cell.unit.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

/** The colour key, on top where the eye lands first: white, green, red, orange. */
function Legend() {
  const items: { cls: string; label: string; dir?: "rtl" }[] = [
    { cls: "border-unit-available-border bg-unit-available", label: "Available" },
    { cls: "border-unit-rented-border bg-unit-rented", label: "Rented" },
    { cls: "border-unit-complaint-border bg-unit-complaint", label: "Complaint" },
    { cls: "border-unit-vacating-border bg-unit-vacating", label: "تعهد بالإخلاء", dir: "rtl" },
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 pb-3 text-xs text-muted-foreground" aria-label="Colour key">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-4 w-6 rounded-sm border", i.cls)} aria-hidden />
          <span dir={i.dir} className={cn(i.dir === "rtl" && "font-medium text-foreground")}>{i.label}</span>
        </span>
      ))}
    </div>
  );
}
