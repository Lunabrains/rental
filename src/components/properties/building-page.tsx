"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/common/states";
import { BuildingHeader } from "@/components/properties/building-header";
import { BuildingAssets, BuildingDocuments, BuildingFinancials, BuildingMaintenance, BuildingOverview, BuildingTimeline } from "@/components/properties/building-tabs";
import { GridToolbar, type StatusFilter } from "@/components/properties/grid-toolbar";
import { UnitGrid } from "@/components/properties/unit-grid";
import { UnitList } from "@/components/properties/unit-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnitDrawerParams } from "@/components/units/use-unit-drawer";
import { useStore } from "@/lib/data/store-context";
import { buildingHealth } from "@/lib/derived/metrics";
import { getPropertyDetails, getUnitsByProperty } from "@/lib/queries";
import { cn } from "@/lib/utils";

type View = "overview" | "units" | "financials" | "maintenance" | "assets" | "documents" | "timeline";
const VIEWS: { key: View; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "units", label: "Units" },
  { key: "financials", label: "Financials" },
  { key: "maintenance", label: "Maintenance" },
  { key: "assets", label: "Assets" },
  { key: "documents", label: "Documents" },
  { key: "timeline", label: "Timeline" },
];

function matches(query: string, unitNumber: string, tenantName: string | null, phone: string | null): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (unitNumber.toLowerCase().includes(q)) return true;
  if (tenantName && tenantName.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && phone && phone.replace(/\D/g, "").includes(digits)) return true;
  return false;
}

/**
 * Building 360°: the elevation grid stays the landing view (the demo's
 * heart); the other tabs give the owner the money, maintenance, assets,
 * documents and history of the building without leaving the page.
 * Tabs are addressed by `?view=` so the unit drawer's `?unit=&tab=` keep working.
 */
export function BuildingPage({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const drawer = useUnitDrawerParams();
  const router = useRouter();
  const params = useSearchParams();

  const summary = useMemo(() => getPropertyDetails(store, propertyId), [store, propertyId]);
  const floors = useMemo(() => getUnitsByProperty(store, propertyId), [store, propertyId]);
  const health = useMemo(() => buildingHealth(store, propertyId), [store, propertyId]);

  const viewParam = params.get("view");
  const view: View = VIEWS.some((v) => v.key === viewParam) ? (viewParam as View) : "units";
  const setView = useCallback(
    (v: View) => {
      const sp = new URLSearchParams(params.toString());
      if (v === "units") sp.delete("view");
      else sp.set("view", v);
      router.replace(`/properties/${propertyId}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, router, propertyId],
  );

  const [query, setQuery] = useState("");
  const [floor, setFloor] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const highlightIds = useMemo(() => {
    if (!query.trim()) return null;
    const ids = new Set<string>();
    for (const f of floors) {
      for (const cell of f.units) {
        if (matches(query, cell.unit.unitNumber, cell.tenant?.fullName ?? null, cell.tenant?.phone ?? null)) ids.add(cell.unit.id);
      }
    }
    return ids;
  }, [query, floors]);

  const visibleFloors = useMemo(
    () => floors.map((f) => ({ ...f, units: status === "rented" ? f.units.filter((c) => c.unit.status === "rented") : f.units })),
    [floors, status],
  );

  if (!summary) {
    return (
      <EmptyState
        icon={Building2}
        title="Building not found"
        description="It may not be imported yet."
        action={
          <Button asChild variant="outline">
            <Link href="/properties">All properties</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <BuildingHeader summary={summary} health={health} lowOccupancyThreshold={store.settings.thresholds.buildingOccupancyWarning} />

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <div className="overflow-x-auto border-b">
          <TabsList variant="line" className="h-10 w-max justify-start gap-1 bg-transparent p-0">
            {VIEWS.map((v) => (
              <TabsTrigger key={v.key} value={v.key} className="px-3 text-sm">
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {view === "overview" && <BuildingOverview summary={summary} />}

      {view === "units" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <GridToolbar
                query={query}
                onQuery={setQuery}
                matchCount={highlightIds ? highlightIds.size : null}
                floors={floors.map((f) => f.floor)}
                floor={floor}
                onFloor={setFloor}
                status={status}
                onStatus={setStatus}
              />
            </div>
            <div className="flex rounded-md border bg-card p-0.5 text-xs">
              {(["grid", "list"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLayout(l)} className={cn("rounded px-2.5 py-1 capitalize transition-colors", layout === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {layout === "grid" ? (
            <UnitGrid
              floors={visibleFloors}
              selectedUnitId={drawer.unitId}
              highlightIds={highlightIds}
              dimRented={status === "available"}
              floorFilter={floor}
              onSelect={(id) => drawer.open(id)}
            />
          ) : (
            <UnitList propertyId={propertyId} floors={visibleFloors} highlightIds={highlightIds} floorFilter={floor} status={status} onSelect={(id) => drawer.open(id)} />
          )}
        </div>
      )}

      {view === "financials" && <BuildingFinancials propertyId={propertyId} />}
      {view === "maintenance" && <BuildingMaintenance propertyId={propertyId} />}
      {view === "assets" && <BuildingAssets propertyId={propertyId} />}
      {view === "documents" && <BuildingDocuments propertyId={propertyId} />}
      {view === "timeline" && <BuildingTimeline propertyId={propertyId} />}
    </div>
  );
}
