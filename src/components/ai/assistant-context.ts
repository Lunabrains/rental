"use client";

import { createContext, useContext } from "react";

import type { ChatTurn } from "@/lib/ai/types";

export interface AssistantContextValue {
  turns: ChatTurn[];
  busy: boolean;
  status: string | null;
  /** Human label for the current scope, e.g. "Beirut Heights". */
  contextLabel: string | null;
  ask: (question: string) => Promise<void>;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used inside <AssistantProvider>");
  return ctx;
}
