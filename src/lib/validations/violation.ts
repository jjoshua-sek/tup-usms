import { z } from "zod";

/**
 * Violation severity levels following TUP-Manila's Student Handbook
 * disciplinary classifications.
 */
export const VIOLATION_SEVERITIES = ["minor", "major", "grave"] as const;

export const VIOLATION_STATUSES = [
  "active",
  "appealed",
  "served",
  "dismissed",
] as const;

/**
 * Violation recording schema — staff only.
 * description minimum of 10 chars ensures the violation
 * is documented thoroughly enough for due process.
 */
export const violationSchema = z.object({
  student_id: z.string().uuid("Invalid student ID"),
  violation_type: z
    .string()
    .min(1, "Violation type is required")
    .max(200, "Violation type is too long"),
  description: z
    .string()
    .min(10, "Please provide a detailed description (at least 10 characters)")
    .max(5000, "Description must be at most 5,000 characters"),
  severity: z.enum(VIOLATION_SEVERITIES, {
    message: "Please select a severity level",
  }),
  sanction: z.string().max(1000).optional().or(z.literal("")),
  incident_date: z.coerce.date({
    message: "Incident date is required",
  }),
});

export type ViolationInput = z.infer<typeof violationSchema>;
