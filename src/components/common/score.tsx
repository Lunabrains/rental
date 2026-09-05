"use client";

import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { HealthComponent, ReliabilityComponent } from "@/lib/derived/metrics";
import { cn } from "@/lib/utils";

/**
 * Scores are never shown without their reasoning: the badge opens the
 * component breakdown, and the breakdown can also be rendered inline.
 */

export function scoreTone(score: number | null): "success" | "warning" | "critical" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 85) return "success";
  if (score >= 65) return "warning";
  return "critical";
}

const TONE_TEXT = { success: "text-success", warning: "text-warning-foreground", critical: "text-critical", neutral: "text-muted-foreground" } as const;
const TONE_BAR = { success: "bg-success", warning: "bg-warning", critical: "bg-critical", neutral: "bg-muted-foreground/40" } as const;

interface BreakdownProps {
  score: number | null;
  label?: string;
  components: (HealthComponent | ReliabilityComponent)[];
  /** Health components are 0–100; reliability components are 0–1. */
  scale?: 100 | 1;
  caption?: string;
  className?: string;
}

export function ScoreBreakdown({ score, label, components, scale = 100, caption, className }: BreakdownProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label ?? "Score"}</span>
        <span className={cn("tabular text-2xl font-semibold", TONE_TEXT[scoreTone(score)])}>{score === null ? "—" : `${score}/100`}</span>
      </div>
      {components.length === 0 ? (
        <p className="text-xs text-muted-foreground">{caption ?? "Not enough history to score yet."}</p>
      ) : (
        <ul className="space-y-1.5">
          {components.map((c) => {
            const pct = Math.round(scale === 1 ? c.score * 100 : c.score);
            return (
              <li key={c.key} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {c.label} <span className="text-muted-foreground">· {c.weight}%</span>
                  </span>
                  <span className={cn("tabular font-medium", TONE_TEXT[scoreTone(pct)])}>{pct}/100</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", TONE_BAR[scoreTone(pct)])} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-0.5 text-muted-foreground">{c.detail}</div>
              </li>
            );
          })}
        </ul>
      )}
      {caption && components.length > 0 && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}

export function ScoreBadge({ score, label, components, scale, caption, size = "md", className }: BreakdownProps & { size?: "sm" | "md" | "lg" }) {
  const tone = scoreTone(score);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border bg-card font-semibold tabular transition-colors hover:bg-accent",
            size === "sm" ? "h-6 px-1.5 text-xs" : size === "lg" ? "h-9 px-3 text-lg" : "h-7 px-2 text-sm",
            TONE_TEXT[tone],
            className,
          )}
          aria-label={`${label ?? "Score"} ${score ?? "not available"} — show breakdown`}
        >
          {score === null ? "—" : score}
          <Info className="size-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <ScoreBreakdown score={score} label={label} components={components} scale={scale} caption={caption} />
      </PopoverContent>
    </Popover>
  );
}
