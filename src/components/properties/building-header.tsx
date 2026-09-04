import { MapPin } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { BuildingArt } from "@/components/properties/building-art";
import { formatMoney, formatPercent } from "@/lib/format";
import type { PropertySummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "critical" | "warning" | "success" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("tabular mt-0.5 truncate text-lg font-semibold leading-tight", tone === "critical" && "text-critical", tone === "warning" && "text-warning-foreground", tone === "success" && "text-success")}>
        {value}
      </div>
    </div>
  );
}

export function BuildingHeader({ summary, lowOccupancyThreshold }: { summary: PropertySummary; lowOccupancyThreshold: number }) {
  const p = summary.property;
  const weak = summary.occupancy < lowOccupancyThreshold;

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={[{ label: "Properties", href: "/properties" }, { label: p.name }]}
        title={p.name}
        description={
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" />
            {p.address}, {p.district}, {p.city}
            {p.yearBuilt && <span className="text-muted-foreground/70"> · built {p.yearBuilt}</span>}
          </span>
        }
      />
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="grid gap-0 md:grid-cols-[220px_1fr]">
          <div className="h-32 border-b md:h-auto md:border-b-0 md:border-r">
            <BuildingArt property={p} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Units" value={summary.units} />
            <Stat label="Rented" value={summary.rented} />
            <Stat label="Available" value={summary.available} tone={summary.available > 0 ? "warning" : "success"} />
            <Stat label="Occupancy" value={formatPercent(summary.occupancy)} tone={weak ? "warning" : undefined} />
            <Stat label="Revenue / mo" value={formatMoney(summary.monthlyRevenue)} />
            <Stat label="Outstanding" value={summary.outstanding > 0 ? formatMoney(summary.outstanding) : "—"} tone={summary.outstanding > 0 ? "critical" : undefined} />
            <Stat label="Score" value={summary.score} tone={summary.score >= 90 ? "success" : summary.score < 85 ? "warning" : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}
