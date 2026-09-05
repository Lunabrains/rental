"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Newspaper, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useActions } from "@/components/actions/action-provider";
import { KpiCard } from "@/components/common/kpi-card";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/data/store-context";
import { briefingAsText, getDailyBriefing, type BriefingItem, type BriefingTone } from "@/lib/derived/briefing";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT: Record<BriefingTone, string> = { critical: "bg-critical", warning: "bg-warning", attention: "bg-info", info: "bg-muted-foreground/50", success: "bg-success", neutral: "bg-muted-foreground/40" };

/** Daily owner briefing (plan §Phase 14): one page to read with the morning coffee, every line actionable. */
export function BriefingPage() {
  const store = useStore();
  const { perform } = useActions();
  const b = useMemo(() => getDailyBriefing(store), [store]);
  const [copied, setCopied] = useState(false);
  const total = b.sections.reduce((n, s) => n + s.items.length, 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(briefingAsText(b, store.settings.companyName));
      setCopied(true);
      toast.success("Briefing copied as text");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access");
    }
  }

  return (
    <div className="space-y-5 print:space-y-3">
      <PageHeader
        title={`Daily briefing — ${formatDate(b.date)}`}
        description={b.headline}
        actions={
          <>
            <Button variant="outline" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy as text</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" /> Print</Button>
          </>
        }
      />

      <section className="rounded-lg border bg-card p-4 shadow-xs">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"><Sparkles className="size-3.5 text-brand" /> In plain language</p>
        <div className="space-y-2 text-sm leading-relaxed">
          {b.narrative.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <KpiCard label="Collected this month" value={formatMoney(b.numbers.collectedThisMonth)} sublabel={`of ${formatMoney(b.numbers.dueThisMonth)} due · ${formatPercent(b.numbers.collectionRate)}`} tone={b.numbers.collectionRate >= 0.9 ? "success" : b.numbers.collectionRate >= 0.7 ? "warning" : "critical"} href="/finance/rent-roll" />
        <KpiCard label="Outstanding" value={formatMoney(b.numbers.outstanding)} sublabel="Across all tenants" tone={b.numbers.outstanding > store.settings.thresholds.outstandingWarning ? "critical" : "default"} href="/payments?status=overdue" />
        <KpiCard label="Occupancy" value={formatPercent(b.numbers.occupancy)} sublabel={`${b.numbers.criticalAlerts} critical alert${b.numbers.criticalAlerts === 1 ? "" : "s"}`} href="/alerts?severity=critical" />
        <KpiCard label="Next 30 days" value={`${b.numbers.net30 >= 0 ? "+" : ""}${formatMoney(b.numbers.net30)}`} sublabel="Net cash movement, estimated" tone={b.numbers.net30 >= 0 ? "success" : "critical"} href="/finance/cash-flow" />
      </div>

      {total === 0 && (
        <SectionCard title="Nothing on the list">
          <p className="text-sm text-muted-foreground">No decisions, no overdue rent, nothing scheduled. Enjoy it.</p>
        </SectionCard>
      )}

      <div className="grid gap-5 lg:grid-cols-2 print:grid-cols-1">
        {b.sections.map((s) => (
          <SectionCard key={s.key} title={`${s.title} · ${s.items.length}`} description={s.description} flush className={cn(s.key === "decide" && s.items.length > 0 && "lg:col-span-2 ring-1 ring-brand/30")}>
            {s.items.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">{s.key === "good_news" ? "Nothing new to celebrate yet." : "Nothing here today."}</p>
            ) : (
              <ul className="divide-y">
                {s.items.map((item) => (
                  <BriefingRow key={item.id} item={item} onAction={perform} />
                ))}
              </ul>
            )}
          </SectionCard>
        ))}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground print:hidden"><Newspaper className="size-3.5" /> Generated from the live records at {formatDate(b.date)} — every line opens the record behind it.</p>
    </div>
  );
}

function BriefingRow({ item, onAction }: { item: BriefingItem; onAction: (a: BriefingItem["actions"][number]) => void }) {
  const view = item.actions.find((a) => a.kind.startsWith("view_"));
  const primary = item.actions.filter((a) => a !== view).slice(0, 2);
  const open = view ?? primary[0];
  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm", open && "cursor-pointer hover:bg-accent/40")} onClick={() => open && onAction(open)}>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[item.tone])} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.title}</span>
        {item.detail && <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>}
      </span>
      <span className="flex shrink-0 gap-1 print:hidden" onClick={(e) => e.stopPropagation()}>
        {primary.map((a, i) => (
          <Button key={a.kind + a.targetId} size="sm" variant={i === 0 ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => onAction(a)}>
            {a.label}
          </Button>
        ))}
        {view && primary.length === 0 && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onAction(view)}>
            {view.label}
          </Button>
        )}
      </span>
    </li>
  );
}
