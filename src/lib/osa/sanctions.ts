/**
 * Handbook-derived rules: the minor-offense sanction ladder, the appeal
 * routes, and scholastic standing.
 *
 * Everything in this file is traceable to the TUP Student Handbook rather than
 * to OSA practice, which is why it can be implemented before the office
 * verifies the open process questions. Each export names its source.
 *
 * Pure functions, no I/O — the callers gather the facts, these turn facts into
 * the handbook's answer, and the answer always arrives with its reasoning so a
 * staff member can check it against the page.
 */

// ============================================================
// MINOR OFFENSE LADDER — Table of Offenses (Minor)
// ============================================================

export type MinorSanctionKind = "warning_and_apology" | "community_service";

export interface MinorSanction {
  kind: MinorSanctionKind;
  /** Which offense this is for the student: 1, 2, 3, or beyond. */
  offenseSequence: number;
  label: string;
  /** Prescribed band, in hours. Null for the first offense. */
  bandMin: number | null;
  bandMax: number | null;
  /** Midpoint of the band, as a sensible default for the officer to adjust. */
  suggestedHours: number | null;
  handbookReference: string;
  note: string;
}

/**
 * The ladder as printed: warning plus a letter of apology, then 10–20 hours of
 * community service, then 30–50.
 *
 * The handbook stops at the third offense. A fourth is not addressed, so this
 * holds the third-offense band and says so rather than inventing a fourth rung
 * — escalating beyond the table is the office's call, not ours.
 */
export function prescribeMinorSanction(offenseSequence: number): MinorSanction {
  const sequence = Math.max(1, Math.floor(offenseSequence));

  if (sequence === 1) {
    return {
      kind: "warning_and_apology",
      offenseSequence: 1,
      label: "Warning and a letter of apology",
      bandMin: null,
      bandMax: null,
      suggestedHours: null,
      handbookReference: "Table of Offenses (Minor), first offense",
      note: "The letter must be signed by the student, and by a parent or guardian if applicable.",
    };
  }

  if (sequence === 2) {
    return {
      kind: "community_service",
      offenseSequence: 2,
      label: "10 to 20 hours of community service",
      bandMin: 10,
      bandMax: 20,
      suggestedHours: 15,
      handbookReference: "Table of Offenses (Minor), second offense",
      note: "",
    };
  }

  return {
    kind: "community_service",
    offenseSequence: sequence,
    label: "30 to 50 hours of community service",
    bandMin: 30,
    bandMax: 50,
    suggestedHours: 40,
    handbookReference: "Table of Offenses (Minor), third offense",
    note:
      sequence > 3
        ? "The handbook's table stops at the third offense. Beyond it, consider whether the conduct should be reclassified rather than serving more hours."
        : "",
  };
}

/**
 * How the offense count was arrived at. The handbook prescribes sanctions by
 * offense number but never says over what period the count runs, so the choice
 * is recorded with every assignment instead of being assumed.
 */
export const COUNT_BASES = [
  "cumulative",
  "school_year",
  "term",
  "same_offense",
] as const;
export type CountBasis = (typeof COUNT_BASES)[number];

export const COUNT_BASIS_LABELS: Record<CountBasis, string> = {
  cumulative: "All prior minor offenses on record",
  school_year: "Prior minor offenses this school year",
  term: "Prior minor offenses this term",
  same_offense: "Prior offenses of the same type only",
};

// ============================================================
// APPEALS — Rules on Discipline, Section 9
// ============================================================

export const PENALTY_BASES = [
  "suspension_up_to_30_days",
  "suspension_one_semester",
  "dismissal_or_expulsion",
  "other",
] as const;
export type PenaltyBasis = (typeof PENALTY_BASES)[number];

export type AppellateBody =
  | "vpaa_or_campus_director"
  | "office_of_the_president"
  | "board_of_regents";

export interface AppealRoute {
  penaltyBasis: PenaltyBasis;
  appellateBody: AppellateBody;
  bodyLabel: string;
  penaltyLabel: string;
  /** Days from receipt of the Notice of Decision. */
  days: number;
  handbookReference: string;
  /** Where an adverse decision goes next, where the handbook provides one. */
  furtherRecourse: string | null;
}

const APPEAL_ROUTES: Record<PenaltyBasis, AppealRoute> = {
  suspension_up_to_30_days: {
    penaltyBasis: "suspension_up_to_30_days",
    appellateBody: "vpaa_or_campus_director",
    bodyLabel: "VPAA or Campus Director / Chancellor",
    penaltyLabel: "Suspension of up to 30 days",
    days: 10,
    handbookReference: "Rules on Discipline Sec. 9.2",
    furtherRecourse: null,
  },
  suspension_one_semester: {
    penaltyBasis: "suspension_one_semester",
    appellateBody: "office_of_the_president",
    bodyLabel: "Office of the President",
    penaltyLabel: "Suspension for one semester",
    days: 10,
    handbookReference: "Rules on Discipline Sec. 9.2",
    furtherRecourse: null,
  },
  dismissal_or_expulsion: {
    penaltyBasis: "dismissal_or_expulsion",
    appellateBody: "office_of_the_president",
    bodyLabel: "Office of the President",
    penaltyLabel: "Dismissal or expulsion",
    days: 10,
    handbookReference: "Rules on Discipline Sec. 9.2",
    furtherRecourse:
      "If the President's decision is adverse, it may be appealed to the Board of Regents within 10 days. The Board's decision is final and executory.",
  },
  other: {
    penaltyBasis: "other",
    appellateBody: "vpaa_or_campus_director",
    bodyLabel: "VPAA or Campus Director / Chancellor",
    penaltyLabel: "Other penalty",
    days: 10,
    handbookReference: "Rules on Discipline Sec. 9",
    furtherRecourse: null,
  },
};

export function resolveAppealRoute(basis: PenaltyBasis): AppealRoute {
  return APPEAL_ROUTES[basis];
}

/**
 * Guesses which rung of Sec. 9 a recorded sanction falls under, from the text
 * the committee wrote. A guess, clearly — the officer confirms it, because
 * "suspension" alone doesn't say for how long.
 */
export function inferPenaltyBasis(sanctionText: string | null | undefined): PenaltyBasis {
  const text = (sanctionText ?? "").toLowerCase();
  if (!text) return "other";

  if (/expuls|dismiss/.test(text)) return "dismissal_or_expulsion";
  if (/semester|term/.test(text) && /suspen/.test(text)) return "suspension_one_semester";

  if (/suspen/.test(text)) {
    // "suspension for 45 school days" is past the 30-day rung.
    const days = text.match(/(\d{1,3})\s*(?:school\s*)?day/);
    if (days && Number(days[1]) > 30) return "suspension_one_semester";
    return "suspension_up_to_30_days";
  }

  return "other";
}

export interface AppealWindow {
  deadline: Date;
  /** Negative once the window has closed. */
  daysRemaining: number;
  isOpen: boolean;
}

/**
 * The window runs from receipt of the Notice of Decision, not from the
 * decision date — Sec. 9.2 is specific about that, and the difference is
 * usually several days of mail room.
 */
export function appealWindow(
  noticeReceivedOn: string | Date,
  days = 10,
  now: Date = new Date(),
): AppealWindow {
  const received = new Date(noticeReceivedOn);
  const deadline = new Date(received);
  deadline.setDate(deadline.getDate() + days);

  // Compare whole days: a deadline is a date, not a moment.
  const toDay = (value: Date) =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const daysRemaining = Math.round((toDay(deadline) - toDay(now)) / 86_400_000);

  return { deadline, daysRemaining, isOpen: daysRemaining >= 0 };
}

// ============================================================
// SCHOLASTIC STANDING — Scholastic Delinquency
// ============================================================

export type ScholasticStanding = "regular" | "probationary" | "dismissal_review";

export interface StandingAssessment {
  standing: ScholasticStanding;
  label: string;
  /** Handbook conditions that were met, in plain words. */
  reasons: string[];
  /** Conditions this document cannot answer, named so nobody assumes a pass. */
  notAssessed: string[];
  handbookReference: string;
}

export interface StandingInputs {
  unitsEnrolled: number | null;
  unitsPassed: number | null;
  /** Grades as printed: numbers on the 1.00–5.00 scale, or INC / DRP. */
  grades?: Array<number | string | null | undefined>;
  /** Standing in the previous term, where known. */
  previousStanding?: ScholasticStanding | null;
  /**
   * Dismissal applies only to students NOT in the last two years of a 5-year
   * course, or the last year of a 3- or 4-year course.
   */
  isInFinalYears?: boolean | null;
}

const STANDING_LABELS: Record<ScholasticStanding, string> = {
  regular: "Regular",
  probationary: "Probationary",
  dismissal_review: "For dismissal review",
};

function countFailures(grades: StandingInputs["grades"]): {
  failed: number;
  dropped: number;
  readable: boolean;
} {
  if (!grades || grades.length === 0) return { failed: 0, dropped: 0, readable: false };

  let failed = 0;
  let dropped = 0;

  for (const raw of grades) {
    if (raw == null) continue;
    if (typeof raw === "number") {
      // 5.00 is a failing mark; 4.00 is conditional, not a failure.
      if (raw >= 5) failed += 1;
      continue;
    }
    const text = String(raw).trim().toUpperCase();
    if (text === "DRP" || text === "D" || text === "DROPPED") dropped += 1;
    else if (text === "INC") continue;
    else {
      const numeric = Number(text);
      if (Number.isFinite(numeric) && numeric >= 5) failed += 1;
    }
  }

  return { failed, dropped, readable: true };
}

/**
 * Applies the handbook's Scholastic Delinquency rules to one verified term.
 *
 * Deliberately conservative: where a condition can't be evaluated from the
 * document — an unofficial drop without parental consent leaves no trace on a
 * rating slip — it is listed under `notAssessed` rather than treated as
 * satisfied. A clean result from incomplete data is exactly the kind of false
 * comfort that makes an early warning system useless.
 */
export function assessScholasticStanding(input: StandingInputs): StandingAssessment {
  const reasons: string[] = [];
  const notAssessed: string[] = [];

  const { failed, dropped, readable } = countFailures(input.grades);
  const enrolled = input.unitsEnrolled ?? null;
  const passed = input.unitsPassed ?? null;

  // ---- Probation conditions ----
  if (readable && failed >= 2) {
    reasons.push(`A rating of 5.00 in ${failed} subjects this term.`);
  }

  if (enrolled != null && enrolled > 0 && passed != null) {
    const share = passed / enrolled;
    if (share < 0.75) {
      reasons.push(
        `Passed ${passed} of ${enrolled} units — ${Math.round(share * 100)}%, below the 75% required for the term.`,
      );
    }
  } else {
    notAssessed.push("Whether at least 75% of the term's load was passed (units not readable).");
  }

  if (!readable) {
    notAssessed.push("Number of failing grades (subject grades not readable).");
  }

  // Only the registrar knows whether a drop was unofficial, or whether the
  // parents consented in writing.
  notAssessed.push(
    "Unofficial dropping of three or more subjects without written parental consent — not visible on this document.",
  );

  // ---- Dismissal conditions ----
  const dismissalReasons: string[] = [];
  if (readable && failed >= 3) {
    dismissalReasons.push(`A rating of 5.00 in ${failed} subjects.`);
  }
  if (input.previousStanding === "probationary" && readable && failed + dropped >= 1) {
    dismissalReasons.push("A failing or dropped grade while under probation.");
  }

  if (dismissalReasons.length > 0) {
    if (input.isInFinalYears) {
      // The rule exempts students in their final years, so this stays
      // probationary and says why.
      return {
        standing: "probationary",
        label: STANDING_LABELS.probationary,
        reasons: [
          ...dismissalReasons,
          "Dismissal does not apply in the final years of the programme, so this is recorded as probationary.",
        ],
        notAssessed,
        handbookReference: "Scholastic Delinquency — Probationary Status, Dismissal",
      };
    }

    return {
      standing: "dismissal_review",
      label: STANDING_LABELS.dismissal_review,
      reasons: dismissalReasons,
      notAssessed:
        input.isInFinalYears == null
          ? [
              ...notAssessed,
              "Whether the student is in the final years of the programme, which exempts them from dismissal.",
            ]
          : notAssessed,
      handbookReference: "Scholastic Delinquency — Dismissal",
    };
  }

  if (reasons.length > 0) {
    return {
      standing: "probationary",
      label: STANDING_LABELS.probationary,
      reasons,
      notAssessed,
      handbookReference: "Scholastic Delinquency — Probationary Status",
    };
  }

  return {
    standing: "regular",
    label: STANDING_LABELS.regular,
    reasons: ["No handbook condition for probation was met by the figures on this document."],
    notAssessed,
    handbookReference: "Scholastic Delinquency",
  };
}

/**
 * Honors eligibility — Academic Honors. Two conditions, and the second is a
 * conduct one: no grade below 2.75, and never found guilty of a major offense.
 */
export function honorsDisqualifiers(input: {
  lowestGrade: number | null;
  majorOffenseConvictions: number;
}): string[] {
  const blockers: string[] = [];
  if (input.lowestGrade != null && input.lowestGrade > 2.75) {
    blockers.push(`A grade of ${input.lowestGrade.toFixed(2)} — honors require none below 2.75.`);
  }
  if (input.majorOffenseConvictions > 0) {
    blockers.push(
      `${input.majorOffenseConvictions} major offense conviction on record — honors require none.`,
    );
  }
  return blockers;
}
