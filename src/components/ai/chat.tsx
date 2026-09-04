"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

import { AnswerView } from "@/components/ai/answer-view";
import { useAssistant } from "@/components/ai/assistant-context";
import { Button } from "@/components/ui/button";
import { SUGGESTED_QUESTIONS } from "@/lib/ai/scripted";
import { cn } from "@/lib/utils";

interface AssistantChatProps {
  compact?: boolean;
  className?: string;
}

export function AssistantChat({ compact, className }: AssistantChatProps) {
  const { turns, ask, busy, status, contextLabel } = useAssistant();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    void ask(q);
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("space-y-4", compact ? "p-3" : "p-4")}>
          {turns.length === 0 && (
            <div className={cn("text-center", compact ? "py-6" : "py-12")}>
              <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-brand-muted text-brand">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">Ask about anything in the portfolio</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Payments, contracts, buildings, tenants, what changed — {contextLabel ? `scoped to ${contextLabel}` : "across every building"}.
              </p>
              <div className={cn("mt-4 grid gap-1.5", compact ? "grid-cols-1" : "mx-auto max-w-2xl sm:grid-cols-2")}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => void ask(q.text)}
                    className="rounded-md border bg-card px-3 py-2 text-left text-xs hover:bg-accent"
                  >
                    {q.text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) =>
            t.role === "user" ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">{t.text}</div>
              </div>
            ) : (
              <div key={t.id} className="flex gap-2.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border bg-card px-3.5 py-2.5">
                  {t.pending ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex gap-0.5">
                        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                      </span>
                      {status ?? "Thinking…"}
                    </div>
                  ) : t.error ? (
                    <p className="text-sm text-critical">{t.error}</p>
                  ) : t.answer ? (
                    <AnswerView answer={t.answer} compact={compact} />
                  ) : null}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      </div>

      {turns.length > 0 && !busy && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-t px-3 py-2">
          {SUGGESTED_QUESTIONS.slice(0, compact ? 3 : 6).map((q) => (
            <button key={q.id} type="button" onClick={() => void ask(q.text)} className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              {q.text}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className={cn("flex items-center gap-2 border-t bg-card", compact ? "p-2" : "p-3")}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={contextLabel ? `Ask about ${contextLabel}…` : "Ask anything about the portfolio…"}
          aria-label="Ask the assistant"
          disabled={busy}
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-60"
        />
        <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Send">
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </div>
  );
}
