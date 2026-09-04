"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ARABIC_END_PHRASES, normalizeArabic } from "@/lib/ai/arabic";
import type { Lang } from "@/lib/ai/i18n";

/**
 * Browser-native voice: the Web Speech API for listening (Chromium/Safari)
 * and SpeechSynthesis for talking back. No keys, no network beyond what the
 * browser itself uses — right for a demo.
 *
 * Listening is continuous with silence detection: the question is sent
 * only after the speaker has paused for a moment (never mid-sentence), or
 * when they tap the mic to finish.
 */

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): { listen: boolean; speak: boolean } {
  return {
    listen: getRecognitionCtor() !== null,
    speak: typeof window !== "undefined" && "speechSynthesis" in window,
  };
}

/** Silence after the last words before the question is sent. */
const SILENCE_MS = 1500;
/** Give up on a session with nothing usable after this long. */
const MAX_SESSION_MS = 20_000;
/** Spoken phrases that end a voice conversation instead of asking a question. */
const END_PHRASES = /^(stop|that s all|thats all|that is all|thank you|thanks|bye|goodbye|no thanks|nothing|done|cancel|never mind|nevermind)\b[.!]?$/i;

function isEndPhrase(text: string): boolean {
  const latin = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (latin && END_PHRASES.test(latin)) return true;
  const arabic = normalizeArabic(text);
  return arabic.length > 0 && ARABIC_END_PHRASES.includes(arabic);
}

export interface UseVoiceOptions {
  /** Called with the final transcript when the speaker has finished. */
  onFinal: (text: string) => void;
  /** Called when a session ends without a usable question ("stop", silence, error). */
  onIdle?: (reason: "end-phrase" | "no-speech" | "cancelled" | "error") => void;
  lang?: string;
}

export interface Voice {
  supported: boolean;
  listening: boolean;
  /** Live transcript while listening. */
  interim: string;
  error: string | null;
  /** Start a listening session. */
  start: () => void;
  /** Finish the session now and send what was heard. */
  stop: () => void;
  /** Abort without sending anything. */
  cancel: () => void;
}

export function useVoice({ onFinal, onIdle, lang = "en-US" }: UseVoiceOptions): Voice {
  const [supported] = useState(() => speechSupported().listen);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const cancelledRef = useRef(false);
  const idleReasonRef = useRef<"no-speech" | "error" | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(onFinal);
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onFinalRef.current = onFinal;
    onIdleRef.current = onIdle;
  }, [onFinal, onIdle]);

  const clearTimers = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    silenceTimer.current = null;
    sessionTimer.current = null;
  };

  const stop = useCallback(() => {
    clearTimers();
    recRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    clearTimers();
    cancelledRef.current = true;
    recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }
    if (recRef.current) {
      cancelledRef.current = true;
      recRef.current.abort();
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    transcriptRef.current = "";
    cancelledRef.current = false;
    idleReasonRef.current = null;
    setInterim("");
    setError(null);

    const armSilence = () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        // Only send once there is something worth sending; otherwise keep listening.
        const words = transcriptRef.current.trim().split(/\s+/).filter(Boolean).length;
        if (words >= 2 || isEndPhrase(transcriptRef.current)) rec.stop();
        else armSilence();
      }, SILENCE_MS);
    };

    rec.onstart = () => {
      setListening(true);
      armSilence();
      sessionTimer.current = setTimeout(() => {
        if (!transcriptRef.current.trim()) idleReasonRef.current = "no-speech";
        rec.stop();
      }, MAX_SESSION_MS);
    };
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      transcriptRef.current = `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
      setInterim(transcriptRef.current);
      armSilence();
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      if (e.error === "no-speech") {
        idleReasonRef.current = "no-speech";
        return;
      }
      idleReasonRef.current = "error";
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked — allow it in the browser and try again."
          : e.error === "network"
            ? "Speech recognition needs a network connection."
            : `Voice error: ${e.error}`,
      );
    };
    rec.onend = () => {
      clearTimers();
      setListening(false);
      setInterim("");
      recRef.current = null;
      const text = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (cancelledRef.current) {
        cancelledRef.current = false;
        onIdleRef.current?.("cancelled");
        return;
      }
      if (idleReasonRef.current) {
        onIdleRef.current?.(idleReasonRef.current);
        return;
      }
      if (!text) {
        onIdleRef.current?.("no-speech");
        return;
      }
      if (isEndPhrase(text)) {
        onIdleRef.current?.("end-phrase");
        return;
      }
      onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      recRef.current = null;
    }
  }, [lang]);

  useEffect(
    () => () => {
      clearTimers();
      cancelledRef.current = true;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop, cancel };
}

/* ------------------------------- Speaking -------------------------------- */

const PREFERRED_VOICES: Record<Lang, string[]> = {
  en: ["Google UK English Female", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)", "Samantha", "Google US English"],
  ar: ["Microsoft Salma Online (Natural) - Arabic (Egypt)", "Microsoft Layla Online (Natural) - Arabic (Lebanon)", "Microsoft Hamed - Arabic (Saudi Arabia)", "Microsoft Naayf - Arabic (Saudi Arabia)", "Google العربية", "Majed", "Maged"],
};

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  for (const name of PREFERRED_VOICES[lang]) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  const prefix = lang === "ar" ? "ar" : "en";
  const lebanese = lang === "ar" ? voices.find((v) => /^ar[-_]LB/i.test(v.lang)) : undefined;
  return lebanese ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? (lang === "ar" ? null : voices[0] ?? null);
}

/** Whether the browser has any voice for the language. */
export function hasVoiceFor(lang: Lang): boolean {
  return pickVoice(lang) !== null;
}

export function speak(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}, lang: Lang = "en"): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang);
  // Voices are loaded but none can read Arabic: say nothing rather than let an
  // English voice mangle it — the caller shows the answer on screen instead.
  if (!voice && lang === "ar" && synth.getVoices().length > 0) return false;
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? (lang === "ar" ? "ar-LB" : "en-US");
  u.rate = lang === "ar" ? 1 : 1.02;
  u.pitch = 1;
  let ended = false;
  let guard = 0;
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(guard);
    handlers.onEnd?.();
  };
  // Some engines never fire onend for an utterance they cannot voice; don't let
  // a conversation hang on "speaking" forever.
  guard = window.setTimeout(() => {
    synth.cancel();
    end();
  }, 4000 + text.length * 120);
  u.onstart = () => handlers.onStart?.();
  u.onend = end;
  u.onerror = end;
  synth.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/** Warm the voice list — Chromium loads it asynchronously. */
export function warmVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
