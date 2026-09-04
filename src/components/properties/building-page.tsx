"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Building2 } from "lucide-react";

import type { DrawerTab } from "@/components/actions/action-provider";
import { EmptyState } from "@/components/common/states";
import { BuildingHeader } from "@/components/properties/building-header";
import { GridToolbar, type StatusFilter } from "@/components/properties/grid-toolbar";
import { UnitGrid } from "@/components/properties/unit-grid";
import { Button } from "@/components/ui/button";
import { UnitDrawer } from "@/components/units/unit-drawer";
import { useStore } from "@/lib/data/store-context";
import { getPropertyDetails, getUnitsByProperty } from "@/lib/queries";

const TABS: DrawerTab[] = ["tenant", "contract", "payments", "documents", "activity"];

function matches(query: string, unitNumber: string, tenantName: string | null, phone: string | null): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (unitNumber.toLowerCase().includes(q)) return true;
  if (tenantName && tenantName.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && phone && phone.replace(/\D/g, "").includes(digits)) return true;
  return false;
}

export function BuildingPage({ propertyId }: { propertyId: string }) {
  const store = useStore();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const summary = useMemo(() => getPropertyDetails(store, propertyId), [store, propertyId]);
  const floors = useMemo(() => getUnitsByProperty(store, propertyId), [store, propertyId]);

  const [query, setQuery] = useState("");
  const [floor, setFloor] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");

  const selectedUnitId = params.get("unit");
  const tabParam = params.get("tab");
  const tab: DrawerTab = TABS.includes(tabParam as DrawerTab) ? (tabParam as DrawerTab) : "tenant";

  const setParams = useCallback(
    (next: { unit?: string | null; tab?: DrawerTab | null }) => {
      const sp = new URLSearchParams(params.toString());
      if (next.unit !== undefined) {
        if (next.unit) sp.set("unit", next.unit);
        else sp.delete("unit");
      }
      if (next.tab !== undefined) {
        if (next.tab && next.tab !== "tenant") sp.set("tab", next.tab);
        else sp.delete("tab");
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

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
      <BuildingHeader summary={summary} lowOccupancyThreshold={store.settings.thresholds.buildingOccupancyWarning} />

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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)]">
        <UnitGrid
          floors={visibleFloors}
          selectedUnitId={selectedUnitId}
          highlightIds={highlightIds}
          dimRented={status === "available"}
          floorFilter={floor}
          onSelect={(id) => setParams({ unit: id, tab: null })}
        />
      </div>

      <UnitDrawer
        unitId={selectedUnitId}
        tab={tab}
        onTabChange={(t) => setParams({ tab: t })}
        onClose={() => setParams({ unit: null, tab: null })}
      />
    </div>
  );
}
