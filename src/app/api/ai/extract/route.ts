import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import type { ExtractRequest, ExtractResponse } from "@/lib/ai/documents";

export const runtime = "nodejs";

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

const TOOL: Anthropic.Tool = {
  name: "extract_document",
  description: "Report what the document is and the facts it states. Only report values that appear in the document; leave out anything not present. Use the provided ids for links.",
  input_schema: {
    type: "object",
    properties: {
      docType: { type: "string", description: "One of the allowed categories" },
      typeConfidence: { type: "number" },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: ["amount", "date", "dueDate", "invoiceNumber", "supplierName", "tenantName", "propertyName", "unitNumber", "rent", "deposit", "startDate", "endDate", "paymentFrequency", "increaseClause", "specialTerms", "issuedDate", "expiryDate", "assetName", "reference"] },
            value: { type: "string", description: "Dates as YYYY-MM-DD, money as a plain number in USD" },
            confidence: { type: "number" },
            evidence: { type: "string", description: "Short quote from the document" },
          },
          required: ["key", "value", "confidence"],
        },
      },
      links: {
        type: "object",
        properties: { tenantId: { type: "string" }, contractId: { type: "string" }, propertyId: { type: "string" }, unitId: { type: "string" }, supplierId: { type: "string" }, assetId: { type: "string" } },
      },
      linkConfidence: { type: "object", properties: { tenantId: { type: "number" }, contractId: { type: "number" }, propertyId: { type: "number" }, unitId: { type: "number" }, supplierId: { type: "number" }, assetId: { type: "number" } } },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["docType", "typeConfidence", "fields", "links"],
  },
};

/**
 * Reads one uploaded document (text, image or PDF) and returns structured
 * suggestions for the review screen. The original file is never modified;
 * nothing is saved here — the browser applies what the owner confirms.
 */
export async function POST(req: Request): Promise<NextResponse<ExtractResponse>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: "no_credentials", message: "ANTHROPIC_API_KEY is not set" }, { status: 503 });
  }
  let body: ExtractRequest;
  try {
    body = (await req.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request", message: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.fileName || (!body.text && !body.data)) {
    return NextResponse.json({ ok: false, error: "bad_request", message: "text or data required" }, { status: 400 });
  }

  const hints = body.hints ?? { tenants: [], properties: [], units: [], suppliers: [], assets: [] };
  const system = `You extract facts from documents for a rental property manager in Lebanon (USD). Report only what the document states — never guess names, amounts or dates. Categories: ${body.categories.join(", ")}.
Known entities (use these ids in "links" when the document clearly refers to them):
Buildings: ${hints.properties.map((p) => `${p.name} [${p.code}] id=${p.id}`).join("; ") || "none"}
Units: ${hints.units.slice(0, 400).map((u) => `${u.number} (building ${u.propertyId}) id=${u.id}`).join("; ") || "none"}
Tenants: ${hints.tenants.map((t) => `${t.name} id=${t.id}`).join("; ") || "none"}
Suppliers: ${hints.suppliers.map((s) => `${s.name} id=${s.id}`).join("; ") || "none"}
Assets: ${hints.assets.map((a) => `${a.name} (building ${a.propertyId}) id=${a.id}`).join("; ") || "none"}
Give a confidence between 0 and 1 for the type, each field and each link. Call the extract_document tool exactly once.`;

  const content: Anthropic.ContentBlockParam[] = [];
  if (body.text) content.push({ type: "text", text: `File name: ${body.fileName}\n\nDocument text:\n${body.text.slice(0, 40_000)}` });
  else if (body.data && body.mimeType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: body.data } }, { type: "text", text: `File name: ${body.fileName}` });
  else if (body.data && /^image\/(jpeg|png|gif|webp)$/.test(body.mimeType)) content.push({ type: "image", source: { type: "base64", media_type: body.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: body.data } }, { type: "text", text: `File name: ${body.fileName}` });
  else return NextResponse.json({ ok: false, error: "unsupported", message: `Cannot read ${body.mimeType}` }, { status: 415 });

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4000,
      system,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "extract_document" },
      messages: [{ role: "user", content }],
    });
    const call = response.content.find((b) => b.type === "tool_use");
    if (!call || call.type !== "tool_use") return NextResponse.json({ ok: false, error: "api_error", message: "No extraction returned" }, { status: 502 });
    const extraction = { ...(call.input as object), source: "model", model: response.model } as ExtractResponse extends { ok: true; extraction: infer E } ? E : never;
    return NextResponse.json({ ok: true, extraction });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return NextResponse.json({ ok: false, error: "no_credentials", message: "No valid Anthropic credentials" }, { status: 503 });
    if (error instanceof Anthropic.APIError) return NextResponse.json({ ok: false, error: "api_error", message: `${error.status ?? ""} ${error.message}`.trim() }, { status: 502 });
    return NextResponse.json({ ok: false, error: "api_error", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
