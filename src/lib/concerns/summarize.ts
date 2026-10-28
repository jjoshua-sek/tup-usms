import "server-only";

import { anonymizeText, nameTokens } from "@/lib/ai/anonymize";
import { summarizeConcernText } from "@/lib/ai/summarize-concern";
import { isMissingFunction } from "@/lib/supabase/errors";
import { loose, type LooseClient } from "@/lib/supabase/loose";
import { sanitizeText } from "@/lib/utils/sanitize";

/**
 * Summarizes concerns that are waiting for one. Three callers:
 *
 *   submitConcern   the concern just filed, right after the student's
 *                   request finishes (next/server after()), so they never
 *                   wait on the AI
 *   the minute job  sweeps anything that failed or was missed, three
 *                   attempts at most, two minutes apart
 *   Re-analyze      a staff member forcing a fresh summary
 *
 * Claiming (claim_concern_summaries, migration 00023) keeps the first two
 * from both paying to summarize the same concern.
 */

const MAX_ATTEMPTS = 3;

interface ClaimedConcern {
  id: string;
  category: string;
  subject_line: string;
  body_text: string;
  attempts: number;
}

export interface ConcernSummaryOutcome {
  concernId: string;
  ok: boolean;
  error?: string;
}

export interface ConcernSummaryReport {
  claimed: number;
  done: number;
  retrying: number;
  failed: number;
  outcomes: ConcernSummaryOutcome[];
  /** Why nothing was attempted, when that was the case. */
  held?: string;
}

export async function summarizeConcerns(
  options: { limit?: number; concernId?: string; force?: boolean } = {},
): Promise<ConcernSummaryReport> {
  const report: ConcernSummaryReport = { claimed: 0, done: 0, retrying: 0, failed: 0, outcomes: [] };

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = loose(createAdminClient());

  const { data, error } = await db.rpc("claim_concern_summaries", {
    p_limit: options.limit ?? 5,
    p_concern_id: options.concernId ?? null,
    p_force: options.force ?? false,
  });
  if (error) {
    const missing = isMissingFunction(error);
    report.held = missing ? "migration 00023 has not been run" : "could not claim concerns";
    if (!missing) console.error("[concern summary] claim failed", error);
    return report;
  }

  const rows = (data as ClaimedConcern[] | null) ?? [];
  report.claimed = rows.length;
  if (rows.length === 0) return report;

  // Checklist D4: the AI sees the concern without who is in it.
  const names = await loadNameTokens(db);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const result = await summarizeConcernText({
      category: row.category,
      subject: anonymizeText(sanitizeText(row.subject_line, 200), names),
      body: anonymizeText(sanitizeText(row.body_text, 10000), names),
    });

    // An account problem (no credit, bad key) fails every concern alike.
    // Stop, give back the attempt this claim took from each one left in the
    // batch, and leave them pending: once the account is fixed, the minute
    // job summarizes the backlog with nobody pressing anything.
    if (!result.ok && result.hold) {
      report.held = result.error;
      for (const pending of rows.slice(index)) {
        report.outcomes.push({ concernId: pending.id, ok: false, error: result.error });
        await db
          .from("concerns")
          .update({
            ai_summary_status: "pending",
            ai_summary_attempts: Math.max(pending.attempts - 1, 0),
            ai_summary_error: result.error,
          })
          .eq("id", pending.id);
      }
      break;
    }

    if (result.ok) {
      report.done += 1;
      report.outcomes.push({ concernId: row.id, ok: true });
      const { error: saveError } = await db
        .from("concerns")
        .update({
          ai_summary: result.summary.summary,
          urgency_level: result.summary.urgency,
          suggested_dept: result.summary.suggested_department,
          ai_key_issues: result.summary.key_issues,
          ai_summary_status: "done",
          ai_summary_model: result.model,
          ai_summarized_at: new Date().toISOString(),
          ai_summary_error: null,
        })
        .eq("id", row.id);
      if (saveError) console.error("[concern summary] save failed", row.id, saveError);
      continue;
    }

    const final = !result.retryable || row.attempts >= MAX_ATTEMPTS;
    if (final) report.failed += 1;
    else report.retrying += 1;
    report.outcomes.push({ concernId: row.id, ok: false, error: result.error });

    await db
      .from("concerns")
      .update({
        ai_summary_status: final ? "failed" : "pending",
        ai_summary_error: result.error.slice(0, 500),
      })
      .eq("id", row.id);
  }

  return report;
}

const PAGE = 1000;

/**
 * Every student's and staff member's name, as tokens for anonymizeText. Read
 * a page at a time, since the API returns at most 1,000 rows per request.
 * If a read fails, the patterns (titles, numbers, emails) still apply.
 */
async function loadNameTokens(db: LooseClient): Promise<Set<string>> {
  const people: Array<{ first: string | null; last: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("students").select("first_name, last_name").range(from, from + PAGE - 1);
    if (error) {
      console.error("[concern summary] could not read student names", error);
      break;
    }
    const page = (data as Array<{ first_name: string | null; last_name: string | null }> | null) ?? [];
    people.push(...page.map((row) => ({ first: row.first_name, last: row.last_name })));
    if (page.length < PAGE) break;
  }
  const { data: staffRows } = await db.from("staff").select("full_name");
  for (const row of (staffRows as Array<{ full_name: string | null }> | null) ?? []) {
    people.push({ first: row.full_name, last: null });
  }
  return nameTokens(people);
}
