import "server-only";

import type { LooseClient } from "@/lib/supabase/loose";

import type { StudentEligibilityProfile } from "./evaluate-eligibility";

/**
 * Assembles the facts the eligibility rule engine needs about one student.
 *
 * Three sources, deliberately kept separate:
 *   students            — identity + socioeconomic flags the student declared
 *   academic_snapshots  — the latest *verified* term (never raw uploads, so a
 *                         mis-read GWA can't silently qualify someone)
 *   violation_cases     — conduct, counted by classification
 *
 * Anything unknown stays `null`. The engine treats null as "cannot evaluate"
 * and returns `indeterminate` rather than guessing — a student without
 * uploaded grades must not be told they're ineligible when the truth is that
 * nobody has the data yet.
 */
export async function buildStudentEligibilityProfile(
  db: LooseClient,
  studentId: string,
): Promise<StudentEligibilityProfile> {
  const [
    { data: studentRow },
    { data: snapshotRows },
    { data: caseRows },
    { data: awardRows },
  ] = await Promise.all([
    db
      .from("students")
      .select(
        "id, program, department, year_level, is_listahan, is_indigenous, is_pwd, financial_support, address_province",
      )
      .eq("id", studentId)
      .maybeSingle(),
    db
      .from("academic_snapshots")
      .select("gwa, units_enrolled, units_failed, scholastic_status, term_sequence")
      .eq("student_id", studentId)
      .order("term_sequence", { ascending: false })
      .limit(1),
    db
      .from("violation_cases")
      .select("classification, status")
      .eq("student_id", studentId),
    db
      .from("scholarship_applications")
      .select("id, status")
      .eq("student_id", studentId)
      .eq("status", "awarded"),
  ]);

  const student = (studentRow as {
    program: string | null;
    department: string | null;
    year_level: string | null;
    is_listahan: boolean | null;
    is_indigenous: boolean | null;
    is_pwd: boolean | null;
    financial_support: string | null;
    address_province: string | null;
  } | null) ?? null;

  const snapshot = ((snapshotRows as Array<{
    gwa: number | null;
    units_enrolled: number | null;
    units_failed: number | null;
    scholastic_status: string | null;
  }> | null) ?? [])[0];

  const cases = (caseRows as Array<{ classification: string; status: string }> | null) ?? [];

  return {
    student_id: studentId,

    gwa: snapshot?.gwa ?? null,
    units_enrolled: snapshot?.units_enrolled ?? null,
    units_failed: snapshot?.units_failed ?? null,
    year_level: student?.year_level ?? null,
    program: student?.program ?? null,
    department: student?.department ?? null,
    scholastic_status: snapshot?.scholastic_status ?? null,

    major_violation_count: cases.filter((c) => c.classification === "major").length,
    minor_violation_count: cases.filter((c) => c.classification === "minor").length,
    open_case_count: cases.filter(
      (c) => !["closed", "dismissed"].includes(c.status),
    ).length,

    is_listahan: student?.is_listahan ?? false,
    is_indigenous: student?.is_indigenous ?? false,
    is_pwd: student?.is_pwd ?? false,
    financial_support: student?.financial_support ?? null,
    // Not collected in the profile wizard yet; left unknown rather than
    // assumed, so income-gated criteria come back as "more info needed".
    family_income_bracket: null,
    residency_province: student?.address_province ?? null,

    is_graduating: (student?.year_level ?? "").startsWith("4"),
    has_active_scholarship: ((awardRows as unknown[] | null) ?? []).length > 0,
  };
}
