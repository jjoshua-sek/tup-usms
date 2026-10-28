/**
 * Who must approve a hearing date before the student is summoned (the OSA
 * head's review of the checklist, C1): the faculty complainant. The OSA
 * proposes the date from both schedules; the summons goes out only once the
 * faculty member approves it (approveHearing), or once the OSA approves it
 * on their behalf.
 *
 * Everyone else's cases are dated by the OSA directly: a case the OSA opened
 * itself, a student's complaint, or a complainant with no STARS account.
 * A minor case's counselling session is also the OSA's alone, since the
 * complainant does not attend it. Pure, so the rule can be tested.
 */
export function needsComplainantApproval(input: {
  hearingType: string;
  /** role_type of the staff member who filed as complainant, if any. */
  complainantRole: string | null;
}): boolean {
  if (input.hearingType === "counselling") return false;
  return input.complainantRole === "faculty";
}
