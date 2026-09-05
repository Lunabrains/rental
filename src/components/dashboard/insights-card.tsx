"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { SeverityDot } from "@/components/common/badges";
import type { Insight } from "@/lib/derived/insights";
import { cn } from "@/lib/utils";

/** Three to five computed insights (plan §10), each linking to the screen that proves it. */
export function InsightsCard({ insights, headline }: { insights: Insight[]; headline: string }) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-muted text-brand">
          <Sparkles className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Insights</span>
          <span className="block truncate text-sm font-semibold">{headline}</span>
        </span>
        <Link href="/briefing" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline">
          Full briefing <ArrowRight className="size-3" />
        </Link>
      </div>
      {insights.length > 0 && (
        <ol className="divide-y border-t">
          {insights.map((i) => (
            <li key={i.id}>
              <Link href={i.href} title={i.source} className={cn("flex items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/60")}>
                {i.tone === "success" ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-success" /> : <SeverityDot severity={i.tone} className="mt-1.5 shrink-0" />}
                <span className="min-w-0 flex-1 leading-snug">{i.text}</span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
