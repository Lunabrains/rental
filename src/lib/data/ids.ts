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

let seq = 0;
/** Unique id for records created in-session (not from an import key). */
export function freshId(prefix: string): ID {
  seq++;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`;
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
  supplier: (name: string): ID => `s-${slugify(name)}`,
  asset: (propertyId: ID, name: string): ID => `as-${propertyId}-${slugify(name)}`,
  expense: (propertyId: ID, date: string, description: string): ID => `e-${propertyId}-${date}-${shortHash(description)}`,
  budget: (propertyId: ID, period: string, category: string): ID => `b-${propertyId}-${period}-${category}`,
  deposit: (contractId: ID): ID => `dep-${contractId}`,
  workOrder: (number: string): ID => `wo-${slugify(number)}`,
  plan: (propertyId: ID, type: string, assetId: ID | null): ID => `pm-${assetId ?? propertyId}-${slugify(type)}`,
  meter: (meterNumber: string): ID => `m-${slugify(meterNumber)}`,
  reading: (meterId: ID, date: string): ID => `r-${meterId}-${date}`,
  charge: (propertyId: ID, period: string, category: string): ID => `cc-${propertyId}-${period}-${slugify(category)}`,
  inspection: (propertyId: ID, unitId: ID | null, type: string, date: string): ID => `i-${unitId ?? propertyId}-${type}-${date}`,
  renovation: (propertyId: ID, title: string): ID => `rn-${propertyId}-${slugify(title)}`,
  parking: (propertyId: ID, space: string): ID => `pk-${propertyId}-${slugify(space)}`,
  key: (propertyId: ID, identifier: string): ID => `k-${propertyId}-${slugify(identifier)}`,
  reminder: (): ID => freshId("rem"),
  audit: (): ID => freshId("au"),
};

/** Normalise a phone number to digits with a leading + so keys compare equal. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/\+/g, "")}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return digits.length > 0 ? `+${digits}` : "";
}
