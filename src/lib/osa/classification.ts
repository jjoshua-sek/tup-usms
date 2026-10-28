/**
 * Who classifies a case (the OSA head's review of the checklist, A2): the
 * Student Manual first, through the violation type; the OSA only for an
 * offense the Manual does not list (OTH-01, migration 00049). The sanction
 * is the OSA's either way. Pure, so the rules can be tested.
 */

export const CLASSIFIABLE = ["minor", "major"] as const;
export type OsaClassification = (typeof CLASSIFIABLE)[number];

/** Rows from before 00049 have no flag: they were all classified by the Manual. */
export function isClassificationPending(row: { classification_pending?: boolean | null }): boolean {
  return row.classification_pending === true;
}

/** Said when a step needs the classification an officer has not set yet. */
export const CLASSIFY_FIRST =
  "Classify this case first. The Student Manual does not list its offense, so the OSA decides whether it is minor or major.";

/**
 * Whether an officer may set the classification: only for a type outside
 * the Manual, and only while the case is still open.
 */
export function canClassify(input: { in_handbook?: boolean | null; status: string }): boolean {
  return input.in_handbook === false && !["closed", "dismissed"].includes(input.status);
}
