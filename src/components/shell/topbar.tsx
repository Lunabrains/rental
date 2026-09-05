"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";

import { CommandPalette } from "@/components/shell/command-palette";

import { BellButton } from "@/components/shell/bell";
import { MobileNav } from "@/components/shell/mobile-nav";
import type { Alert } from "@/types";

interface TopbarProps {
  companyName: string;
  ownerName: string;
  criticalUnread: number;
  bellAlerts: Alert[];
  onOpenAlert?: (alert: Alert) => void;
  onMarkAllRead?: () => void;
}

export function Topbar({ companyName, ownerName, criticalUnread, bellAlerts, onOpenAlert, onMarkAllRead }: TopbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:gap-3 lg:px-6">
      <MobileNav companyName={companyName} ownerName={ownerName} alertCount={criticalUnread} />
      <form onSubmit={submit} className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setPaletteOpen(true)}
          placeholder="Search tenants, phones, units, buildings…"
          aria-label="Search"
          className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-14 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-block">⌘K</kbd>
      </form>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="ml-auto flex items-center gap-1.5">
        <BellButton count={criticalUnread} alerts={bellAlerts} onOpenAlert={onOpenAlert} onMarkAllRead={onMarkAllRead} />
        <span className="ml-1 flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-label={ownerName}>
          {ownerName.charAt(0)}
        </span>
      </div>
    </header>
  );
}
