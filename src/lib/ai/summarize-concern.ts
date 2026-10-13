import "server-only";

import {
  CONCERN_SUMMARY_JSON_SCHEMA,
  CONCERN_SYSTEM_PROMPT,
  buildConcernPrompt,
  parseConcernSummary,
  type ConcernSummary,
} from "./concern-summary";
import { aiModels } from "./groq-core";
import { groqJson } from "./groq";

/**
 * One call to the AI to summarize and triage a student concern.
 *
 *   Provider  Groq, free plan. The model is GROQ_TEXT_MODEL, by default
 *             openai/gpt-oss-120b.
 *   Output    strict JSON schema, enforced by Groq, then validated with Zod.
 *   Failures  sorted in groq-core.ts. A missing or rejected key, a retired
 *             model, or the free plan's limit is a hold: every concern
 *             would fail alike, so the queue stops and waits instead of
 *             spending attempts.
 */

export type SummaryResult =
  | { ok: true; summary: ConcernSummary; model: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      /**
       * The problem is the account, not this concern. Callers stop and keep
       * the queue intact, and summaries resume by themselves once it clears.
       */
      hold?: boolean;
    };

export async function summarizeConcernText(input: {
  category: string;
  subject: string;
  body: string;
}): Promise<SummaryResult> {
  const result = await groqJson({
    model: aiModels().text,
    system: CONCERN_SYSTEM_PROMPT,
    user: buildConcernPrompt(input),
    schema: { name: "concern_summary", schema: CONCERN_SUMMARY_JSON_SCHEMA },
    maxTokens: 2000,
  });

  if (!result.ok) {
    const { message, retryable, hold } = result.failure;
    return { ok: false, error: message, retryable, hold };
  }

  const summary = parseConcernSummary(result.text);
  if (!summary) {
    return { ok: false, error: "The AI response was not in the expected format.", retryable: true };
  }
  return { ok: true, summary, model: result.model };
}
