import type { AlertActionKind, ID } from "@/types";

import type { Lang } from "./i18n";

/** What the assistant knows about where the user is. */
export interface PageContext {
  pathname: string;
  propertyId?: ID;
  propertyName?: string;
  unitId?: ID;
  tenantId?: ID;
}

export interface AnswerTable {
  columns: string[];
  rows: (string | number)[][];
}

export interface AnswerCard {
  title: string;
  subtitle?: string;
  fields: [string, string][];
}

export interface AnswerAction {
  kind: AlertActionKind;
  label: string;
  targetId: ID;
  /** Prefilled fields for creation actions — the form still asks for confirmation. */
  payload?: Record<string, unknown>;
}

/** Structured answer rendered as text → table/cards → recommendation → actions. */
export interface AssistantAnswer {
  text: string;
  table?: AnswerTable;
  cards?: AnswerCard[];
  recommendation?: string;
  actions?: AnswerAction[];
  /** Follow-up questions the user can tap. */
  suggestions?: string[];
  /** Language the answer is written in — drives text direction and the voice. */
  lang?: Lang;
  source: "scripted" | "local" | "model" | "fallback";
  /** Open the first action's form as soon as the answer lands (data entry by voice). */
  autoOpen?: boolean;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text?: string;
  answer?: AssistantAnswer;
  pending?: boolean;
  error?: string;
}

/* ---- Minimal Messages-API shapes used on the client (no SDK import) ---- */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ApiMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface AiRequest {
  system: string;
  messages: ApiMessage[];
  tools: ToolDefinition[];
}

export type AiResponse =
  | { ok: true; content: ContentBlock[]; stop_reason: string | null; model: string }
  | { ok: false; error: "no_credentials" | "rate_limited" | "api_error" | "bad_request"; message: string };
