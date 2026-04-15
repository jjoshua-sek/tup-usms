import { z } from "zod";

/**
 * Concern categories aligned with TUP-Manila's student affairs departments.
 * These map to `suggested_dept` in the AI summarizer output.
 */
export const CONCERN_CATEGORIES = [
  "Academic",
  "Facility",
  "Personal",
  "Financial",
  "Technical",
  "Harassment",
  "Discrimination",
  "Other",
] as const;

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
export const concernSchema = z.object({
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
