import { indexStore } from "@/lib/data/store";
import type { Property, Store, Unit } from "@/types";

/**
 * Entity resolution shared by the scripted answers and the demo brain, so
 * "marina", "MR", "Marina Residence" and "beirut" all land on the same
 * building, and "704 in marina" finds B704.
 */

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    // Casual shorthand owners actually type.
    .replace(/\bwks\b/g, "weeks")
    .replace(/\bwk\b/g, "week")
    .replace(/\b(tmrw|tmr|tmw|2moro|tomorow)\b/g, "tomorrow")
    .replace(/\bmos\b/g, "months")
    .replace(/\byrs?\b/g, "year")
    .replace(/\bapts?\b/g, "units")
    .replace(/\bbldg\b/g, "building")
    .replace(/\bpmts?\b/g, "payments")
    .replace(/\bu\b/g, "you")
    .replace(/\br\b/g, "are")
    .replace(/\bwat\b/g, "what")
    .replace(/\bwats\b/g, "what is")
    .replace(/\bwhos\b/g, "who is")
    .replace(/\bwhats\b/g, "what is")
    .replace(/\bhows\b/g, "how is")
    .replace(/\s+/g, " ")
    .trim();
}

/** Longest match wins: full name, then a distinctive first word (≥5 chars), then the code. */
export function findProperty(store: Store, normalizedQuestion: string): Property | null {
  const q = normalizedQuestion;
  let best: Property | null = null;
  let bestLen = 0;
  for (const p of store.properties) {
    const name = normalizeQuestion(p.name);
    const first = name.split(" ")[0];
    const code = p.code.toLowerCase();
    if (q.includes(name)) {
      if (name.length > bestLen) {
        best = p;
        bestLen = name.length;
      }
    } else if (first.length >= 5 && new RegExp(`\\b${first}\\b`).test(q)) {
      if (first.length > bestLen) {
        best = p;
        bestLen = first.length;
      }
    } else if (code.length >= 2 && !/^\d+$/.test(code) && new RegExp(`\\b${code}\\b`).test(q)) {
      if (code.length > bestLen) {
        best = p;
        bestLen = code.length;
      }
    }
  }
  return best;
}

/** "704" matches unit 704 and B704; a typed letter prefix ("b304") is literal and matches B304 only. */
export function findUnits(store: Store, unitToken: string, property: Property | null): Unit[] {
  const token = unitToken.toLowerCase();
  const inScope = (u: Unit) => !property || u.propertyId === property.id;
  const exact = store.units.filter((u) => u.unitNumber.toLowerCase() === token && inScope(u));
  if (exact.length > 0 || /^[a-z]/.test(token)) return exact;
  return store.units.filter((u) => u.unitNumber.toLowerCase().replace(/^[a-z]+/, "") === token && inScope(u));
}

export function propertyNameFor(store: Store, propertyId: string | undefined): string | undefined {
  return propertyId ? indexStore(store).propertyById.get(propertyId)?.name : undefined;
}

/** Words that hint the user named a building we don't have. */
export const BUILDING_WORDS = /\b(residence|tower|heights|plaza|gardens?|view|court|villas?|complex|center|centre|house|lofts?|park)\b/;
