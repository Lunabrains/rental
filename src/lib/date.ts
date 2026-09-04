import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  subMonths,
  setDate,
  getDaysInMonth,
  isValid,
} from "date-fns";

import type { ISODate, ISODateTime, PeriodMonth } from "@/types";

/**
 * "Today" for the whole app. Every seed date and every derived value is
 * relative to this. Overridable so the demo can be frozen for rehearsal or
 * tests.
 */
let todayOverride: ISODate | null = null;

export function setTodayOverride(iso: ISODate | null): void {
  todayOverride = iso;
}

export function today(): ISODate {
  return todayOverride ?? toISO(new Date());
}

export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

export function toISO(d: Date): ISODate {
  return format(d, "yyyy-MM-dd");
}

export function fromISO(iso: ISODate): Date {
  return parseISO(iso);
}

export function isISODate(value: unknown): value is ISODate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  return toISO(addDays(fromISO(iso), days));
}

export function addMonthsISO(iso: ISODate, months: number): ISODate {
  return toISO(addMonths(fromISO(iso), months));
}

/** Calendar days from `a` to `b` (positive when b is after a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(fromISO(b), fromISO(a));
}

/** Days from today until `iso` (negative if in the past). */
export function daysUntil(iso: ISODate): number {
  return daysBetween(today(), iso);
}

/** Days since `iso` (negative if in the future). */
export function daysSince(iso: ISODate): number {
  return daysBetween(iso, today());
}

export function periodOf(iso: ISODate): PeriodMonth {
  return iso.slice(0, 7);
}

export function currentPeriod(): PeriodMonth {
  return periodOf(today());
}

export function periodStart(period: PeriodMonth): ISODate {
  return `${period}-01`;
}

export function periodEnd(period: PeriodMonth): ISODate {
  return toISO(endOfMonth(fromISO(periodStart(period))));
}

export function addPeriods(period: PeriodMonth, months: number): PeriodMonth {
  return periodOf(addMonthsISO(periodStart(period), months));
}

/** Last `n` periods ending with the current one, oldest first. */
export function lastPeriods(n: number, endPeriod: PeriodMonth = currentPeriod()): PeriodMonth[] {
  const out: PeriodMonth[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addPeriods(endPeriod, -i));
  return out;
}

/** Due date for a period given a payment day (clamped to month length). */
export function dueDateFor(period: PeriodMonth, paymentDay: number): ISODate {
  const start = fromISO(periodStart(period));
  const day = Math.min(Math.max(1, paymentDay), getDaysInMonth(start));
  return toISO(setDate(start, day));
}

export function monthStartISO(iso: ISODate): ISODate {
  return toISO(startOfMonth(fromISO(iso)));
}

export function previousPeriod(period: PeriodMonth = currentPeriod()): PeriodMonth {
  return periodOf(toISO(subMonths(fromISO(periodStart(period)), 1)));
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return a < b;
}

export function isAfter(a: ISODate, b: ISODate): boolean {
  return a > b;
}

export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}
