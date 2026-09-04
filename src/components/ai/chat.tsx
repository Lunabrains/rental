"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Mic, MicOff, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { AnswerView } from "@/components/ai/answer-view";
import { useAssistant } from "@/components/ai/assistant-context";
import { useVoice } from "@/components/ai/use-voice";
import { Button } from "@/components/ui/button";
import { strings, type Lang } from "@/lib/ai/i18n";
import { suggestedQuestions } from "@/lib/ai/scripted";
import { cn } from "@/lib/utils";

interface AssistantChatProps {
  compact?: boolean;
  className?: string;
}

const RECOGNITION_LANG: Record<Lang, string> = { en: "en-US", ar: "ar-LB" };

/**
 * Voice conversation: tap the mic once, talk (English or Arabic — pick the
 * language next to the mic), pause — the question is sent and answered aloud
 * in the same language, then the mic opens again on its own. Say "stop" /
 * «وقف» or tap the mic to end.
 */
export function AssistantChat({ compact, className }: AssistantChatProps) {
  const { turns, ask, busy, status, contextLabel, speakReplies, setSpeakReplies, speaking, stopSpeaking, speakSupported, speechCompletedCount, voiceLang, setVoiceLang } = useAssistant();
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const noSpeechRef = useRef(0);
  const manualStopRef = useRef(false);
  const awaitingResumeRef = useRef(false);
  const lastCompletedRef = useRef(speechCompletedCount);
  const ui = strings(voiceLang).ui;
  const suggestions = suggestedQuestions(voiceLang);
  const dir = voiceLang === "ar" ? "rtl" : "ltr";

  const voice = useVoice({
    lang: RECOGNITION_LANG[voiceLang],
    onFinal: (text) => {
      noSpeechRef.current = 0;
      manualStopRef.current = false;
      awaitingResumeRef.current = true;
      setDraft("");
      void ask(text, { spoken: true });
    },
    onIdle: (reason) => {
      if (reason === "end-phrase") {
        setConversation(false);
        toast(voiceLang === "ar" ? "تمام — توقفت عن الاستماع." : "Okay — I'll stop listening.", { description: voiceLang === "ar" ? "اضغط الميكروفون عندما تريد التحدث مجدداً." : "Tap the mic whenever you want to talk again." });
        return;
      }
      if (reason === "no-speech" && !manualStopRef.current) {
        noSpeechRef.current += 1;
        if (noSpeechRef.current >= 2) {
          setConversation(false);
          noSpeechRef.current = 0;
          toast(voiceLang === "ar" ? "لم أسمع شيئاً." : "I didn't hear anything.", { description: voiceLang === "ar" ? "اضغط الميكروفون عندما تكون جاهزاً." : "Tap the mic when you're ready." });
        } else {
          // One quiet spell: keep the conversation open and listen again.
          setTimeout(() => startRef.current(), 250);
        }
        return;
      }
      manualStopRef.current = false;
      setConversation(false);
    },
  });
  const startRef = useRef(voice.start);
  useEffect(() => {
    startRef.current = voice.start;
  }, [voice.start]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  useEffect(() => {
    if (voice.error) toast.error(voice.error);
  }, [voice.error]);

  // After the assistant has spoken its answer, open the mic again.
  useEffect(() => {
    const completed = speechCompletedCount !== lastCompletedRef.current;
    lastCompletedRef.current = speechCompletedCount;
    if (!conversation || !awaitingResumeRef.current) return;
    if (busy || speaking || voice.listening) return;
    if (completed || !speakSupported) {
      awaitingResumeRef.current = false;
      startRef.current();
    }
  }, [speechCompletedCount, conversation, busy, speaking, voice.listening, speakSupported]);

  // Unmount / panel close: never leave the mic open.
  const { cancel: cancelVoice } = voice;
  useEffect(() => () => cancelVoice(), [cancelVoice]);

  const onMic = useCallback(() => {
    if (!voice.supported) {
      toast.error(voiceLang === "ar" ? "الإدخال الصوتي غير مدعوم في هذا المتصفح — جرّب Chrome أو Edge." : "Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }
    if (voice.listening) {
      manualStopRef.current = true;
      voice.stop();
      return;
    }
    if (busy) return;
    if (speaking) stopSpeaking();
    noSpeechRef.current = 0;
    setConversation(true);
    voice.start();
  }, [voice, busy, speaking, stopSpeaking, voiceLang]);

  function switchLang(lang: Lang) {
    if (lang === voiceLang) return;
    if (voice.listening) voice.cancel();
    setConversation(false);
    setVoiceLang(lang);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    if (voice.listening) voice.cancel();
    setConversation(false);
    setDraft("");
    void ask(q);
  }

  const inputValue = voice.listening ? voice.interim : draft;
  const showVoiceBanner = conversation && (voice.listening || speaking) && turns.length > 0;

  const langToggle = (
    <div className="flex rounded-md border bg-card p-0.5 text-[11px]" role="radiogroup" aria-label="Voice language">
      {(["en", "ar"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={voiceLang === l}
          onClick={() => switchLang(l)}
          className={cn("rounded px-2 py-1 font-medium transition-colors", voiceLang === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {l === "en" ? "EN" : "عربي"}
        </button>
      ))}
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("space-y-4", compact ? "p-3" : "p-4")}>
          {turns.length === 0 && (
            <div className={cn("text-center", compact ? "py-6" : "py-12")} dir={dir}>
              <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-brand-muted text-brand">
                <Sparkles className="size-5" />
              </span>
              <p className="mt-3 text-sm font-medium">{voiceLang === "ar" ? "اسأل عن أي شيء في المحفظة" : "Ask about anything in the portfolio"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {voiceLang === "ar"
                  ? `الدفعات، العقود، المباني، المستأجرون، ما تغيّر — ${contextLabel ? `ضمن ${contextLabel}` : "في كل المباني"}. اكتب، أو اضغط الميكروفون وتكلم بالعربي.`
                  : `Payments, contracts, buildings, tenants, what changed — ${contextLabel ? `scoped to ${contextLabel}` : "across every building"}. Type, or tap the mic and just talk.`}
              </p>
              <div className={cn("mt-4 grid gap-1.5", compact ? "grid-cols-1" : "mx-auto max-w-2xl sm:grid-cols-2")}>
                {suggestions.map((q) => (
                  <button key={q.id} type="button" onClick={() => void ask(q.text, { lang: voiceLang })} className="rounded-md border bg-card px-3 py-2 text-start text-xs hover:bg-accent">
                    {q.text}
                  </button>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onMic}
                  disabled={busy}
                  className={cn(
                    "flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-medium shadow-md transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    voice.listening ? "bg-foreground text-background" : "bg-brand text-brand-foreground",
                  )}
                >
                  <span className="relative flex size-6 items-center justify-center">
                    {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-background/40" />}
                    {voice.listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                  </span>
                  {voice.listening ? ui.listeningPause : ui.tapToTalk}
                </button>
                {langToggle}
              </div>
              {voice.listening && <p className="mt-2 min-h-5 text-sm italic text-muted-foreground">{voice.interim ? `“${voice.interim}”` : voiceLang === "ar" ? "تكلم الآن" : "speak now"}</p>}
            </div>
          )}

          {turns.map((t) =>
            t.role === "user" ? (
              <div key={t.id} className="flex justify-end">
                <div dir="auto" className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                  {t.text}
                </div>
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
                      {status ?? (voiceLang === "ar" ? "أفكر…" : "Thinking…")}
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

      {turns.length > 0 && !busy && !showVoiceBanner && !turns[turns.length - 1]?.answer?.suggestions?.length && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-t px-3 py-2" dir={dir}>
          {suggestions.slice(0, compact ? 3 : 6).map((q) => (
            <button key={q.id} type="button" onClick={() => void ask(q.text, { lang: voiceLang })} className="shrink-0 rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              {q.text}
            </button>
          ))}
        </div>
      )}

      {showVoiceBanner && (
        <div className="flex items-center gap-2 border-t bg-brand-muted/60 px-3 py-2 text-xs" dir={dir}>
          <span className="relative flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/60" />
            <span className="relative size-2.5 rounded-full bg-brand" />
          </span>
          {voice.listening ? (
            <>
              <span className="font-medium text-foreground">{ui.listening}</span>
              <span className="truncate italic text-muted-foreground">{voice.interim || ui.speakNow}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{ui.speaking}</span>
              <span className="truncate text-muted-foreground">{ui.interrupt}</span>
            </>
          )}
        </div>
      )}

      <form onSubmit={submit} className={cn("flex items-center gap-2 border-t bg-card", compact ? "p-2" : "p-3")}>
        <Button
          type="button"
          size="icon"
          variant={voice.listening ? "default" : "outline"}
          onClick={onMic}
          disabled={busy}
          aria-label={voice.listening ? "Finish and send" : speaking ? "Interrupt and talk" : "Ask by voice"}
          aria-pressed={voice.listening}
          className={cn(
            "relative shrink-0",
            voice.listening ? "bg-brand text-brand-foreground hover:bg-brand/90" : voice.supported ? "border-brand/50 text-brand hover:bg-brand-muted" : "text-muted-foreground",
          )}
          title={voice.supported ? (voiceLang === "ar" ? "اسأل بالصوت — اضغط وتكلم" : "Ask by voice — tap and talk") : "Voice input not supported here"}
        >
          {voice.listening ? <Square className="size-3.5 fill-current" /> : voice.supported ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          {voice.listening && <span className="absolute inset-0 -z-10 animate-ping rounded-md bg-brand/50" />}
        </Button>
        {turns.length > 0 && langToggle}
        <input
          value={inputValue}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={voice.listening}
          dir="auto"
          placeholder={voice.listening ? ui.placeholderListening : contextLabel ? ui.placeholderScoped(contextLabel) : ui.placeholder}
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
