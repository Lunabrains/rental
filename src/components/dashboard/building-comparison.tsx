"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ScoreBadge } from "@/components/common/score";
import { SectionCard } from "@/components/common/section-card";
import { useStore } from "@/lib/data/store-context";
import { buildingHealth } from "@/lib/derived/metrics";
import { formatMoney, formatPercent } from "@/lib/format";
import type { PortfolioComparison } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Portfolio performance (plan §10): one row per building — occupancy, collection, NOI, outstanding, health. */
export function BuildingComparison({ comparison, lowOccupancyThreshold }: { comparison: PortfolioComparison; lowOccupancyThreshold: number }) {
  const store = useStore();
  const router = useRouter();
  const rows = [...comparison.rows].sort((a, b) => b.noiPerUnit - a.noiPerUnit);
  const t = comparison.totals;
  return (
    <SectionCard
      title="Building comparison"
      description={`${comparison.label} · sorted by NOI per unit per month`}
      action={
        <Link href="/analytics/performance" className="text-xs font-medium text-brand hover:underline">
          Full comparison
        </Link>
      }
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Building</th>
              <th className="px-4 py-2 text-right font-medium">Occupancy</th>
              <th className="px-4 py-2 text-right font-medium">Collected</th>
              <th className="px-4 py-2 text-right font-medium">NOI</th>
              <th className="px-4 py-2 text-right font-medium">NOI / unit / mo</th>
              <th className="px-4 py-2 text-right font-medium">Outstanding</th>
              <th className="px-4 py-2 text-right font-medium">Health</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => {
              const weak = r.occupancy < lowOccupancyThreshold;
              return (
                <tr key={r.property.id} onClick={() => router.push(`/properties/${r.property.id}`)} className="cursor-pointer border-b transition-colors hover:bg-accent/60">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{r.property.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.units} units</span>
                  </td>
                  <td className={cn("px-4 py-2.5 text-right", weak && "text-warning-foreground")}>{formatPercent(r.occupancy)}</td>
                  <td className={cn("px-4 py-2.5 text-right", r.collectionRate < 0.9 && "text-warning-foreground")}>{formatPercent(r.collectionRate)}</td>
                  <td className={cn("px-4 py-2.5 text-right font-medium", r.noi < 0 && "text-critical")}>{formatMoney(r.noi)}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(Math.round(r.noiPerUnit))}</td>
                  <td className={cn("px-4 py-2.5 text-right", r.outstanding > 0 && "text-critical")}>{r.outstanding > 0 ? formatMoney(r.outstanding) : "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ScoreBadge size="sm" score={r.health} label={`${r.property.name} health`} components={buildingHealth(store, r.property.id).components} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-muted/30 font-medium">
              <td className="px-4 py-2.5">Portfolio</td>
              <td className="px-4 py-2.5 text-right">{formatPercent(t.occupancy)}</td>
              <td className="px-4 py-2.5 text-right">{formatPercent(t.collectionRate)}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(t.noi)}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(Math.round(t.noiPerUnit))}</td>
              <td className={cn("px-4 py-2.5 text-right", t.outstanding > 0 && "text-critical")}>{formatMoney(t.outstanding)}</td>
              <td className="px-4 py-2.5 text-right">{t.health}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
