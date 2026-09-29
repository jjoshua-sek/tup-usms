import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  CONCERN_SUMMARY_JSON_SCHEMA,
  CONCERN_SYSTEM_PROMPT,
  buildConcernPrompt,
  parseConcernSummary,
  type ConcernSummary,
} from "./concern-summary";

/**
 * One call to Claude to summarize and triage a student concern.
 *
 * Replaces three hand-written copies of the same fetch() — an Edge Function
 * that was never deployed, an unused API route, and the staff "Re-analyze"
 * action — all of which regex-matched JSON out of free text and named
 * claude-sonnet-4-20250514, a deprecated model.
 *
 *   Model   claude-opus-5-5, the current default.
 *   Effort  low. Triage is classification and a short summary; low effort
 *           keeps it quick and cheap, and the prompt spells out the rules.
 *   Output  structured (output_config.format), then validated with Zod.
 *   Refusal fallbacks: "default". A concern about harassment or self-harm
 *           is exactly the kind of text a safety classifier may decline,
 *           and exactly the kind staff most need triaged; if the requested
 *           model declines, the API re-runs the request on a fallback
 *           model inside the same call. response.model says which one
 *           actually answered, and that is what gets recorded.
 */

const MODEL = "claude-opus-5-5";

export type SummaryResult =
  | { ok: true; summary: ConcernSummary; model: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      /**
       * The problem is the account, not this concern: no API key, a
       * rejected key, or no credit left. Every concern would fail the same
       * way, so callers stop and keep the queue intact — and summaries
       * resume by themselves once someone fixes the account.
       */
      hold?: boolean;
    };

/** The Anthropic account has no credit left: a 400 with no dedicated error class. */
function isOutOfCredit(error: InstanceType<typeof Anthropic.BadRequestError>): boolean {
  const body = error.error as { error?: { message?: string } } | undefined;
  return /credit balance is too low/i.test(body?.error?.message ?? error.message);
}

let client: Anthropic | null = null;

export async function summarizeConcernText(input: {
  category: string;
  subject: string;
  body: string;
}): Promise<SummaryResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      error: "Waiting: ANTHROPIC_API_KEY is not set on the server.",
      retryable: true,
      hold: true,
    };
  }
  client ??= new Anthropic();

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: CONCERN_SYSTEM_PROMPT,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: CONCERN_SUMMARY_JSON_SCHEMA },
      },
      messages: [{ role: "user", content: buildConcernPrompt(input) }],
    });

    // Every model in the chain declined. Retrying the same text will not
    // change that; staff read the concern themselves.
    if (response.stop_reason === "refusal") {
      const category = (response.stop_details as { category?: string | null } | null)?.category;
      return {
        ok: false,
        error: `The AI declined to summarize this concern${category ? ` (${category})` : ""}. Read it in full.`,
        retryable: false,
      };
    }
    if (response.stop_reason === "max_tokens") {
      return { ok: false, error: "The AI response was cut off.", retryable: true };
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    const summary = parseConcernSummary(text);
    if (!summary) {
      return { ok: false, error: "The AI response was not in the expected format.", retryable: true };
    }

    return { ok: true, summary, model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        ok: false,
        error: "Waiting: the Anthropic API key was rejected. Check ANTHROPIC_API_KEY.",
        retryable: true,
        hold: true,
      };
    }
    if (error instanceof Anthropic.BadRequestError && isOutOfCredit(error)) {
      return {
        ok: false,
        error: "Waiting: the Anthropic account is out of credit. Summaries resume once credit is added.",
        retryable: true,
        hold: true,
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limited by the AI service.", retryable: true };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "Could not reach the AI service.", retryable: true };
    }
    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 0;
      return {
        ok: false,
        error: `The AI service returned an error (${status || "unknown"}).`,
        retryable: status === 0 || status >= 500 || status === 408 || status === 409,
      };
    }
    console.error("[concern summary] unexpected error", error);
    return { ok: false, error: "The AI summary failed unexpectedly.", retryable: true };
  }
}
