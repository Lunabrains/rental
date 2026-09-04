import { today } from "@/lib/date";
import type { Store } from "@/types";

import { answerLocally, unknownAnswer } from "./demo-engine";
import { detectLang, strings, type Lang } from "./i18n";
import { buildSystemPrompt } from "./system-prompt";
import { executeTool, knownActionTarget, TOOL_DEFINITIONS } from "./tools";
import type { AiRequest, AiResponse, AnswerAction, ApiMessage, AssistantAnswer, ChatTurn, ContentBlock, PageContext, ToolUseBlock } from "./types";

const MAX_ROUNDS = 6;

/**
 * Whether Claude is reachable this session. Starts unknown; the first
 * "no_credentials" answer flips it off so the demo never waits on the
 * network again.
 */
let modelAvailable: boolean | null = null;

export interface AskOptions {
  question: string;
  history: ChatTurn[];
  store: Store;
  context: PageContext;
  /** Answer language; detected from the script of the question when omitted. */
  lang?: Lang;
  onStatus?: (status: string) => void;
}

/**
 * Answer a question. Order of business:
 *   1. the local demo brain — instant, exact, no network, English or Arabic;
 *   2. Claude with the read-only tool layer, when a key is configured;
 *   3. an honest "I can't answer that from the data" with suggestions.
 */
export async function askAssistant(opts: AskOptions): Promise<AssistantAnswer> {
  const { question, store, context } = opts;
  const lang = opts.lang ?? detectLang(question);

  const local = answerLocally(question, store, context, lang);
  if (local) return local;

  if (modelAvailable === false) return unknownAnswer(question, lang);

  const system = buildSystemPrompt(context, today(), lang);
  const messages: ApiMessage[] = [...historyToMessages(opts.history), { role: "user", content: question }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    opts.onStatus?.(round === 0 ? (lang === "ar" ? "أفكر…" : "Thinking…") : lang === "ar" ? "أبحث…" : "Looking things up…");
    const res = await callApi({ system, messages, tools: TOOL_DEFINITIONS });
    if (!res.ok) {
      if (res.error === "no_credentials") modelAvailable = false;
      return res.error === "no_credentials" ? unknownAnswer(question, lang) : fallbackAnswer(res.error, res.message, question, lang);
    }
    modelAvailable = true;

    const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const final = toolUses.find((b) => b.name === "answer");
    if (final) return sanitizeAnswer(final.input, store, lang);

    if (toolUses.length === 0) {
      const text = res.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text ? { text, source: "model", lang } : unknownAnswer(question, lang);
    }

    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: toolUses.map((call) => {
        try {
          const result = executeTool(store, call.name, call.input, context);
          return { type: "tool_result" as const, tool_use_id: call.id, content: JSON.stringify(result) };
        } catch (err) {
          return { type: "tool_result" as const, tool_use_id: call.id, content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), is_error: true };
        }
      }),
    });
  }

  return { text: strings(lang).tooManySteps, source: "fallback", lang };
}

function historyToMessages(history: ChatTurn[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (const turn of history.slice(-8)) {
    if (turn.role === "user" && turn.text) out.push({ role: "user", content: turn.text });
    else if (turn.role === "assistant" && turn.answer) out.push({ role: "assistant", content: summarizeAnswer(turn.answer) });
  }
  // The API requires alternating turns starting with user; collapse doubles.
  const merged: ApiMessage[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && typeof last.content === "string" && typeof m.content === "string") last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  while (merged.length > 0 && merged[0].role !== "user") merged.shift();
  return merged;
}

function summarizeAnswer(a: AssistantAnswer): string {
  const parts = [a.text];
  if (a.table) parts.push(`${a.table.columns.join(" | ")}\n${a.table.rows.slice(0, 8).map((r) => r.join(" | ")).join("\n")}`);
  if (a.recommendation) parts.push(`Recommendation: ${a.recommendation}`);
  return parts.join("\n");
}

async function callApi(body: AiRequest): Promise<AiResponse> {
  try {
    const res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json()) as AiResponse;
    return data;
  } catch (err) {
    return { ok: false, error: "api_error", message: err instanceof Error ? err.message : String(err) };
  }
}

function sanitizeAnswer(input: Record<string, unknown>, store: Store, lang: Lang): AssistantAnswer {
  const text = typeof input.text === "string" ? input.text : "";
  const table = isTable(input.table) ? input.table : undefined;
  const cards = Array.isArray(input.cards) ? (input.cards as AssistantAnswer["cards"]) : undefined;
  const recommendation = typeof input.recommendation === "string" ? input.recommendation : undefined;
  const actions = Array.isArray(input.actions)
    ? (input.actions as AnswerAction[]).filter((a) => a && typeof a.kind === "string" && typeof a.targetId === "string" && knownActionTarget(store, a.kind, a.targetId)).slice(0, 4)
    : undefined;
  return { text, table, cards, recommendation, actions, source: "model", lang: detectLang(text) === "ar" ? "ar" : lang };
}

function isTable(v: unknown): v is AssistantAnswer["table"] & object {
  return Boolean(v) && typeof v === "object" && Array.isArray((v as { columns?: unknown }).columns) && Array.isArray((v as { rows?: unknown }).rows);
}

type AiErrorKind = Extract<AiResponse, { ok: false }>["error"];

function fallbackAnswer(error: AiErrorKind, message: string, question: string, lang: Lang): AssistantAnswer {
  const s = strings(lang);
  if (error === "rate_limited") return { text: s.rateLimited, source: "fallback", lang };
  return { ...unknownAnswer(question, lang), text: s.modelUnreachable(message) };
}
