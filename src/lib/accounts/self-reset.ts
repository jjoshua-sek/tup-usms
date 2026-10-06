/**
 * Whether a "Forgot password?" request may send a link.
 *
 * Pure — no database, no clock — so the rules can be read and tested on
 * their own. The server action looks up the account's invitation, asks this
 * module, and does what it says.
 *
 * The link always goes to the address on the invitation: the personal email
 * from the enrollment list, the one the account was first set up from. The
 * person asking must type that address; it is compared, never used. So the
 * worst a stranger who knows a student's number can do is make the student
 * receive a link they did not ask for, which changes nothing unless the
 * student uses it. The sign-in address (<number>@tup.edu.ph) is not
 * involved, because it may not be a real mailbox.
 *
 * Whatever this decides, the person asking is shown the same message, so the
 * form cannot be used to find out which student numbers exist or which
 * email belongs to whom.
 */

export interface InvitationForReset {
  status: string;
  delivery_email: string;
  sent_at: string | null;
  /** Absent before migration 00022. */
  link_purpose?: "setup" | "reset" | null;
}

export type SelfResetPlan =
  | { action: "queue"; purpose: "setup" | "reset" }
  | {
      action: "ignore";
      reason: "no_invitation" | "email_mismatch" | "already_queued" | "sent_recently";
    };

/** A link sent less than this long ago is not sent again; it is probably still on its way. */
export const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

/** Invitation states after the account was set up: a link now is a reset. */
const SET_UP = new Set(["activated", "password_issued"]);

/** The dispatcher has it or is about to send it. */
const IN_FLIGHT = new Set(["queued", "sending"]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function planSelfReset(input: {
  invitation: InvitationForReset | null;
  email: string;
  now: Date;
}): SelfResetPlan {
  const { invitation, email, now } = input;

  if (!invitation) return { action: "ignore", reason: "no_invitation" };
  if (normalizeEmail(email) !== normalizeEmail(invitation.delivery_email)) {
    return { action: "ignore", reason: "email_mismatch" };
  }
  if (IN_FLIGHT.has(invitation.status)) return { action: "ignore", reason: "already_queued" };
  if (
    invitation.status === "sent" &&
    invitation.sent_at &&
    now.getTime() - new Date(invitation.sent_at).getTime() < RESEND_COOLDOWN_MS
  ) {
    return { action: "ignore", reason: "sent_recently" };
  }

  // A set-up account gets a reset. One that never finished setting up gets
  // its link again, for whatever it was: a first-time setup, or a reset that
  // was sent and not used.
  const purpose = SET_UP.has(invitation.status) ? "reset" : (invitation.link_purpose ?? "setup");
  return { action: "queue", purpose };
}
