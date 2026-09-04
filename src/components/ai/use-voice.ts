"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-native voice: the Web Speech API for listening (Chromium/Safari)
 * and SpeechSynthesis for talking back. No keys, no network beyond what the
 * browser itself uses — right for a demo.
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

export interface UseVoiceOptions {
  /** Called with the final transcript when the user stops talking. */
  onFinal: (text: string) => void;
  lang?: string;
}

export interface Voice {
  supported: boolean;
  listening: boolean;
  /** Live transcript while listening. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export function useVoice({ onFinal, lang = "en-US" }: UseVoiceOptions): Voice {
  const [supported] = useState(() => speechSupported().listen);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecognitionLike | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice input isn't supported in this browser — try Chrome or Edge.");
      return;
    }
    if (recRef.current) {
      recRef.current.abort();
      recRef.current = null;
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = "";
    setInterim("");
    setError(null);

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) finalRef.current = finalText;
      setInterim((finalText + " " + interimText).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked — allow it in the browser and try again."
          : e.error === "no-speech"
            ? "I didn't catch that — try again."
            : e.error === "network"
              ? "Speech recognition needs a network connection."
              : `Voice error: ${e.error}`,
      );
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      const text = finalRef.current.trim();
      setInterim("");
      if (text) onFinalRef.current(text);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      recRef.current = null;
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, toggle };
}

/* ------------------------------- Speaking -------------------------------- */

let currentUtterance: SpeechSynthesisUtterance | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const preferred = ["Google UK English Female", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)", "Samantha", "Google US English"];
  for (const name of preferred) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en") && v.localService) ?? voices.find((v) => v.lang.startsWith("en")) ?? voices[0] ?? null;
}

export function speak(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-US";
  u.rate = 1.02;
  u.pitch = 1;
  u.onstart = () => handlers.onStart?.();
  u.onend = () => {
    if (currentUtterance === u) currentUtterance = null;
    handlers.onEnd?.();
  };
  u.onerror = () => {
    if (currentUtterance === u) currentUtterance = null;
    handlers.onEnd?.();
  };
  currentUtterance = u;
  synth.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

/** Warm the voice list — Chromium loads it asynchronously. */
export function warmVoices(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}
