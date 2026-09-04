import type { Alert, ISODate, Store } from "@/types";

/**
 * Alert engine — implemented in Phase 3. Until then existing alerts pass
 * through untouched so the data layer can be exercised end to end.
 */
export function computeAlerts(store: Store, _base: ISODate): Alert[] {
  void _base;
  return store.alerts;
}
