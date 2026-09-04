"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { DrawerTab } from "@/components/actions/action-provider";

const TABS: DrawerTab[] = ["tenant", "contract", "payments", "documents", "activity"];

export interface UnitDrawerParams {
  unitId: string | null;
  tab: DrawerTab;
  open: (unitId: string, tab?: DrawerTab) => void;
  setTab: (tab: DrawerTab) => void;
  close: () => void;
}

/**
 * The unit drawer is addressed by URL (`?unit=…&tab=…`) so alert actions,
 * search results and tables can deep-link into it from any page.
 */
export function useUnitDrawerParams(): UnitDrawerParams {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const unitId = params.get("unit");
  const tabParam = params.get("tab");
  const tab: DrawerTab = TABS.includes(tabParam as DrawerTab) ? (tabParam as DrawerTab) : "tenant";

  const write = useCallback(
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

  return useMemo<UnitDrawerParams>(
    () => ({
      unitId,
      tab,
      open: (id, t) => write({ unit: id, tab: t ?? null }),
      setTab: (t) => write({ tab: t }),
      close: () => write({ unit: null, tab: null }),
    }),
    [unitId, tab, write],
  );
}
