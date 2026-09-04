"use client";

import { UnitDrawer } from "@/components/units/unit-drawer";
import { useUnitDrawerParams } from "@/components/units/use-unit-drawer";

/** Mounted once in the shell: whatever page you are on, `?unit=` opens the drawer. */
export function DrawerHost() {
  const { unitId, tab, setTab, close } = useUnitDrawerParams();
  return <UnitDrawer unitId={unitId} tab={tab} onTabChange={setTab} onClose={close} />;
}
