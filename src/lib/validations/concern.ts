import { z } from "zod";

/**
 * Concern categories aligned with TUP-Manila's student affairs departments.
 * These map to `suggested_dept` in the AI summarizer output.
 */
/** What staff may record at the counter: a complaint from staff is a case instead. */
export const STAFF_CONCERN_CATEGORIES = [
  "Academic",
  "Facility",
  "Personal",
  "Financial",
  "Technical",
  "Harassment",
  "Discrimination",
  "Other",
] as const;

export const CONCERN_CATEGORIES = [
  ...STAFF_CONCERN_CATEGORIES,
  // A student's complaint against another student (checklist A3, migration
  // 00050). The OSA files the case from it; staff file cases directly.
  "Complaint",
] as const;

/** How a category reads in a list or a form. */
export function concernCategoryLabel(category: string): string {
  return category === "Complaint" ? "Complaint against a student" : category;
}

export const CONCERN_STATUSES = [
  "pending",
  "in_review",
  "resolved",
  "closed",
] as const;

export const URGENCY_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

/**
 * Concern submission schema.
 * body_text minimum of 20 chars ensures substantive concerns
 * that the AI can meaningfully summarize.
 */
/** The fields every concern has; staff intake (lib/concerns/intake.ts) extends these. */
export const concernFields = z.object({
  category: z.enum(CONCERN_CATEGORIES, {
    message: "Please select a concern category",
  }),
  subject_line: z
    .string()
    .min(5, "Subject must be at least 5 characters")
    .max(200, "Subject must be at most 200 characters"),
  body_text: z
    .string()
    .min(20, "Please describe your concern in at least 20 characters")
    .max(10000, "Concern text must be at most 10,000 characters"),
});

export const concernSchema = concernFields
  .extend({
    // A complaint against a student only (category "Complaint").
    respondent_name: z.string().trim().max(120).optional().or(z.literal("")),
    respondent_details: z.string().trim().max(200).optional().or(z.literal("")),
    incident_date: z.string().optional().or(z.literal("")),
    incident_location: z.string().trim().max(120).optional().or(z.literal("")),
  })
  .superRefine((value, ctx) => {
    if (value.category !== "Complaint") return;
    if ((value.respondent_name ?? "").trim().length < 2) {
      ctx.addIssue({ code: "custom", path: ["respondent_name"], message: "Name the student the complaint is against." });
    }
    const date = value.incident_date ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      ctx.addIssue({ code: "custom", path: ["incident_date"], message: "Give the date it happened." });
    } else if (date > manilaToday()) {
      ctx.addIssue({ code: "custom", path: ["incident_date"], message: "The date is in the future." });
    }
  });

/** Today's date in Manila as YYYY-MM-DD, for comparing with a date input. */
function manilaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

/**
 * Staff concern response schema.
 */
export const concernResponseSchema = z.object({
  concern_id: z.string().uuid(),
  response_text: z
    .string()
    .min(1, "Response cannot be empty")
    .max(10000, "Response must be at most 10,000 characters"),
});

/**
 * Staff concern status update schema.
 */
export const concernStatusUpdateSchema = z.object({
  status: z.enum(CONCERN_STATUSES),
  assigned_to: z.string().uuid().optional().nullable(),
});

export type ConcernInput = z.infer<typeof concernSchema>;
export type ConcernResponseInput = z.infer<typeof concernResponseSchema>;
export type ConcernStatusUpdate = z.infer<typeof concernStatusUpdateSchema>;
