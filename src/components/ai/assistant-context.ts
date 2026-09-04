"use client";

import { createContext, useContext } from "react";

import type { Lang } from "@/lib/ai/i18n";
import type { ChatTurn } from "@/lib/ai/types";

export interface AskOptions {
  /** The question was spoken — read the answer back. */
  spoken?: boolean;
  /** Force the answer language; otherwise detected from the question's script. */
  lang?: Lang;
}

export interface AssistantContextValue {
  turns: ChatTurn[];
  busy: boolean;
  status: string | null;
  /** Human label for the current scope, e.g. "Beirut Heights". */
  contextLabel: string | null;
  ask: (question: string, opts?: AskOptions) => Promise<void>;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Voice output. */
  speakReplies: boolean;
  setSpeakReplies: (on: boolean) => void;
  speaking: boolean;
  stopSpeaking: () => void;
  speakSupported: boolean;
  /**
   * Bumps every time a spoken answer finishes on its own (not when the user
   * hit Stop) — lets the chat resume listening in a voice conversation.
   */
  speechCompletedCount: number;
  /** Language the microphone listens in (and the UI hints). Typed questions auto-detect. */
  voiceLang: Lang;
  setVoiceLang: (lang: Lang) => void;
}

export const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}
