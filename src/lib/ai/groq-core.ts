/**
 * The parts of talking to Groq that need no network: which models to use,
 * what a failed call means for the caller, and how to read a reply.
 * groq.ts does the fetch; keeping these pure lets the rules be tested.
 *
 * Groq serves open-weight models on a free plan through an OpenAI-style
 * chat completions API. Two models cover everything STARS asks of an AI:
 *
 *   text    openai/gpt-oss-120b — concern triage, and reading the text of
 *           a PDF COR or rating slip. Supports strict JSON-schema output.
 *   vision  qwen/qwen3.8-27b — reading a photo of a COR or rating slip.
 *           The only Groq model that takes images (a preview model, so it
 *           can be swapped with GROQ_VISION_MODEL if Groq retires it).
 */

export const DEFAULT_TEXT_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

type Env = Record<string, string | undefined>;

export function aiModels(env: Env = process.env): { text: string; vision: string } {
  return {
    text: env.GROQ_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    vision: env.GROQ_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL,
  };
}

export function aiConfigured(env: Env = process.env): boolean {
  return Boolean(env.GROQ_API_KEY?.trim());
}

/**
 * What went wrong, sorted by what the caller should do about it.
 *
 *   hold       every request will fail the same way until a person fixes
 *              something (no key, a rejected key, a retired model) or the
 *              free plan's limit resets — stop and keep the queue intact
 *   retryable  this request may succeed if sent again later
 *   neither    this input will never work (too large, malformed)
 */
export interface GroqFailure {
  kind:
    | "not_configured"
    | "auth"
    | "model_unavailable"
    | "rate_limited"
    | "too_large"
    | "invalid_output"
    | "truncated"
    | "bad_request"
    | "unavailable"
    | "network";
  message: string;
  hold: boolean;
  retryable: boolean;
  status?: number;
}

export function failure(kind: GroqFailure["kind"], status?: number, detail?: string): GroqFailure {
  switch (kind) {
    case "not_configured":
      return { kind, status, hold: true, retryable: true, message: "Waiting: GROQ_API_KEY is not set on the server." };
    case "auth":
      return { kind, status, hold: true, retryable: true, message: "Waiting: Groq rejected the API key. Check GROQ_API_KEY." };
    case "model_unavailable":
      return {
        kind,
        status,
        hold: true,
        retryable: true,
        message: `Waiting: Groq no longer offers the configured model${detail ? ` (${detail})` : ""}. Set GROQ_TEXT_MODEL or GROQ_VISION_MODEL.`,
      };
    case "rate_limited":
      return {
        kind,
        status,
        hold: true,
        retryable: true,
        message: "Waiting: Groq's free-plan limit was reached. Work resumes by itself when it resets.",
      };
    case "too_large":
      return { kind, status, hold: false, retryable: false, message: "Too long for the AI to read in one request." };
    case "invalid_output":
      return { kind, status, hold: false, retryable: true, message: "The AI response was not in the expected format." };
    case "truncated":
      return { kind, status, hold: false, retryable: true, message: "The AI response was cut off." };
    case "bad_request":
      return {
        kind,
        status,
        hold: false,
        retryable: false,
        message: `The AI service rejected the request${detail ? `: ${detail.slice(0, 160)}` : "."}`,
      };
    case "unavailable":
      return {
        kind,
        status,
        hold: false,
        retryable: true,
        message: `The AI service is unavailable right now${status ? ` (${status})` : ""}.`,
      };
    case "network":
      return { kind, status, hold: false, retryable: true, message: "Could not reach the AI service." };
  }
}

/** Reads Groq's error body ({"error":{"message","type","code"?}}) into a failure. */
export function classifyGroqError(status: number, bodyText: string): GroqFailure {
  let message = "";
  let code = "";
  try {
    const body = JSON.parse(bodyText) as { error?: { message?: string; code?: string } };
    message = body.error?.message ?? "";
    code = body.error?.code ?? "";
  } catch {
    message = bodyText.slice(0, 200);
  }
  const text = `${code} ${message}`.toLowerCase();

  if (status === 401 || status === 403) return failure("auth", status);
  if (status === 429) return failure("rate_limited", status);
  if (status === 413) return failure("too_large", status);
  if (status === 404 || /model_not_found|decommissioned|does not exist|not found/.test(text)) {
    return failure("model_unavailable", status, message.slice(0, 80) || undefined);
  }
  // A model that cannot do structured output at all is a request problem,
  // not a bad answer: sending it again changes nothing.
  if (/not supported|unsupported|does not support/.test(text)) return failure("bad_request", status, message);
  if (status === 422 || /json_validate_failed|failed to generate json|schema/.test(text)) {
    return failure("invalid_output", status);
  }
  if (/context.length|too long|maximum context|reduce the length/.test(text)) return failure("too_large", status);
  if (status === 400) return failure("bad_request", status, message);
  return failure("unavailable", status);
}

/** The reply text, or why there is none. */
export function readGroqReply(
  body: unknown,
): { ok: true; text: string; model: string | null } | { ok: false; failure: GroqFailure } {
  const reply = body as {
    model?: string;
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  } | null;
  const choice = reply?.choices?.[0];
  if (!choice) return { ok: false, failure: failure("invalid_output") };
  if (choice.finish_reason === "length") return { ok: false, failure: failure("truncated") };
  const text = choice.message?.content?.trim() ?? "";
  if (!text) return { ok: false, failure: failure("invalid_output") };
  return { ok: true, text, model: reply?.model ?? null };
}

/**
 * Groq's strict JSON-schema mode needs every property listed in `required`
 * and `additionalProperties: false` on every object. Returns the paths that
 * break either rule; the tests run every schema STARS sends through this.
 */
export function strictSchemaProblems(schema: unknown, path = "$"): string[] {
  const node = schema as {
    type?: string | string[];
    properties?: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties?: unknown;
    items?: unknown;
  };
  if (!node || typeof node !== "object") return [];
  const problems: string[] = [];
  const types = Array.isArray(node.type) ? node.type : [node.type];

  if (types.includes("object")) {
    if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const required = new Set(node.required ?? []);
    for (const key of Object.keys(node.properties ?? {})) {
      if (!required.has(key)) problems.push(`${path}.${key}: not in required`);
    }
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    problems.push(...strictSchemaProblems(child, `${path}.${key}`));
  }
  if (node.items) problems.push(...strictSchemaProblems(node.items, `${path}[]`));
  return problems;
}
