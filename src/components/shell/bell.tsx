"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SeverityDot } from "@/components/common/badges";
import type { Alert } from "@/types";

interface BellButtonProps {
  /** Unread critical count shown on the badge. */
  count: number;
  /** Most urgent unread alerts for the dropdown (already sorted). */
  alerts: Alert[];
  onOpenAlert?: (alert: Alert) => void;
  onMarkAllRead?: () => void;
}

export function BellButton({ count, alerts, onOpenAlert, onMarkAllRead }: BellButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`${count} unread critical alerts`}>
          <Bell className="size-4.5" />
          {count > 0 && (
            <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-brand-foreground ring-2 ring-background">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">Alerts</DropdownMenuLabel>
          {count > 0 && onMarkAllRead && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        {alerts.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto py-1">
            {alerts.map((alert) => (
              <DropdownMenuItem
                key={alert.id}
                onSelect={() => onOpenAlert?.(alert)}
                className="items-start gap-2.5 px-3 py-2.5"
              >
                <SeverityDot severity={alert.severity} className="mt-1.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium leading-tight">{alert.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{alert.message}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
        <DropdownMenuSeparator className="m-0" />
        <Link
          href="/alerts"
          className="block px-3 py-2.5 text-center text-sm font-medium text-brand hover:bg-accent"
        >
          View all alerts
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
