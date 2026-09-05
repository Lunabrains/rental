import { History } from "lucide-react";

import { EmptyState } from "@/components/common/states";
import { formatDate, formatDateTime } from "@/lib/format";
import type { TimelineEvent, TimelineTone } from "@/lib/queries";
import { cn } from "@/lib/utils";

const DOT: Record<TimelineTone, string> = {
  default: "bg-muted-foreground/50",
  success: "bg-success",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
};

interface TimelineProps {
  events: TimelineEvent[];
  emptyTitle?: string;
  className?: string;
  /** Render at most this many events. */
  limit?: number;
  onSelect?: (event: TimelineEvent) => void;
}

/**
 * The reusable history list: buildings, units, tenants, contracts, assets,
 * work orders and renovations all tell their story through it.
 */
export function Timeline({ events, emptyTitle = "No activity yet", className, limit, onSelect }: TimelineProps) {
  const list = limit ? events.slice(0, limit) : events;
  if (list.length === 0) {
    return <EmptyState compact icon={History} title={emptyTitle} />;
  }
  return (
    <ol className={cn("relative space-y-4 border-l pl-5", className)}>
      {list.map((e) => (
        <li key={e.id} className={cn("relative", onSelect && "cursor-pointer")} onClick={onSelect ? () => onSelect(e) : undefined}>
          <span className={cn("absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[e.tone])} />
          <div className="text-sm font-medium leading-tight">{e.title}</div>
          {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
          <div className="tabular mt-0.5 text-[11px] text-muted-foreground/80">{e.at.length > 10 ? formatDateTime(e.at) : formatDate(e.at)}</div>
        </li>
      ))}
      {limit && events.length > limit && <li className="text-[11px] text-muted-foreground">+{events.length - limit} earlier events</li>}
    </ol>
  );
}
