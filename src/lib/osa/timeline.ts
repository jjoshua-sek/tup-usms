import "server-only";

import type { LooseClient } from "@/lib/supabase/loose";

export interface TimelineEntryInput {
  caseId: string;
  actorId: string | null;
  actorLabel: string;
  /** Must match the event_type CHECK constraint in migration 00007. */
  eventType: string;
  summary: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Appends to a case's history.
 *
 * Lives outside the Server Action files on purpose: every export of a
 * `"use server"` module becomes a callable endpoint, and an endpoint that
 * writes arbitrary timeline entries would let anyone forge case history. The
 * append-only table is only worth something if the only way in is through code
 * that has already decided the entry is true.
 *
 * Never throws into the caller — a failed history write must not roll back the
 * action the history is describing.
 */
export async function addCaseTimelineEntry(
  db: LooseClient,
  entry: TimelineEntryInput,
): Promise<void> {
  try {
    await db.from("case_timeline").insert({
      case_id: entry.caseId,
      actor_id: entry.actorId,
      actor_label: entry.actorLabel,
      event_type: entry.eventType,
      from_status: entry.fromStatus ?? null,
      to_status: entry.toStatus ?? null,
      summary: entry.summary,
      details: entry.details ?? null,
    });
  } catch (error) {
    console.error("[timeline] could not append entry", error);
  }
}
