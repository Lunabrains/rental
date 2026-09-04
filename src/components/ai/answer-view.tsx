"use client";

import { Lightbulb } from "lucide-react";

import { useActions } from "@/components/actions/action-provider";
import { useAssistant } from "@/components/ai/assistant-context";
import { Button } from "@/components/ui/button";
import type { AssistantAnswer } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

export function AnswerView({ answer, compact }: { answer: AssistantAnswer; compact?: boolean }) {
  const { perform } = useActions();
  const { ask, busy } = useAssistant();
  const rtl = answer.lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const rowLimit = compact ? 8 : 20;

  return (
    <div className="space-y-3" dir={dir}>
      {answer.text && <p className="text-sm leading-relaxed">{answer.text}</p>}

      {answer.table && answer.table.rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-xs" dir={dir}>
            <thead className="bg-muted/50 text-start text-[11px] text-muted-foreground">
              <tr>
                {answer.table.columns.map((c, i) => (
                  <th key={i} className={cn("px-2.5 py-1.5 text-start font-medium", typeof answer.table!.rows[0]?.[i] === "number" && "text-end")}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular">
              {answer.table.rows.slice(0, rowLimit).map((r, ri) => (
                <tr key={ri} className="border-t">
                  {r.map((cell, ci) => (
                    <td key={ci} dir="auto" className={cn("px-2.5 py-1.5 text-start align-top", typeof cell === "number" && "text-end", ci === 0 && "font-medium")}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {answer.table.rows.length > rowLimit && (
            <div className="border-t px-2.5 py-1 text-[11px] text-muted-foreground">+{answer.table.rows.length - rowLimit}</div>
          )}
        </div>
      )}

      {answer.cards && answer.cards.length > 0 && (
        <div className={cn("grid gap-2", !compact && answer.cards.length > 1 && "sm:grid-cols-2")}>
          {answer.cards.map((card, i) => (
            <div key={i} className="rounded-md border bg-card p-3">
              <div className="text-sm font-semibold leading-tight" dir="auto">
                {card.title}
              </div>
              {card.subtitle && (
                <div className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                  {card.subtitle}
                </div>
              )}
              <dl className="mt-2 space-y-1">
                {card.fields.map(([k, v], j) => (
                  <div key={j} className="flex gap-2 text-xs">
                    <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 flex-1" dir="auto">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {answer.recommendation && (
        <div className="flex items-start gap-2 rounded-md bg-brand-muted/70 px-3 py-2 text-xs text-foreground">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" />
          <span>
            <span className="font-medium">{rtl ? "التوصية: " : "Recommendation: "}</span>
            {answer.recommendation}
          </span>
        </div>
      )}

      {answer.actions && answer.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.actions.map((a, i) => (
            <Button key={`${a.kind}-${a.targetId}-${i}`} size="sm" variant={i === 0 ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => perform(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}

      {answer.suggestions && answer.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {answer.suggestions.slice(0, compact ? 3 : 6).map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => void ask(s, { lang: answer.lang })}
              className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
