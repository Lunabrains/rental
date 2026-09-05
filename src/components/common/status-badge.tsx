import { labelize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One badge for every operational status in the system. Tones come from the
 * design system (success / warning / critical / info / neutral) so a "closed"
 * work order, a "paid" invoice and a "settled" deposit all read the same way.
 */

export type BadgeTone = "success" | "warning" | "critical" | "info" | "neutral" | "brand";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning-foreground border-warning/30",
  critical: "bg-critical-muted text-critical border-critical/20",
  info: "bg-info-muted text-info border-info/20",
  neutral: "bg-muted text-muted-foreground border-border",
  brand: "bg-brand-muted text-brand border-brand-border",
};

const TONES: Record<string, BadgeTone> = {
  // work orders
  open: "info",
  assigned: "info",
  awaiting_quote: "warning",
  awaiting_approval: "warning",
  in_progress: "brand",
  completed: "success",
  closed: "neutral",
  cancelled: "neutral",
  // priorities
  low: "neutral",
  normal: "info",
  high: "warning",
  emergency: "critical",
  // money
  paid: "success",
  unpaid: "critical",
  scheduled: "neutral",
  partial: "warning",
  overdue: "critical",
  due: "info",
  waived: "neutral",
  // assets / plans
  operational: "success",
  degraded: "warning",
  out_of_service: "critical",
  retired: "neutral",
  due_soon: "warning",
  paused: "neutral",
  none: "neutral",
  active: "success",
  inactive: "neutral",
  delayed: "warning",
  over_budget: "critical",
  // inspections
  pass: "success",
  fail: "critical",
  attention: "warning",
  na: "neutral",
  // renovations
  planned: "info",
  on_hold: "warning",
  // deposits
  pending: "warning",
  held: "info",
  settled: "success",
  // keys / parking
  in_office: "neutral",
  issued: "info",
  returned: "success",
  lost: "critical",
  free: "success",
  reserved: "info",
  unavailable: "neutral",
  // renewal
  not_due: "neutral",
  upcoming: "info",
  awaiting_decision: "warning",
  renew: "success",
  do_not_renew: "critical",
  renewed: "neutral",
  ended: "neutral",
  // condition
  good: "success",
  fair: "info",
  needs_work: "warning",
  poor: "critical",
  // scores
  excellent: "success",
  reliable: "success",
  watch: "warning",
  high_attention: "critical",
  insufficient_data: "neutral",
  // classification
  operating: "neutral",
  capex: "brand",
  // property
  under_renovation: "warning",
  sold: "neutral",
};

const LABELS: Record<string, string> = {
  na: "N/A",
  capex: "CapEx",
  in_office: "In office",
  high_attention: "High attention",
};

export function toneFor(value: string): BadgeTone {
  return TONES[value.toLowerCase().replace(/\s+/g, "_")] ?? "neutral";
}

export function StatusBadge({ value, label, tone, className, dot }: { value: string; label?: string; tone?: BadgeTone; className?: string; dot?: boolean }) {
  const key = value.toLowerCase().replace(/\s+/g, "_");
  const t = tone ?? toneFor(key);
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none", TONE_CLASS[t], className)}>
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", t === "neutral" ? "bg-muted-foreground/60" : "bg-current")} />}
      {label ?? LABELS[key] ?? labelize(key)}
    </span>
  );
}

/** Priority badge with the emergency one made loud. */
export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  return <StatusBadge value={priority} className={cn(priority === "emergency" && "animate-pulse", className)} dot />;
}
