import { addDays, addMonths, addYears, getDate } from "date-fns";

import { fromISO, isISODate, toISO, today } from "@/lib/date";
import type { ISODate } from "@/types";

/**
 * Relative date tokens accepted anywhere the template expects a date:
 *   today · today+28d · today-8d · today-5m · today+1y · today-1y+2m
 * They resolve against the real "today" at import time, which keeps the demo
 * seed permanently fresh without a single hard-coded calendar date.
 */
const TOKEN = /^today((?:[+-]\d+[dmy])*)$/i;
const PART = /([+-])(\d+)([dmy])/gi;

export type DateResolution =
  | { ok: true; value: ISODate; relative: boolean }
  | { ok: false; reason: string };

export function isRelativeDateToken(value: string): boolean {
  return TOKEN.test(value.trim());
}

export function resolveDateValue(raw: unknown, base: ISODate = today()): DateResolution {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty" };

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, reason: "invalid date" };
    return { ok: true, value: toISO(raw), relative: false };
  }

  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((raw - 25569) * 86_400_000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { ok: false, reason: "invalid serial date" };
    return { ok: true, value: toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), relative: false };
  }

  const s = String(raw).trim();

  const m = TOKEN.exec(s);
  if (m) {
    let d = fromISO(base);
    for (const part of m[1].matchAll(PART)) {
      const sign = part[1] === "-" ? -1 : 1;
      const n = Number(part[2]) * sign;
      const unit = part[3].toLowerCase();
      if (unit === "d") d = addDays(d, n);
      else if (unit === "m") d = addMonths(d, n);
      else d = addYears(d, n);
    }
    return { ok: true, value: toISO(d), relative: true };
  }

  if (isISODate(s)) return { ok: true, value: s, relative: false };

  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    if (isISODate(iso)) return { ok: true, value: iso, relative: false };
  }

  // ISO datetime → date part
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && isISODate(s.slice(0, 10))) {
    return { ok: true, value: s.slice(0, 10), relative: false };
  }

  return { ok: false, reason: `unrecognised date "${s}"` };
}

/**
 * `payment_day` accepts an integer 1–28 or a relative date token, in which case
 * the day-of-month of the resolved date is used. The seed relies on this so
 * "overdue 8 days" stays true on any calendar day.
 */
export function resolvePaymentDay(raw: unknown, base: ISODate = today()): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isInteger(raw)) return clampDay(raw);
  const s = String(raw).trim();
  if (/^\d{1,2}$/.test(s)) return clampDay(Number(s));
  const r = resolveDateValue(s, base);
  if (r.ok) return clampDay(getDate(fromISO(r.value)));
  return null;
}

function clampDay(n: number): number {
  return Math.min(28, Math.max(1, n));
}
