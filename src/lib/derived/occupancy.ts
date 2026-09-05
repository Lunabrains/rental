import type { Contract, ISODate } from "@/types";

/**
 * A contract "occupies" its unit while it is active, while notice has been
 * given but the tenant has not moved out, or when it has expired and the
 * tenant is still in place (no move-out, no successor).
 */
export function isOccupying(c: Contract): boolean {
  if (c.status === "active" || c.status === "notice_given") return true;
  return c.status === "expired" && c.moveOutDate === null && c.renewedToContractId === null;
}

/** Was this contract occupying its unit on date `d`? */
export function occupyingAt(c: Contract, d: ISODate): boolean {
  if (c.startDate > d) return false;
  const leftOn = c.moveOutDate ?? (isOccupying(c) ? null : c.endDate);
  return leftOn === null || leftOn >= d;
}
