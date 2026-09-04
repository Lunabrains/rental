"use client";

import { ChevronRight } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { SeverityDot } from "@/components/common/badges";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Alert, AlertAction } from "@/types";

interface AlertRowProps {
  alert: Alert;
  /** How many action buttons to show inline. */
  maxActions?: number;
  compact?: boolean;
  onOpen?: (alert: Alert) => void;
  onDismiss?: (alert: Alert) => void;
  className?: string;
}

/** The "view" action is the row's click target; the rest become buttons. */
function splitActions(actions: AlertAction[]): { primary: AlertAction[]; view: AlertAction | null } {
  const view = actions.find((a) => a.kind.startsWith("view_")) ?? null;
  const primary = actions.filter((a) => a !== view);
  return { primary, view };
}

export function AlertRow({ alert, maxActions = 2, compact, onOpen, onDismiss, className }: AlertRowProps) {
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
        !alert.read && "border-l-2 border-l-brand",
        className,
      )}
    >
      <SeverityDot severity={alert.severity} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium leading-tight", compact ? "text-sm" : "text-sm")}>{alert.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{alert.message}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {(primary.length > 0 ? primary.slice(0, maxActions) : view ? [view] : []).map((a, i) => (
          <Button key={a.kind} size="sm" variant={i === 0 && primary.length > 0 ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => perform(a)}>
            {a.label}
          </Button>
        ))}
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
