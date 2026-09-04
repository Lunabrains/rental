import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type KpiTone = "default" | "critical" | "warning" | "success";

export interface KpiTrend {
  /** Already formatted, e.g. "+2.1 pts" or "−$1,500". */
  label: string;
  direction: "up" | "down" | "flat";
  /** Whether this direction is good news — controls the color. */
  good: boolean;
  /** Suffix, e.g. "vs last month". */
  caption?: string;
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  sublabel?: React.ReactNode;
  trend?: KpiTrend;
  icon?: LucideIcon;
  tone?: KpiTone;
  href?: string;
  className?: string;
}

const TONE_VALUE: Record<KpiTone, string> = {
  default: "text-foreground",
  critical: "text-critical",
  warning: "text-warning-foreground",
  success: "text-success",
};

const TONE_ICON: Record<KpiTone, string> = {
  default: "bg-muted text-muted-foreground",
  critical: "bg-critical-muted text-critical",
  warning: "bg-warning-muted text-warning-foreground",
  success: "bg-success-muted text-success",
};

export function KpiCard({ label, value, sublabel, trend, icon: Icon, tone = "default", href, className }: KpiCardProps) {
  const TrendIcon = trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : Minus;

  const body = (
    <div
      className={cn(
        "flex h-full flex-col rounded-lg border bg-card p-4 shadow-xs transition-shadow",
        href && "hover:shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn("flex size-7 items-center justify-center rounded-md", TONE_ICON[tone])}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className={cn("tabular mt-2 text-2xl font-semibold tracking-tight", TONE_VALUE[tone])}>{value}</div>
      <div className="mt-1.5 flex min-h-4 items-center gap-1.5 text-xs">
        {trend && (
          <span
            className={cn(
              "tabular inline-flex items-center gap-0.5 font-medium",
              trend.direction === "flat" ? "text-muted-foreground" : trend.good ? "text-success" : "text-critical",
            )}
          >
            <TrendIcon className="size-3.5" />
            {trend.label}
          </span>
        )}
        {trend?.caption && <span className="text-muted-foreground">{trend.caption}</span>}
        {!trend && sublabel && <span className="text-muted-foreground">{sublabel}</span>}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
      {body}
    </Link>
  ) : (
    body
  );
}
