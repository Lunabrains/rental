"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS } from "@/components/shell/nav";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  alertCount: number;
  onNavigate?: () => void;
}

/** The navigation list shared by the desktop sidebar and the mobile sheet. */
export function SidebarNav({ alertCount, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className={cn(gi > 0 && "mt-5")}>
          {group.label && (
            <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group.label}</div>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.match ? item.match(pathname) : pathname === item.href;
              const Icon = item.icon;
              const badge = item.href === "/alerts" && alertCount > 0 ? alertCount : null;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                      active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                    )}
                  >
                    {active && <span className="absolute -left-3 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-brand" />}
                    <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} strokeWidth={active ? 2.25 : 2} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== null && (
                      <span className="tabular rounded-full bg-brand px-1.5 py-px text-[11px] font-semibold leading-4 text-brand-foreground">{badge}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
