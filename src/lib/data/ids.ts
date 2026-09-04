import type { ID, PeriodMonth } from "@/types";

/** "Beirut Heights" → "beirut-heights" */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable short hash for deterministic ids (FNV-1a, base36). */
export function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(-6);
}

export const ids = {
  property: (name: string): ID => slugify(name),
  unit: (propertyId: ID, unitNumber: string): ID => `${propertyId}-${slugify(unitNumber)}`,
  tenant: (fullName: string, phone: string): ID => `t-${slugify(fullName)}-${shortHash(phone)}`,
  contract: (contractNumber: string): ID => `c-${slugify(contractNumber)}`,
  payment: (contractId: ID, period: PeriodMonth): ID => `${contractId}-${period}`,
  document: (owner: ID, kind: string, fileName: string): ID => `d-${owner}-${kind}-${shortHash(fileName)}`,
  activity: (seq: number): ID => `a-${Date.now().toString(36)}-${seq.toString(36)}`,
  alert: (type: string, entityId: ID): string => `${type}:${entityId}`,
};

/** Normalise a phone number to digits with a leading + so keys compare equal. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/\+/g, "")}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return digits.length > 0 ? `+${digits}` : "";
}
