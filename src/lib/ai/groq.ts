import "server-only";

import { classifyGroqError, failure, readGroqReply, type GroqFailure } from "./groq-core";

/**
 * One chat completion from Groq that must come back as JSON.
 *
 * Plain fetch against Groq's OpenAI-style endpoint rather than an SDK: it is
 * one POST, and owning it keeps the error handling in groq-core.ts, where
 * it is tested.
 */

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 60_000;

export type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface GroqJsonRequest {
  model: string;
  system: string;
  user: ChatContent;
  /**
   * With a schema, Groq enforces it (strict mode). Without one, JSON object
   * mode: valid JSON, shape described by the prompt and checked afterwards.
   */
  schema?: { name: string; schema: object };
  maxTokens: number;
  /** Reasoning settings differ by model family; see groqReasoning(). */
  reasoning?: Record<string, string | boolean>;
}

export type GroqJsonResult = { ok: true; text: string; model: string } | { ok: false; failure: GroqFailure };

/**
 * A little reasoning, never more: gpt-oss always reasons, so keep it low and
 * leave the reasoning out of the reply. Qwen reasons only when asked, but
 * with reasoning off it returned every grade on a test rating slip as null;
 * at "low" it read all six. With JSON output its reasoning must be hidden
 * or parsed, never raw.
 */
export function groqReasoning(model: string): Record<string, string | boolean> {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/")) return { reasoning_effort: "low", reasoning_format: "hidden" };
  return {};
}

export async function groqJson(request: GroqJsonRequest): Promise<GroqJsonResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return { ok: false, failure: failure("not_configured") };

  const body = {
    model: request.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
    max_completion_tokens: request.maxTokens,
    temperature: 0.2,
    response_format: request.schema
      ? { type: "json_schema", json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema } }
      : { type: "json_object" },
    ...(request.reasoning ?? groqReasoning(request.model)),
  };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error("[groq] request failed", error);
    return { ok: false, failure: failure("network") };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const classified = classifyGroqError(response.status, text);
    if (classified.kind !== "rate_limited") console.error("[groq]", response.status, text.slice(0, 300));
    return { ok: false, failure: classified };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, failure: failure("invalid_output") };
  }
  const reply = readGroqReply(json);
  if (!reply.ok) return reply;
  return { ok: true, text: reply.text, model: reply.model ?? request.model };
}
