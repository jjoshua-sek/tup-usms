/**
 * Academic term helpers.
 *
 * ID validation is per-term: a sticker issued for 1st Semester 2026–2027 must
 * stop opening turnstiles once that term ends. Every module that needs "which
 * term is it right now" should call `getCurrentTerm()` so the string stored in
 * `id_validations.school_year` / `.semester` is identical everywhere — the
 * verify path looks the row up by exact match, and a mismatch silently
 * reads as "no validated ID".
 *
 * TUP–Manila calendar (shifted academic year):
 *   Aug – Dec  → 1st Semester
 *   Jan – May  → 2nd Semester
 *   Jun – Jul  → Summer (belongs to the same school year as the 2nd Semester)
 */

export const SEMESTERS = ["1st Semester", "2nd Semester", "Summer"] as const;
export type Semester = (typeof SEMESTERS)[number];

export interface AcademicTerm {
  /** Canonical DB form, e.g. "2026-2027". */
  schoolYear: string;
  semester: Semester;
  /** Display form, e.g. "AY 2026–2027". */
  schoolYearLabel: string;
  /** Display form, e.g. "1st Semester, AY 2026–2027". */
  label: string;
}

export function getCurrentTerm(now: Date = new Date()): AcademicTerm {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed

  let startYear: number;
  let semester: Semester;

  if (month >= 8) {
    // August onwards opens a new school year.
    startYear = year;
    semester = "1st Semester";
  } else if (month >= 6) {
    startYear = year - 1;
    semester = "Summer";
  } else {
    startYear = year - 1;
    semester = "2nd Semester";
  }

  const schoolYear = `${startYear}-${startYear + 1}`;
  const schoolYearLabel = `AY ${startYear}–${startYear + 1}`;

  return {
    schoolYear,
    semester,
    schoolYearLabel,
    label: `${semester}, ${schoolYearLabel}`,
  };
}

/**
 * Has this expiry passed? Lives here rather than inline at call sites because
 * `Date.now()` inside a component body is an impure read — the React Compiler
 * lint rejects it, and it would also make the component unmemoizable.
 */
export function hasExpired(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= now.getTime();
}

/**
 * Last day an ID issued in the given term stays scannable. Used when OSA
 * validates an ID and doesn't set an explicit expiry.
 */
export function defaultTermExpiry(term: AcademicTerm): Date {
  const startYear = Number(term.schoolYear.split("-")[0]);

  switch (term.semester) {
    case "1st Semester":
      // Through the semestral break.
      return new Date(Date.UTC(startYear + 1, 0, 31, 15, 59, 59));
    case "2nd Semester":
      return new Date(Date.UTC(startYear + 1, 5, 30, 15, 59, 59));
    case "Summer":
      return new Date(Date.UTC(startYear + 1, 7, 31, 15, 59, 59));
  }
}
