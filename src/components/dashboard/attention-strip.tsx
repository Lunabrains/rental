"use client";

import Link from "next/link";
import { AlertOctagon, CalendarClock, CircleDollarSign, DoorOpen, Wrench, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AttentionTile {
  key: string;
  label: string;
  count: number;
  /** The single most pressing item, one line. */
  headline: string;
  href: string;
  icon: LucideIcon;
  tone: "critical" | "warning" | "attention" | "success";
}

const TONE: Record<AttentionTile["tone"], string> = {
  critical: "border-critical/30 bg-critical-muted/40",
  warning: "border-warning/30 bg-warning-muted/40",
  attention: "border-border bg-card",
  success: "border-border bg-card",
};
const COUNT: Record<AttentionTile["tone"], string> = { critical: "text-critical", warning: "text-warning-foreground", attention: "text-foreground", success: "text-success" };

/** Attention area (plan §10): the five things that need a hand this week, each one click from the list behind it. */
export function AttentionStrip({ tiles }: { tiles: AttentionTile[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <Link key={t.key} href={t.href} className={cn("group rounded-lg border p-3 shadow-xs transition-colors hover:bg-accent/60", TONE[t.tone])}>
            <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Icon className="size-3.5" /> {t.label}
            </span>
            <span className={cn("tabular mt-1 block text-2xl font-semibold", COUNT[t.tone])}>{t.count}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={t.headline}>{t.headline}</span>
          </Link>
        );
      })}
    </div>
  );
}

export const ATTENTION_ICONS = { overdue: CircleDollarSign, expiring: CalendarClock, maintenance: AlertOctagon, preventive: Wrench, vacant: DoorOpen };
