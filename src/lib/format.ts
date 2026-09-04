import { format, parseISO } from "date-fns";

import type { ISODate, ISODateTime, PeriodMonth } from "@/types";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const moneyCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatMoney(value: number): string {
  return Number.isInteger(value) ? money.format(value) : moneyCents.format(value);
}

export function formatMoneyCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return money.format(value);
}

export function formatNumber(value: number): string {
  return number.format(value);
}

/** `0.84` → "84%" */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatDate(iso: ISODate | ISODateTime | null | undefined): string {
  if (!iso) return "—";
  return format(parseISO(iso), "MMM d, yyyy");
}

export function formatDateShort(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  return format(parseISO(iso), "d MMM");
}

export function formatDateTime(iso: ISODateTime | null | undefined): string {
  if (!iso) return "—";
  return format(parseISO(iso), "MMM d, yyyy · HH:mm");
}

export function formatMonth(period: PeriodMonth): string {
  return format(parseISO(`${period}-01`), "MMMM yyyy");
}

export function formatMonthShort(period: PeriodMonth): string {
  return format(parseISO(`${period}-01`), "MMM");
}

export function formatMonthYearShort(period: PeriodMonth): string {
  return format(parseISO(`${period}-01`), "MMM yy");
}

/** Human phrasing for a day delta relative to today. */
export function formatRelativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

export function formatDaysCount(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/** "Karim Daher" → "Karim D." for grid squares. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function initials(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** "bank_transfer" → "Bank transfer" */
export function labelize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function floorLabel(floor: number): string {
  if (floor === 0) return "Ground floor";
  return `${ordinal(floor)} floor`;
}
