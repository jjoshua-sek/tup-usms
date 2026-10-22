import {
  evaluateScholarship,
  normalizeCriterionKey,
  type CriterionKey,
  type CriterionResult,
  type ScholarshipCriterion,
  type StudentEligibilityProfile,
} from "./evaluate-eligibility";

/**
 * Whether a scholar still meets their scholarship's requirements, term by
 * term (OSA checklist F3: monitor scholars after the award). Pure, so it can
 * be tested; the Scholarships page runs it for every awarded scholar.
 *
 * Only the criteria a scholar must keep are re-checked: grades, load,
 * standing and conduct. Criteria about who may apply (program, year level,
 * income, "has no other scholarship", which a scholar now fails by
 * definition) were settled at the award. Grades come only from verified
 * documents (academic_snapshots), so an unverified upload can neither keep
 * nor cost anyone a scholarship.
 */

export const RETENTION_KEYS: ReadonlySet<CriterionKey> = new Set([
  "gwa",
  "units_enrolled",
  "no_failing_grades",
  "scholastic_status",
  "no_major_violations",
  "no_pending_cases",
  "max_minor_violations",
]);

export type RetentionStatus = "keeps" | "at_risk" | "unknown";

export interface RetentionResult {
  status: RetentionStatus;
  /** The requirements they no longer meet, in the scholarship's own words with their figure. */
  failing: Array<{ description: string; actual: string }>;
  /** Requirements that cannot be checked yet, usually for want of verified grades. */
  unchecked: string[];
  /** One line for the list. */
  summary: string;
}

export function checkRetention(
  scholarshipId: string,
  criteria: ScholarshipCriterion[],
  profile: StudentEligibilityProfile,
): RetentionResult {
  const kept = criteria.filter((criterion) => criterion.is_mandatory && RETENTION_KEYS.has(normalizeCriterionKey(criterion.criterion_key)));
  if (kept.length === 0) {
    return { status: "keeps", failing: [], unchecked: [], summary: "This scholarship sets no grade or conduct requirement to keep." };
  }

  const result = evaluateScholarship(scholarshipId, kept, profile);
  const failing = result.failed.map((criterion: CriterionResult) => ({ description: criterion.human_description, actual: criterion.actual }));
  const unchecked = result.indeterminate.map((criterion: CriterionResult) => criterion.human_description);

  if (failing.length > 0) {
    return {
      status: "at_risk",
      failing,
      unchecked,
      summary: `No longer meets ${failing.length} requirement${failing.length === 1 ? "" : "s"}: ${failing.map((f) => f.description).join("; ")}.`,
    };
  }
  if (unchecked.length > 0) {
    return { status: "unknown", failing, unchecked, summary: "Cannot check yet: no verified grades on file for a requirement." };
  }
  return { status: "keeps", failing, unchecked, summary: "Meets every requirement to keep the scholarship." };
}

export const RETENTION_META: Record<RetentionStatus, { label: string; tone: "success" | "danger" | "neutral" }> = {
  keeps: { label: "Keeps requirements", tone: "success" },
  at_risk: { label: "At risk of losing it", tone: "danger" },
  unknown: { label: "Cannot check yet", tone: "neutral" },
};
