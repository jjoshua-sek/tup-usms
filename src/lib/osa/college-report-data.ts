import "server-only";

import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { scoreStudent } from "@/lib/risk/score";
import type { LooseClient } from "@/lib/supabase/loose";
import { CASE_STATUS_META, type CaseStatus } from "@/types/osa";

import type { ReportInput } from "./college-report";

/**
 * Reads what the per-college report counts, through the signed-in staff
 * member's own session, so it counts only what they may see. Shared by the
 * Reports page and its CSV download.
 */
export async function loadCollegeReportInput(
  db: LooseClient,
  term: { schoolYear: string; semester: string },
  termStartIso: string,
): Promise<ReportInput> {
  const [students, cases, concerns, validations, clearances, model, features] = await Promise.all([
    // "*" so the college column (migration 00042) is read once it exists.
    db.from("students").select("*").limit(10000),
    db.from("violation_cases").select("student_id, classification, status, created_at").limit(10000),
    db.from("concerns").select("student_id").gte("created_at", termStartIso).limit(10000),
    db
      .from("id_validations")
      .select("student_id")
      .eq("status", "validated")
      .eq("school_year", term.schoolYear)
      .eq("semester", term.semester)
      .limit(10000),
    db.from("clearance_requests").select("student_id").eq("status", "issued").limit(10000),
    loadActiveRiskModel(db),
    loadRiskFeatures(db, { limit: 10000 }),
  ]);

  const highRisk = model
    ? features
        .filter((row) => ["high", "critical"].includes(scoreStudent(featuresToInputs(row), model).risk_tier))
        .map((row) => ({ student_id: row.student_id }))
    : [];

  return {
    students: ((students.data as Array<{ id: string; program: string | null; college?: string | null }> | null) ?? []).map(
      ({ id, program, college }) => ({ id, program, college }),
    ),
    cases: ((cases.data as Array<{ student_id: string; classification: string; status: CaseStatus; created_at: string }> | null) ?? []).map(
      (row) => ({
        student_id: row.student_id,
        classification: row.classification,
        open: !CASE_STATUS_META[row.status]?.isTerminal,
        thisTerm: row.created_at >= termStartIso,
      }),
    ),
    concernsThisTerm: (concerns.data as Array<{ student_id: string }> | null) ?? [],
    idsValidatedThisTerm: (validations.data as Array<{ student_id: string }> | null) ?? [],
    clearancesIssued: (clearances.data as Array<{ student_id: string }> | null) ?? [],
    highRisk,
  };
}

/** Where "this term" starts for the report: the same five-month window the totals use. */
export function reportTermStart(now = new Date()): string {
  const start = new Date(now);
  start.setMonth(start.getMonth() - 5);
  return start.toISOString();
}
