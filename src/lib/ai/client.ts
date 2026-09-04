import { today } from "@/lib/date";
import type { Store } from "@/types";

import { answerScripted, matchScripted, SUGGESTED_QUESTIONS } from "./scripted";
import { buildSystemPrompt } from "./system-prompt";
import { executeTool, knownActionTarget, TOOL_DEFINITIONS } from "./tools";
import type { AiRequest, AiResponse, AnswerAction, ApiMessage, AssistantAnswer, ChatTurn, ContentBlock, PageContext, ToolUseBlock } from "./types";

const MAX_ROUNDS = 6;

export interface AskOptions {
  question: string;
  history: ChatTurn[];
  store: Store;
  context: PageContext;
  onStatus?: (status: string) => void;
}

/**
 * Answer a question. The six rehearsed questions are answered instantly from
 * the query layer; everything else runs a tool-use loop against Claude with
 * tools executed here, in the browser, against the in-memory store.
 */
export async function askAssistant(opts: AskOptions): Promise<AssistantAnswer> {
  const { question, store, context } = opts;

  const scripted = matchScripted(question);
  if (scripted) return answerScripted(scripted, question, store, context);

  const system = buildSystemPrompt(context, today());
  const messages: ApiMessage[] = [...historyToMessages(opts.history), { role: "user", content: question }];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    opts.onStatus?.(round === 0 ? "Thinking…" : "Looking things up…");
    const res = await callApi({ system, messages, tools: TOOL_DEFINITIONS });
    if (!res.ok) return fallbackAnswer(res.error, res.message);

    const toolUses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const final = toolUses.find((b) => b.name === "answer");
    if (final) return sanitizeAnswer(final.input, store);

    if (toolUses.length === 0) {
      const text = res.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text: text || "I couldn't work out an answer from the data.", source: "model" };
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

  return { text: "That took too many steps — try a more specific question.", source: "fallback" };
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

function sanitizeAnswer(input: Record<string, unknown>, store: Store): AssistantAnswer {
  const text = typeof input.text === "string" ? input.text : "";
  const table = isTable(input.table) ? input.table : undefined;
  const cards = Array.isArray(input.cards) ? (input.cards as AssistantAnswer["cards"]) : undefined;
  const recommendation = typeof input.recommendation === "string" ? input.recommendation : undefined;
  const actions = Array.isArray(input.actions)
    ? (input.actions as AnswerAction[]).filter((a) => a && typeof a.kind === "string" && typeof a.targetId === "string" && knownActionTarget(store, a.kind, a.targetId)).slice(0, 4)
    : undefined;
  return { text, table, cards, recommendation, actions, source: "model" };
}

function isTable(v: unknown): v is AssistantAnswer["table"] & object {
  return Boolean(v) && typeof v === "object" && Array.isArray((v as { columns?: unknown }).columns) && Array.isArray((v as { rows?: unknown }).rows);
}

type AiErrorKind = Extract<AiResponse, { ok: false }>["error"];

function fallbackAnswer(error: AiErrorKind, message: string): AssistantAnswer {
  const suggestions = SUGGESTED_QUESTIONS.map((q) => `“${q.text}”`).join(", ");
  if (error === "no_credentials") {
    return {
      text: `Free-form questions need a Claude API key: add ANTHROPIC_API_KEY to .env.local and restart. The six rehearsed questions work without it — try ${suggestions}.`,
      source: "fallback",
    };
  }
  if (error === "rate_limited") return { text: "The model is rate-limited right now — try again in a few seconds.", source: "fallback" };
  return { text: `I couldn't reach the model (${message}). The rehearsed questions still work: ${suggestions}.`, source: "fallback" };
}
