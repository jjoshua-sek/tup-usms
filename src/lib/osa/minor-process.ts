/**
 * How a minor case is handled (OSA checklist A4). Pure, so the rules can be
 * tested; the choice is made on the case page and saved by
 * chooseMinorProcess in app/staff/cases/actions.ts.
 *
 * Counselling followed by an apology letter is the default every researcher
 * agreed on. The officer may instead ask for an apology letter only, or
 * close the case with a written warning: the OSA prefers leniency for minor
 * offenses, and the OSA's former student-body partner described both.
 */

export const MINOR_PROCESSES = ["counselling_apology", "apology_only", "warning_only"] as const;
export type MinorProcess = (typeof MINOR_PROCESSES)[number];

export const MINOR_PROCESS_META: Record<MinorProcess, { label: string; description: string }> = {
  counselling_apology: {
    label: "Counselling, then an apology letter",
    description: "The usual process: schedule a counselling session, then the student writes an apology letter.",
  },
  apology_only: {
    label: "Apology letter only",
    description: "No counselling session. The student is asked for the letter now; accepting it closes the case.",
  },
  warning_only: {
    label: "Written warning only",
    description: "The case closes now with a written warning on the student's record. Nothing more is asked of them.",
  },
};

/** Read from any row, including ones from before migration 00039: none chosen means the default. */
export function minorProcessOf(value: unknown): MinorProcess {
  return (MINOR_PROCESSES as readonly unknown[]).includes(value) ? (value as MinorProcess) : "counselling_apology";
}

/** Case statuses from which the process can still be chosen or changed. */
const CHOOSABLE_FROM = new Set(["filed", "under_review", "counselling_scheduled"]);

export function canChooseMinorProcess(input: { classification: string; status: string }): boolean {
  return input.classification === "minor" && CHOOSABLE_FROM.has(input.status);
}

export interface MinorProcessPlan {
  /** The case's next status, or null to leave it (counselling is scheduled as a hearing). */
  nextStatus: "awaiting_apology" | "closed" | null;
  /** Set when the choice closes the case. */
  resolutionPath: "warning_only" | null;
  sanctionApplied: string | null;
}

export function minorProcessPlan(process: MinorProcess): MinorProcessPlan {
  switch (process) {
    case "apology_only":
      return { nextStatus: "awaiting_apology", resolutionPath: null, sanctionApplied: null };
    case "warning_only":
      return { nextStatus: "closed", resolutionPath: "warning_only", sanctionApplied: "Written warning" };
    default:
      return { nextStatus: null, resolutionPath: null, sanctionApplied: null };
  }
}

/** What an accepted apology letter closes the case as. */
export function apologyResolutionPath(process: unknown): "apology_only" | "counselling_apology" {
  return minorProcessOf(process) === "apology_only" ? "apology_only" : "counselling_apology";
}

/**
 * Said beside the choice when the student has offended before: the
 * handbook's ladder gives community service from the second minor offense
 * (checklist B1, B2), so a warning alone departs from it. Advice, not a
 * block; the officer decides.
 */
export function repeatOffenseAdvice(priorMinorOffenses: number): string | null {
  if (priorMinorOffenses <= 0) return null;
  return priorMinorOffenses === 1
    ? "This is the student's 2nd minor offense. The handbook prescribes 10 to 20 hours of community service, not a warning alone."
    : `This is the student's ${ordinal(priorMinorOffenses + 1)} minor offense. The handbook prescribes 30 to 50 hours of community service, not a warning alone.`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
