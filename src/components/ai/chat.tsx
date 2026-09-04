"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Mic, MicOff, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { AnswerView } from "@/components/ai/answer-view";
import { useAssistant } from "@/components/ai/assistant-context";
import { useVoice } from "@/components/ai/use-voice";
import { Button } from "@/components/ui/button";
import { SUGGESTED_QUESTIONS } from "@/lib/ai/scripted";
import { cn } from "@/lib/utils";

interface AssistantChatProps {
  compact?: boolean;
  className?: string;
}

export function AssistantChat({ compact, className }: AssistantChatProps) {
  const { turns, ask, busy, status, contextLabel, speakReplies, setSpeakReplies, speaking, stopSpeaking, speakSupported } = useAssistant();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const voice = useVoice({
    onFinal: (text) => {
      setDraft("");
      void ask(text, { spoken: true });
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  useEffect(() => {
    if (voice.error) toast.error(voice.error);
  }, [voice.error]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    void ask(q);
  }

  function onMic() {
    if (!voice.supported) {
      toast.error("Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }
    if (busy) return;
    stopSpeaking();
    voice.toggle();
  }

  const inputValue = voice.listening ? voice.interim : draft;

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
                Payments, contracts, buildings, tenants, what changed — {contextLabel ? `scoped to ${contextLabel}` : "across every building"}. Type, or tap the mic and just talk.
              </p>
              <div className={cn("mt-4 grid gap-1.5", compact ? "grid-cols-1" : "mx-auto max-w-2xl sm:grid-cols-2")}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button key={q.id} type="button" onClick={() => void ask(q.text)} className="rounded-md border bg-card px-3 py-2 text-left text-xs hover:bg-accent">
                    {q.text}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onMic}
                disabled={busy}
                className={cn(
                  "mx-auto mt-5 flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-medium shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  voice.listening ? "bg-foreground text-background" : "bg-brand text-brand-foreground",
                )}
              >
                <span className="relative flex size-6 items-center justify-center">
                  {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-background/40" />}
                  {voice.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                </span>
                {voice.listening ? "Listening… tap to stop" : "Tap to talk"}
              </button>
              {voice.listening && voice.interim && <p className="mt-2 text-sm italic text-muted-foreground">“{voice.interim}”</p>}
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

      {turns.length > 0 && !busy && !turns[turns.length - 1]?.answer?.suggestions?.length && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-t px-3 py-2">
          {SUGGESTED_QUESTIONS.slice(0, compact ? 3 : 6).map((q) => (
            <button key={q.id} type="button" onClick={() => void ask(q.text)} className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              {q.text}
            </button>
          ))}
        </div>
      )}

      {voice.listening && turns.length > 0 && (
        <div className="flex items-center gap-2 border-t bg-brand-muted/60 px-3 py-2 text-xs">
          <span className="relative flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/60" />
            <span className="relative size-2.5 rounded-full bg-brand" />
          </span>
          <span className="font-medium text-foreground">Listening…</span>
          <span className="truncate italic text-muted-foreground">{voice.interim || "speak now"}</span>
        </div>
      )}
      <form onSubmit={submit} className={cn("flex items-center gap-2 border-t bg-card", compact ? "p-2" : "p-3")}>
        <Button
          type="button"
          size="icon"
          variant={voice.listening ? "default" : "outline"}
          onClick={onMic}
          disabled={busy}
          aria-label={voice.listening ? "Stop listening" : "Ask by voice"}
          aria-pressed={voice.listening}
          className={cn(
            "relative shrink-0",
            voice.listening ? "bg-brand text-brand-foreground hover:bg-brand/90" : voice.supported ? "border-brand/50 text-brand hover:bg-brand-muted" : "text-muted-foreground",
          )}
          title={voice.supported ? "Ask by voice — tap and talk" : "Voice input not supported here"}
        >
          {voice.listening ? <Square className="size-3.5 fill-current" /> : voice.supported ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {voice.listening && <span className="absolute inset-0 -z-10 animate-ping rounded-md bg-brand/50" />}
        </Button>
        <input
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={voice.listening}
          placeholder={voice.listening ? "Listening… speak now" : contextLabel ? `Ask about ${contextLabel}…` : "Ask anything about the portfolio…"}
          aria-label="Ask the assistant"
          disabled={busy}
          className={cn(
            "h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:opacity-60",
            voice.listening && "border-brand/60 italic text-muted-foreground",
          )}
        />
        {!compact && speakSupported && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => (speaking ? stopSpeaking() : setSpeakReplies(!speakReplies))}
            aria-label={speaking ? "Stop speaking" : speakReplies ? "Stop reading answers aloud" : "Read answers aloud"}
            aria-pressed={speakReplies}
            className={cn("shrink-0", speakReplies && "border-brand text-brand")}
            title={speakReplies ? "Answers are read aloud" : "Read answers aloud"}
          >
            {speaking ? <Square className="size-3.5 fill-current" /> : speakReplies ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </Button>
        )}
        <Button type="submit" size="icon" disabled={busy || !draft.trim() || voice.listening} aria-label="Send">
          <ArrowUp className="size-4" />
        </Button>
      </form>
    </div>
  );
}
