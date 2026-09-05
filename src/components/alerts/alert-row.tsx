"use client";

import { AlarmClock, ChevronRight } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { SeverityDot } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Alert, AlertAction } from "@/types";

interface AlertRowProps {
  alert: Alert;
  /** How many action buttons to show inline. */
  maxActions?: number;
  compact?: boolean;
  onOpen?: (alert: Alert) => void;
  onDismiss?: (alert: Alert) => void;
  /** Hide for N days; shown as a small clock menu. */
  onSnooze?: (alert: Alert, days: number) => void;
  /** Mark handled (or reopen when already resolved). */
  onResolve?: (alert: Alert) => void;
  /** Bring a snoozed alert back now. */
  onWake?: (alert: Alert) => void;
  className?: string;
}

/** The "view" action is the row's click target; the rest become buttons. */
function splitActions(actions: AlertAction[]): { primary: AlertAction[]; view: AlertAction | null } {
  const view = actions.find((a) => a.kind.startsWith("view_")) ?? null;
  const primary = actions.filter((a) => a !== view);
  return { primary, view };
}

export function AlertRow({ alert, maxActions = 2, compact, onOpen, onDismiss, onSnooze, onResolve, onWake, className }: AlertRowProps) {
  const { perform } = useActions();
  const { primary, view } = splitActions(alert.actions);

  function open() {
    if (onOpen) return onOpen(alert);
    if (view) perform(view);
    else if (primary[0]) perform(primary[0]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "group flex items-center gap-3 rounded-md border bg-card px-3 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/30",
        compact ? "py-2.5" : "py-3",
        !alert.read && !alert.resolved && !alert.dismissed && "border-l-2 border-l-brand",
        className,
      )}
    >
      <SeverityDot severity={alert.severity} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium leading-tight", compact ? "text-sm" : "text-sm")}>{alert.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {alert.message}
          {alert.snoozedUntil && <span className="ml-2 text-warning-foreground">· snoozed until {formatDate(alert.snoozedUntil)}</span>}
          {alert.resolved && alert.resolvedAt && <span className="ml-2 text-success">· resolved {formatDate(alert.resolvedAt.slice(0, 10))}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {(primary.length > 0 ? primary.slice(0, maxActions) : view ? [view] : []).map((a, i) => (
          <Button key={a.kind} size="sm" variant={i === 0 && primary.length > 0 ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => perform(a)}>
            {a.label}
          </Button>
        ))}
        {onResolve && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onResolve(alert)}>
            {alert.resolved ? "Reopen" : "Resolve"}
          </Button>
        )}
        {onWake && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onWake(alert)}>
            Wake
          </Button>
        )}
        {onSnooze && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground" aria-label="Snooze">
                <AlarmClock className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSnooze(alert, 1)}>Until tomorrow</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSnooze(alert, 7)}>For a week</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSnooze(alert, 30)}>For a month</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {onDismiss && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onDismiss(alert)}>
            Dismiss
          </Button>
        )}
        <ChevronRight className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" onClick={open} />
      </div>
    </div>
  );
}
