import { z } from "zod";

/**
 * Validation schemas for the OSA discipline module.
 *
 * Classification drives the entire downstream flow (see the OSA process
 * flowchart §3.1), so it is captured at filing time and validated here:
 *   minor        → administrative counselling + written apology
 *   major        → summons → conference → mediation → settle or escalate
 *   confidential → referred directly to CODI, bypassing the OSA flow
 */

export const OFFENSE_CLASSIFICATIONS = ["minor", "major", "confidential"] as const;

export const CASE_STATUS_VALUES = [
  "filed",
  "under_review",
  "counselling_scheduled",
  "awaiting_apology",
  "summons_sent",
  "hearing_scheduled",
  "hearing_completed",
  "in_mediation",
  "settled",
  "escalated_pic",
  "escalated_sdb",
  "referred_codi",
  "sanctioned",
  "dismissed",
  "closed",
] as const;

export const COMPLAINANT_TYPES = [
  "faculty",
  "staff",
  "student",
  "osa_initiated",
  "external",
] as const;

/**
 * Filing a new case. Used by the faculty complaint form and by OSA staff
 * recording a walk-in report.
 */
export const fileCaseSchema = z.object({
  student_id: z.string().uuid("Please select a student"),

  violation_type_id: z.string().uuid("Please select a violation type"),

  // Defaults to the type's classification but may be overridden by OSA at
  // the "Determine Offense Classification" decision point in the flowchart.
  classification: z.enum(OFFENSE_CLASSIFICATIONS, {
    message: "Please select a classification",
  }),

  complainant_type: z.enum(COMPLAINANT_TYPES).default("faculty"),
  complainant_name: z.string().max(200).optional().or(z.literal("")),

  incident_date: z
    .string()
    .min(1, "Incident date is required")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  incident_time: z.string().optional().or(z.literal("")),
  incident_location: z.string().max(200).optional().or(z.literal("")),

  // Minimum length matters here: a two-word description is not enough for a
  // student to understand what they are being accused of, which is a
  // due-process problem, not just a data-quality one.
  description: z
    .string()
    .min(20, "Describe the incident in at least 20 characters")
    .max(5000, "Description must be at most 5,000 characters"),
});

export type FileCaseInput = z.infer<typeof fileCaseSchema>;

/** Updating a case's workflow state. */
export const updateCaseStatusSchema = z.object({
  case_id: z.string().uuid(),
  status: z.enum(CASE_STATUS_VALUES),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

export type UpdateCaseStatusInput = z.infer<typeof updateCaseStatusSchema>;

/** Student-submitted apology letter (minor offense resolution). */
export const apologyLetterSchema = z.object({
  case_id: z.string().uuid(),
  letter_text: z
    .string()
    .min(50, "Your letter should be at least 50 characters")
    .max(5000, "Letter must be at most 5,000 characters"),
});

export type ApologyLetterInput = z.infer<typeof apologyLetterSchema>;

/** Win-win settlement agreement drafted after mediation. */
export const settlementSchema = z.object({
  case_id: z.string().uuid(),
  terms: z
    .string()
    .min(20, "Settlement terms must be at least 20 characters")
    .max(5000),
  student_obligations: z.string().max(2000).optional().or(z.literal("")),
  compliance_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")
    .optional()
    .or(z.literal("")),
});

export type SettlementInput = z.infer<typeof settlementSchema>;

/** Escalation to PIC, SDB, or CODI. */
export const escalationSchema = z.object({
  case_id: z.string().uuid(),
  escalated_to: z.enum(["PIC", "SDB", "CODI"], {
    message: "Select the committee",
  }),
  reason: z
    .string()
    .min(20, "Explain the reason for escalation in at least 20 characters")
    .max(2000),
});

export type EscalationInput = z.infer<typeof escalationSchema>;

/** Recording the outcome of a hearing. */
export const hearingOutcomeSchema = z.object({
  hearing_id: z.string().uuid(),
  outcome: z.enum([
    "settled",
    "escalated",
    "apology_agreed",
    "dismissed",
    "follow_up_required",
    "no_resolution",
  ]),
  meeting_notes: z
    .string()
    .min(10, "Record at least a brief note on what was discussed")
    .max(5000),
});

export type HearingOutcomeInput = z.infer<typeof hearingOutcomeSchema>;
