"use client";

import { useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { PropertyCard } from "@/components/properties/property-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/data/store-context";
import { formatMoney, formatPercent } from "@/lib/format";
import { getProperties, type PropertySummary } from "@/lib/queries";

type SortKey = "name" | "occupancy" | "revenue" | "outstanding" | "score" | "units";

const SORTS: { key: SortKey; label: string; fn: (a: PropertySummary, b: PropertySummary) => number }[] = [
  { key: "name", label: "Name", fn: (a, b) => a.name.localeCompare(b.name) },
  { key: "occupancy", label: "Occupancy", fn: (a, b) => b.occupancy - a.occupancy },
  { key: "revenue", label: "Revenue", fn: (a, b) => b.monthlyRevenue - a.monthlyRevenue },
  { key: "outstanding", label: "Outstanding", fn: (a, b) => b.outstanding - a.outstanding },
  { key: "score", label: "Score", fn: (a, b) => b.score - a.score },
  { key: "units", label: "Units", fn: (a, b) => b.units - a.units },
];

export function PropertiesPage() {
  const store = useStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  const all = useMemo(() => getProperties(store), [store]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((s) => `${s.name} ${s.property.district} ${s.property.city} ${s.property.code}`.toLowerCase().includes(q))
      : all;
    return filtered.slice().sort(SORTS.find((s) => s.key === sort)!.fn);
  }, [all, query, sort]);

  const totals = useMemo(() => {
    const units = all.reduce((n, s) => n + s.units, 0);
    const rented = all.reduce((n, s) => n + s.rented, 0);
    return { units, rented, revenue: all.reduce((n, s) => n + s.monthlyRevenue, 0), occupancy: units > 0 ? rented / units : 0 };
  }, [all]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Properties"
        description={`${all.length} buildings · ${totals.units} units · ${formatPercent(totals.occupancy)} occupied · ${formatMoney(totals.revenue)}/month`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search buildings…"
                className="h-9 w-56 rounded-md border border-input bg-card pl-8 pr-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
              />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    Sort: {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="No buildings match" description="Try a different name or district." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((s) => (
            <PropertyCard key={s.id} summary={s} lowOccupancyThreshold={store.settings.thresholds.buildingOccupancyWarning} />
          ))}
        </div>
      )}
    </div>
  );
}
