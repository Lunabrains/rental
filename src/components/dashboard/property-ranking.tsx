"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { SectionCard } from "@/components/common/section-card";
import { formatMoney, formatPercent } from "@/lib/format";
import type { PropertyPerformance } from "@/lib/queries";
import { cn } from "@/lib/utils";

function OccupancyBar({ value, muted }: { value: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", muted ? "bg-foreground/35" : "bg-foreground/80")} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="tabular w-11 text-right text-sm">{formatPercent(value)}</span>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const tone = score >= 90 ? "bg-success-muted text-success" : score >= 80 ? "bg-muted text-foreground" : "bg-warning-muted text-warning-foreground";
  return <span className={cn("tabular inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold", tone)}>{score}</span>;
}

export function PropertyRanking({ performance, lowOccupancyThreshold }: { performance: PropertyPerformance; lowOccupancyThreshold: number }) {
  const router = useRouter();
  const { rows, total } = performance;

  return (
    <SectionCard
      title="Property ranking"
      description="Sorted by occupancy · revenue and outstanding per building"
      action={
        <Link href="/properties" className="text-xs font-medium text-brand hover:underline">
          All properties
        </Link>
      }
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Building</th>
              <th className="px-4 py-2 font-medium">Occupancy</th>
              <th className="px-4 py-2 text-right font-medium">Units</th>
              <th className="px-4 py-2 text-right font-medium">Revenue / mo</th>
              <th className="px-4 py-2 text-right font-medium">Outstanding</th>
              <th className="px-4 py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const weak = r.occupancy < lowOccupancyThreshold;
              return (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/properties/${r.id}`)}
                  className={cn("cursor-pointer border-b transition-colors hover:bg-accent/60", weak && "bg-muted/40 text-muted-foreground")}
                >
                  <td className="px-4 py-2.5">
                    <span className={cn("block font-medium", weak ? "text-foreground/70" : "text-foreground")}>{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.property.district}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <OccupancyBar value={r.occupancy} muted={weak} />
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {r.rented}/{r.units}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">{formatMoney(r.monthlyRevenue)}</td>
                  <td className={cn("tabular px-4 py-2.5 text-right", r.outstanding > 0 && !weak && "text-critical")}>{r.outstanding > 0 ? formatMoney(r.outstanding) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ScorePill score={r.score} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-muted/30 font-medium">
              <td className="px-4 py-2.5">Portfolio</td>
              <td className="px-4 py-2.5">
                <OccupancyBar value={total.occupancy} />
              </td>
              <td className="tabular px-4 py-2.5 text-right">
                {total.rented}/{total.units}
              </td>
              <td className="tabular px-4 py-2.5 text-right">{formatMoney(total.monthlyRevenue)}</td>
              <td className={cn("tabular px-4 py-2.5 text-right", total.outstanding > 0 && "text-critical")}>{formatMoney(total.outstanding)}</td>
              <td className="px-4 py-2.5 text-right">
                <ScorePill score={total.score} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
