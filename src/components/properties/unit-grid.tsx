"use client";

import { UnitSquare } from "@/components/properties/unit-square";
import { floorLabel } from "@/lib/format";
import type { FloorRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface UnitGridProps {
  floors: FloorRow[];
  selectedUnitId: string | null;
  /** Unit ids matching the search; null when no search is active. */
  highlightIds: Set<string> | null;
  /** "Available only" dims rented squares instead of hiding them. */
  dimRented: boolean;
  floorFilter: number | null;
  onSelect: (unitId: string) => void;
}

/**
 * The building elevation: floors stacked, highest on top, ground at the
 * bottom, on a slightly darker panel so white (available) squares read.
 */
export function UnitGrid({ floors, selectedUnitId, highlightIds, dimRented, floorFilter, onSelect }: UnitGridProps) {
  const maxPerRow = Math.max(1, ...floors.map((f) => f.units.length));
  const cols = Math.min(5, maxPerRow);

  return (
    <div className="rounded-lg border bg-grid-panel p-3 sm:p-4">
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
                  const rented = cell.unit.status === "rented";
                  const matched = highlightIds ? highlightIds.has(cell.unit.id) : false;
                  const dimmed = (highlightIds !== null && highlightIds.size > 0 && !matched) || (dimRented && rented);
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
      <div className="mt-3 flex items-center gap-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-unit-rented-border bg-unit-rented" /> Rented
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-unit-available-border bg-unit-available" /> Available
        </span>
      </div>
    </div>
  );
}
