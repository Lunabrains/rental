import Link from "next/link";
import { MapPin } from "lucide-react";

import { BuildingArt } from "@/components/properties/building-art";
import { formatMoney, formatPercent } from "@/lib/format";
import type { PropertySummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function PropertyCard({ summary, lowOccupancyThreshold }: { summary: PropertySummary; lowOccupancyThreshold: number }) {
  const p = summary.property;
  const weak = summary.occupancy < lowOccupancyThreshold;

  return (
    <Link
      href={`/properties/${p.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-xs outline-none transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/30"
    >
      <div className="relative aspect-[16/8] w-full overflow-hidden border-b">
        <BuildingArt property={p} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        {summary.criticalAlerts > 0 && (
          <span className="tabular absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-brand-foreground shadow-sm">
            {summary.criticalAlerts} critical
          </span>
        )}
        <span className={cn("tabular absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-xs font-semibold shadow-sm", weak ? "bg-warning-muted text-warning-foreground" : "bg-card text-foreground")}>
          Score {summary.score}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-tight">{p.name}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {p.district}, {p.city}
            </p>
          </div>
          <span className={cn("tabular shrink-0 text-lg font-semibold", weak ? "text-warning-foreground" : "text-foreground")}>{formatPercent(summary.occupancy)}</span>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", weak ? "bg-warning" : "bg-unit-rented")} style={{ width: `${Math.round(summary.occupancy * 100)}%` }} />
        </div>
        <div className="tabular mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            <strong className="font-medium text-foreground">{summary.rented}</strong> rented · <strong className="font-medium text-foreground">{summary.available}</strong> available
          </span>
          <span>{summary.units} units</span>
        </div>

        <dl className="tabular mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Revenue / mo</dt>
            <dd className="mt-0.5 text-sm font-medium">{formatMoney(summary.monthlyRevenue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd className={cn("mt-0.5 text-sm font-medium", summary.outstanding > 0 ? "text-critical" : "text-foreground")}>
              {summary.outstanding > 0 ? formatMoney(summary.outstanding) : "—"}
            </dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
