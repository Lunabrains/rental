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

export function ActivityTab({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <EmptyState compact icon={History} title="No activity yet" />;
  }
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[e.tone])} />
          <div className="text-sm font-medium leading-tight">{e.title}</div>
          {e.detail && <div className="mt-0.5 text-xs text-muted-foreground">{e.detail}</div>}
          <div className="tabular mt-0.5 text-[11px] text-muted-foreground/80">{e.at.length > 10 ? formatDateTime(e.at) : formatDate(e.at)}</div>
        </li>
      ))}
    </ol>
  );
}
