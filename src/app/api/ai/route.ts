import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import type { AiRequest, AiResponse, ContentBlock } from "@/lib/ai/types";

export const runtime = "nodejs";

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * One model turn. The browser owns the data and the tool layer, so this
 * route only relays the conversation to Claude and returns the content
 * blocks; tool calls are executed client-side and posted back.
 */
export async function POST(req: Request): Promise<NextResponse<AiResponse>> {
  let body: AiRequest;
  try {
    body = (await req.json()) as AiRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request", message: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request", message: "messages required" }, { status: 400 });
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: body.system, cache_control: { type: "ephemeral" } }],
      tools: body.tools as Anthropic.Tool[],
      messages: body.messages as Anthropic.MessageParam[],
      // A chat assistant over structured data: low effort keeps answers quick.
      output_config: { effort: "low" },
    });

    const content: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") content.push({ type: "tool_use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }

    return NextResponse.json({ ok: true, content, stop_reason: response.stop_reason, model: response.model });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ ok: false, error: "no_credentials", message: "No valid Anthropic credentials — set ANTHROPIC_API_KEY." }, { status: 503 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ ok: false, error: "rate_limited", message: "Rate limited — try again in a moment." }, { status: 429 });
    }
    if (error instanceof Anthropic.BadRequestError) {
      return NextResponse.json({ ok: false, error: "bad_request", message: error.message }, { status: 400 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ ok: false, error: "api_error", message: `${error.status ?? ""} ${error.message}`.trim() }, { status: 502 });
    }
    const message = error instanceof Error ? error.message : String(error);
    const missingKey = /api key|apiKey|ANTHROPIC_API_KEY|credential/i.test(message);
    return NextResponse.json(
      { ok: false, error: missingKey ? "no_credentials" : "api_error", message },
      { status: missingKey ? 503 : 500 },
    );
  }
}
