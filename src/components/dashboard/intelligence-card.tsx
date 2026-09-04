"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import type { IntelligenceBrief } from "@/lib/derived/intelligence";
import { cn } from "@/lib/utils";

export function IntelligenceCard({ brief }: { brief: IntelligenceBrief }) {
  const [open, setOpen] = useState(true);

  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-muted text-brand">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Portfolio Intelligence</span>
          <span className="block truncate text-sm font-semibold">{brief.headline}</span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_minmax(16rem,20rem)]">
            <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
              {brief.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {brief.actions.length > 0 && (
              <div className="rounded-md bg-muted/50 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Today</div>
                <ol className="mt-2 space-y-2 text-sm">
                  {brief.actions.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">{i + 1}</span>
                      <span className="leading-snug">{a}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
