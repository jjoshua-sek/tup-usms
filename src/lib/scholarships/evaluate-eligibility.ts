/**
 * Scholarship eligibility engine — requirement #3.
 *
 * Evaluates a student's profile against each scholarship's criteria rows
 * and reports where they qualify plus what documents they would need.
 *
 * SCOPE BOUNDARY: this module answers "am I eligible, and what do I need?"
 * It does not submit applications. Per the OSA process document, collection
 * of forms and issuance of endorsements remain OSA-mediated — the system
 * informs the student, a human does the endorsing.
 *
 * WHY A DATA-DRIVEN RULE ENGINE
 * TUP works with roughly 19 private sponsors, each with criteria dictated
 * by its own MOA/MOU, plus government programs with separate rules. Coding
 * one branch per sponsor would mean a deploy for every new agreement.
 * Here a criterion is a row — adding a sponsor is an INSERT.
 *
 * PHILIPPINE GRADING CONVENTION
 * 1.00 is the highest mark and 5.00 fails. "GWA of at least 1.75" is
 * therefore expressed as `gwa lte 1.75`, and the comparison helpers here
 * deliberately do no inversion — the operator in the data already carries
 * the correct direction.
 */

export type CriterionOperator =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "in"
  | "not_in"
  | "is_true"
  | "is_false";

export type CriterionKey =
  // Academic
  | "gwa"
  | "units_enrolled"
  | "year_level"
  | "program"
  | "department"
  | "scholastic_status"
  | "no_failing_grades"
  // Conduct
  | "no_major_violations"
  | "no_pending_cases"
  | "max_minor_violations"
  // Socioeconomic
  | "family_income_bracket"
  | "is_listahan"
  | "is_indigenous"
  | "is_pwd"
  | "financial_support"
  // Other
  | "is_graduating"
  | "residency_province"
  | "has_no_other_scholarship";

export interface ScholarshipCriterion {
  id: string;
  scholarship_id: string;
  criterion_key: CriterionKey;
  operator: CriterionOperator;
  value: unknown;
  is_mandatory: boolean;
  human_description: string;
  display_order: number;
}

export interface ScholarshipRequirement {
  id: string;
  requirement_name: string;
  description: string | null;
  document_type: string | null;
  is_mandatory: boolean;
  obtained_from: string | null;
  display_order: number;
}

/**
 * Everything the evaluator needs about a student, assembled by the caller
 * from students / academic_snapshots / violation_cases.
 *
 * Nullable fields mean "unknown," which produces an `indeterminate`
 * result rather than a silent failure — a student with no uploaded rating
 * slip should be told to upload one, not told they do not qualify.
 */
export interface StudentEligibilityProfile {
  student_id: string;

  // Academic (from the latest verified academic_snapshot)
  gwa: number | null;
  units_enrolled: number | null;
  units_failed: number | null;
  year_level: string | null;
  program: string | null;
  department: string | null;
  scholastic_status: string | null;

  // Conduct (aggregated from violation_cases)
  major_violation_count: number;
  minor_violation_count: number;
  open_case_count: number;

  // Socioeconomic (from the student profile)
  is_listahan: boolean;
  is_indigenous: boolean;
  is_pwd: boolean;
  financial_support: string | null;
  family_income_bracket: string | null;
  residency_province: string | null;

  // Other
  is_graduating: boolean;
  has_active_scholarship: boolean;
}

export type EligibilityStatus =
  | "eligible"
  | "partially_eligible"
  | "not_eligible"
  | "indeterminate";

export interface CriterionResult {
  criterion_id: string;
  criterion_key: CriterionKey;
  human_description: string;
  is_mandatory: boolean;
  /** true = passed, false = failed, null = could not evaluate. */
  passed: boolean | null;
  expected: string;
  actual: string;
  /** Guidance shown when the criterion fails or cannot be evaluated. */
  hint?: string;
}

export interface EligibilityResult {
  scholarship_id: string;
  status: EligibilityStatus;
  passed: CriterionResult[];
  failed: CriterionResult[];
  /** Criteria that could not be evaluated for lack of data. */
  indeterminate: CriterionResult[];
  /** Share of mandatory criteria satisfied, 0–100. */
  matchPercentage: number;
  /** One-line verdict for the student-facing card. */
  summary: string;
}

// ============================================================
// Value resolution
// ============================================================

/**
 * Maps a criterion key onto the corresponding value in the student profile.
 * Returns `undefined` when the value is unknown, which the caller treats
 * as indeterminate rather than as a failure.
 */
function resolveStudentValue(
  key: CriterionKey,
  profile: StudentEligibilityProfile
): unknown {
  switch (key) {
    case "gwa":
      return profile.gwa ?? undefined;
    case "units_enrolled":
      return profile.units_enrolled ?? undefined;
    case "year_level":
      return profile.year_level ?? undefined;
    case "program":
      return profile.program ?? undefined;
    case "department":
      return profile.department ?? undefined;
    case "scholastic_status":
      return profile.scholastic_status ?? undefined;

    // Derived booleans — these are computed, never stored.
    case "no_failing_grades":
      return profile.units_failed == null ? undefined : profile.units_failed === 0;
    case "no_major_violations":
      return profile.major_violation_count === 0;
    case "no_pending_cases":
      return profile.open_case_count === 0;
    case "max_minor_violations":
      return profile.minor_violation_count;

    case "family_income_bracket":
      return profile.family_income_bracket ?? undefined;
    case "is_listahan":
      return profile.is_listahan;
    case "is_indigenous":
      return profile.is_indigenous;
    case "is_pwd":
      return profile.is_pwd;
    case "financial_support":
      return profile.financial_support ?? undefined;

    case "is_graduating":
      return profile.is_graduating;
    case "residency_province":
      return profile.residency_province ?? undefined;
    case "has_no_other_scholarship":
      return !profile.has_active_scholarship;
  }
}

/** Renders a value for display in the pass/fail detail rows. */
function displayValue(v: unknown): string {
  if (v === undefined || v === null) return "not on file";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "number") return String(v);
  return String(v);
}

function describeExpectation(op: CriterionOperator, value: unknown): string {
  switch (op) {
    case "eq":
      return `equal to ${displayValue(value)}`;
    case "neq":
      return `not ${displayValue(value)}`;
    case "gte":
      return `at least ${displayValue(value)}`;
    case "lte":
      return `at most ${displayValue(value)}`;
    case "gt":
      return `more than ${displayValue(value)}`;
    case "lt":
      return `less than ${displayValue(value)}`;
    case "in":
      return `one of: ${displayValue(value)}`;
    case "not_in":
      return `not one of: ${displayValue(value)}`;
    case "is_true":
      return "yes";
    case "is_false":
      return "no";
  }
}

/** Actionable guidance for a criterion the student currently fails. */
function hintFor(key: CriterionKey, passed: boolean | null): string | undefined {
  if (passed === true) return undefined;

  if (passed === null) {
    switch (key) {
      case "gwa":
      case "no_failing_grades":
        return "Upload your latest rating slip so we can check this.";
      case "units_enrolled":
        return "Upload your Certificate of Registration so we can check this.";
      case "year_level":
      case "program":
      case "department":
        return "Complete your profile so we can check this.";
      default:
        return "Some information is missing from your record.";
    }
  }

  switch (key) {
    case "no_pending_cases":
      return "Resolve your open disciplinary case to qualify.";
    case "no_major_violations":
      return "This scholarship requires a clean major-offense record.";
    case "gwa":
      return "Your general weighted average does not currently meet the threshold.";
    case "units_enrolled":
      return "You may need to enroll in more units to qualify.";
    case "has_no_other_scholarship":
      return "This grant cannot be combined with your current scholarship.";
    case "is_graduating":
      return "This is limited to graduating students.";
    default:
      return undefined;
  }
}

// ============================================================
// Comparison
// ============================================================

/**
 * Applies one operator. Returns null when the comparison cannot be made —
 * either the student value is unknown, or the types are mismatched.
 */
function compare(
  actual: unknown,
  operator: CriterionOperator,
  expected: unknown
): boolean | null {
  // Boolean operators are meaningful even on a falsy value, so they are
  // checked before the general undefined guard.
  if (operator === "is_true") {
    if (typeof actual !== "boolean") return null;
    return actual === true;
  }
  if (operator === "is_false") {
    if (typeof actual !== "boolean") return null;
    return actual === false;
  }

  if (actual === undefined || actual === null) return null;

  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;

    case "gte":
    case "lte":
    case "gt":
    case "lt": {
      const a = Number(actual);
      const e = Number(expected);
      if (Number.isNaN(a) || Number.isNaN(e)) return null;
      if (operator === "gte") return a >= e;
      if (operator === "lte") return a <= e;
      if (operator === "gt") return a > e;
      return a < e;
    }

    case "in":
      return Array.isArray(expected) ? expected.includes(actual) : null;
    case "not_in":
      return Array.isArray(expected) ? !expected.includes(actual) : null;
  }
}

// ============================================================
// Evaluation
// ============================================================

export function evaluateScholarship(
  scholarshipId: string,
  criteria: ScholarshipCriterion[],
  profile: StudentEligibilityProfile
): EligibilityResult {
  const passed: CriterionResult[] = [];
  const failed: CriterionResult[] = [];
  const indeterminate: CriterionResult[] = [];

  const ordered = [...criteria].sort((a, b) => a.display_order - b.display_order);

  for (const c of ordered) {
    const actual = resolveStudentValue(c.criterion_key, profile);
    const result = compare(actual, c.operator, c.value);

    const entry: CriterionResult = {
      criterion_id: c.id,
      criterion_key: c.criterion_key,
      human_description: c.human_description,
      is_mandatory: c.is_mandatory,
      passed: result,
      expected: describeExpectation(c.operator, c.value),
      actual: displayValue(actual),
      hint: hintFor(c.criterion_key, result),
    };

    if (result === true) passed.push(entry);
    else if (result === false) failed.push(entry);
    else indeterminate.push(entry);
  }

  // ---- Status determination ----
  const mandatoryFailed = failed.filter((f) => f.is_mandatory);
  const mandatoryIndeterminate = indeterminate.filter((i) => i.is_mandatory);
  const optionalFailed = failed.filter((f) => !f.is_mandatory);

  let status: EligibilityStatus;
  let summary: string;

  if (mandatoryFailed.length > 0) {
    // A failed mandatory criterion is decisive, even if data is missing
    // elsewhere — the student cannot qualify regardless.
    status = "not_eligible";
    const first = mandatoryFailed[0];
    summary =
      mandatoryFailed.length === 1
        ? `Not eligible: ${first.human_description.toLowerCase()}.`
        : `Not eligible: ${mandatoryFailed.length} requirements not met.`;
  } else if (mandatoryIndeterminate.length > 0) {
    status = "indeterminate";
    summary = `We need more information — ${mandatoryIndeterminate.length} requirement${
      mandatoryIndeterminate.length === 1 ? "" : "s"
    } could not be checked.`;
  } else if (optionalFailed.length > 0) {
    // All mandatory criteria pass; only preferences are unmet. Sponsors
    // routinely waive preferences, so the student still sees this.
    status = "partially_eligible";
    summary = `You meet all required criteria. ${optionalFailed.length} preferred criteri${
      optionalFailed.length === 1 ? "on is" : "a are"
    } not met.`;
  } else {
    status = "eligible";
    summary = "You meet all criteria for this scholarship.";
  }

  // ---- Match percentage, over mandatory criteria only ----
  const mandatoryTotal = ordered.filter((c) => c.is_mandatory).length;
  const mandatoryPassed = passed.filter((p) => p.is_mandatory).length;
  const matchPercentage =
    mandatoryTotal === 0 ? 100 : Math.round((mandatoryPassed / mandatoryTotal) * 100);

  return {
    scholarship_id: scholarshipId,
    status,
    passed,
    failed,
    indeterminate,
    matchPercentage,
    summary,
  };
}

/** Evaluates a batch and returns the best matches first. */
export function evaluateAllScholarships(
  scholarships: Array<{ id: string; criteria: ScholarshipCriterion[] }>,
  profile: StudentEligibilityProfile
): EligibilityResult[] {
  const results = scholarships.map((s) =>
    evaluateScholarship(s.id, s.criteria, profile)
  );

  const rank: Record<EligibilityStatus, number> = {
    eligible: 0,
    partially_eligible: 1,
    indeterminate: 2,
    not_eligible: 3,
  };

  return results.sort((a, b) => {
    const byStatus = rank[a.status] - rank[b.status];
    return byStatus !== 0 ? byStatus : b.matchPercentage - a.matchPercentage;
  });
}

/**
 * Builds the document checklist a student needs to gather, annotated with
 * which items OSA has already received.
 */
export function buildRequirementChecklist(
  requirements: ScholarshipRequirement[],
  submitted: Array<{ requirement_id: string; verified: boolean }> = []
): Array<ScholarshipRequirement & { submitted: boolean; verified: boolean }> {
  const submittedMap = new Map(submitted.map((s) => [s.requirement_id, s]));

  return [...requirements]
    .sort((a, b) => a.display_order - b.display_order)
    .map((r) => {
      const record = submittedMap.get(r.id);
      return {
        ...r,
        submitted: record != null,
        verified: record?.verified ?? false,
      };
    });
}

// ============================================================
// Presentation
// ============================================================

export const ELIGIBILITY_STATUS_META: Record<
  EligibilityStatus,
  { label: string; tone: "success" | "warning" | "neutral" | "danger" }
> = {
  eligible: { label: "Eligible", tone: "success" },
  partially_eligible: { label: "Likely eligible", tone: "warning" },
  indeterminate: { label: "More info needed", tone: "neutral" },
  not_eligible: { label: "Not eligible", tone: "danger" },
};
