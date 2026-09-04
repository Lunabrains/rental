"use client";

import Link from "next/link";
import { Building } from "lucide-react";

import { SidebarNav } from "@/components/shell/sidebar-nav";

interface SidebarProps {
  companyName: string;
  ownerName: string;
  /** Unread critical alerts — shown next to "Alerts". */
  alertCount: number;
}

export function Brand({ companyName }: { companyName: string }) {
  return (
    <Link href="/dashboard" className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
      <span className="flex size-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
        <Building className="size-4" strokeWidth={2.25} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">{companyName}</span>
        <span className="block text-[11px] leading-tight text-muted-foreground">Command Center</span>
      </span>
    </Link>
  );
}

export function OwnerCard({ ownerName }: { ownerName: string }) {
  return (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{ownerName.charAt(0)}</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium leading-tight">{ownerName}</span>
          <span className="block text-[11px] leading-tight text-muted-foreground">Owner</span>
        </span>
      </div>
    </div>
  );
}

export function Sidebar({ companyName, ownerName, alertCount }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <Brand companyName={companyName} />
      <SidebarNav alertCount={alertCount} />
      <OwnerCard ownerName={ownerName} />
    </aside>
  );
}
