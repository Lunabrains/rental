"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Sparkles, Trash2, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";

import { AssistantContext, type AskOptions, type AssistantContextValue } from "@/components/ai/assistant-context";
import { AssistantChat } from "@/components/ai/chat";
import { speak, speechSupported, stopSpeaking as stopSynth, warmVoices } from "@/components/ai/use-voice";
import { Button } from "@/components/ui/button";
import { askAssistant } from "@/lib/ai/client";
import type { AssistantAnswer, ChatTurn, PageContext } from "@/lib/ai/types";
import { indexStore } from "@/lib/data/store";
import { useStoreContext } from "@/lib/data/store-context";
import { cn } from "@/lib/utils";

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/** What gets read aloud: the sentence, the recommendation, and a hint that details are on screen. */
export function spokenText(a: AssistantAnswer): string {
  const parts = [a.text];
  if (a.recommendation) parts.push(`Recommendation: ${a.recommendation}`);
  if (a.table && a.table.rows.length > 0) parts.push(`I've listed ${a.table.rows.length} ${a.table.rows.length === 1 ? "item" : "items"} on screen.`);
  return parts
    .join(" ")
    .replace(/\$(\d[\d,]*)/g, "$1 dollars")
    .replace(/—/g, ",")
    .replace(/·/g, ",");
}

/**
 * The assistant lives above every page: one conversation, aware of the
 * building / tenant / unit on screen, reachable from the floating button or
 * the full /ai page. It listens and talks back through the browser's own
 * speech APIs.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { store, status: loadStatus } = useStoreContext();
  const pathname = usePathname();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechCompletedCount, setSpeechCompletedCount] = useState(0);
  const [speakSupported] = useState(() => speechSupported().speak);
  const storeRef = useRef(store);
  storeRef.current = store;
  const speakRepliesRef = useRef(speakReplies);
  speakRepliesRef.current = speakReplies;
  // Distinguishes "the answer finished" from "the user hit Stop".
  const stoppedByUserRef = useRef(false);

  useEffect(() => {
    warmVoices();
    return () => stopSynth();
  }, []);

  const context = useMemo<PageContext>(() => {
    const idx = indexStore(store);
    const ctx: PageContext = { pathname };
    const prop = /^\/properties\/([^/?#]+)/.exec(pathname);
    if (prop) {
      const p = idx.propertyById.get(decodeURIComponent(prop[1]));
      if (p) {
        ctx.propertyId = p.id;
        ctx.propertyName = p.name;
      }
    }
    const tenant = /^\/tenants\/([^/?#]+)/.exec(pathname);
    if (tenant) ctx.tenantId = decodeURIComponent(tenant[1]);
    if (typeof window !== "undefined") {
      const unit = new URLSearchParams(window.location.search).get("unit");
      if (unit && idx.unitById.has(unit)) ctx.unitId = unit;
    }
    return ctx;
  }, [pathname, store]);

  const stopSpeaking = useCallback(() => {
    stoppedByUserRef.current = true;
    stopSynth();
    setSpeaking(false);
  }, []);

  const say = useCallback((answer: AssistantAnswer) => {
    stoppedByUserRef.current = false;
    // `onstart` is unreliable in some engines; mark speaking as soon as the
    // utterance is queued and let onend/onerror (or Stop) clear it.
    const ok = speak(spokenText(answer), {
      onStart: () => setSpeaking(true),
      onEnd: () => {
        setSpeaking(false);
        if (!stoppedByUserRef.current) setSpeechCompletedCount((n) => n + 1);
      },
    });
    setSpeaking(ok);
  }, []);

  const ask = useCallback(
    async (question: string, opts: AskOptions = {}) => {
      const q = question.trim();
      if (!q || loadStatus.state !== "ready") return;
      stoppedByUserRef.current = true;
      stopSynth();
      setSpeaking(false);
      const userTurn: ChatTurn = { id: nextId(), role: "user", text: q };
      const pendingId = nextId();
      setTurns((t) => [...t, userTurn, { id: pendingId, role: "assistant", pending: true }]);
      setBusy(true);
      setStatus(null);
      try {
        let answer = await askAssistant({
          question: q,
          history: turns,
          store: storeRef.current,
          context,
          onStatus: setStatus,
        });
        if (opts.spoken && answer.source === "fallback") {
          // Show the speaker what was actually heard, so a mis-transcription is obvious.
          answer = { ...answer, text: `I heard “${q}”. ${answer.text}` };
        }
        setTurns((t) => t.map((x) => (x.id === pendingId ? { id: pendingId, role: "assistant", answer } : x)));
        if (opts.spoken || speakRepliesRef.current) say(answer);
      } catch (err) {
        setTurns((t) => t.map((x) => (x.id === pendingId ? { id: pendingId, role: "assistant", error: err instanceof Error ? err.message : String(err) } : x)));
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [context, loadStatus.state, turns, say],
  );

  const clear = useCallback(() => {
    stoppedByUserRef.current = true;
    stopSynth();
    setSpeaking(false);
    setTurns([]);
  }, []);

  const toggleSpeak = useCallback((on: boolean) => {
    setSpeakReplies(on);
    if (!on) {
      stoppedByUserRef.current = true;
      stopSynth();
      setSpeaking(false);
    }
  }, []);

  const value = useMemo<AssistantContextValue>(
    () => ({
      turns,
      busy,
      status,
      contextLabel: context.propertyName ?? null,
      ask,
      clear,
      open,
      setOpen,
      speakReplies,
      setSpeakReplies: toggleSpeak,
      speaking,
      stopSpeaking,
      speakSupported,
      speechCompletedCount,
    }),
    [turns, busy, status, context.propertyName, ask, clear, open, speakReplies, toggleSpeak, speaking, stopSpeaking, speakSupported, speechCompletedCount],
  );

  const onAiPage = pathname === "/ai";

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {!onAiPage && loadStatus.state === "ready" && (
        <>
          {open && (
            <div
              role="dialog"
              aria-label="AI assistant"
              className="fixed bottom-20 right-4 z-40 flex h-[min(640px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-brand text-brand-foreground">
                  <Sparkles className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-tight">Assistant</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{context.propertyName ? `Scoped to ${context.propertyName}` : "Whole portfolio"}</span>
                </span>
                {speakSupported && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className={cn("size-7", speakReplies && "text-brand")}
                    aria-label={speakReplies ? "Stop reading answers aloud" : "Read answers aloud"}
                    aria-pressed={speakReplies}
                    onClick={() => toggleSpeak(!speakReplies)}
                  >
                    {speakReplies ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                  </Button>
                )}
                {turns.length > 0 && (
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Clear conversation" onClick={clear}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="size-7" aria-label="Open full page" asChild>
                  <Link href="/ai" onClick={() => setOpen(false)}>
                    <Maximize2 className="size-3.5" />
                  </Link>
                </Button>
                <Button size="icon" variant="ghost" className="size-7" aria-label="Close" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <AssistantChat compact />
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close assistant" : "Open assistant"}
            aria-expanded={open}
            className={cn(
              "fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2 rounded-full pl-4 pr-5 text-sm font-medium shadow-lg transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              open ? "bg-foreground text-background" : "bg-brand text-brand-foreground",
            )}
          >
            <Sparkles className="size-4" />
            {open ? "Close" : "Ask"}
          </button>
        </>
      )}
    </AssistantContext.Provider>
  );
}
