import { z } from "zod";

import { STUDENT_NUMBER } from "@/lib/accounts/enrollment";
import { concernSchema } from "@/lib/validations/concern";

/**
 * Concerns the OSA records for a student who raised one some other way than
 * the online form (OSA checklist D2): at the counter, by letter, by email,
 * or through a faculty member (E1, faculty referral). Pure, so the rules can
 * be tested; the form is /staff/concerns/new and the action is in
 * app/staff/concerns/actions.ts.
 */

/** Every way a concern reaches the OSA. 'online' is the student's own form. */
export const RECEIVED_VIA = ["online", "walk_in", "letter", "email", "faculty"] as const;
export type ReceivedVia = (typeof RECEIVED_VIA)[number];

/** The ways staff can record; 'online' is only ever the student's own. */
export const STAFF_RECEIVED_VIA = ["walk_in", "letter", "email", "faculty"] as const satisfies readonly ReceivedVia[];

export const RECEIVED_VIA_LABEL: Record<ReceivedVia, string> = {
  online: "Online form",
  walk_in: "Walk-in",
  letter: "Letter",
  email: "Email",
  faculty: "Through faculty",
};

/** Read from any row, including ones from before migration 00036. */
export function receivedVia(value: unknown): ReceivedVia {
  return (RECEIVED_VIA as readonly unknown[]).includes(value) ? (value as ReceivedVia) : "online";
}

export const staffConcernSchema = concernSchema
  .extend({
    student_number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(STUDENT_NUMBER, "Enter the student number as TUPM-YY-NNNN."),
    received_via: z.enum(STAFF_RECEIVED_VIA, { message: "Choose how the concern reached the OSA." }),
    referred_by: z.string().trim().max(120).optional().default(""),
    follow_up: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.received_via === "faculty" && value.referred_by.length < 2) {
      ctx.addIssue({ code: "custom", path: ["referred_by"], message: "Name the faculty member who referred the student." });
    }
  })
  .transform((value) => ({
    ...value,
    // A referrer only means something for a faculty referral.
    referred_by: value.received_via === "faculty" ? value.referred_by : null,
    // Follow-up flags the student for the At-Risk queue; offered for referrals.
    follow_up: value.received_via === "faculty" && value.follow_up,
  }));

export type StaffConcernInput = z.infer<typeof staffConcernSchema>;

/** Why a referred student shows up as a recommended guidance referral. */
export function referralRationale(referredBy: string, subject: string): string {
  return `Referred by ${referredBy} (faculty): "${subject}". Recorded from a concern the OSA took down.`.slice(0, 1000);
}
