import { z } from "zod";

/**
 * Message composition schema.
 * Supports both individual and batch messages.
 * Batch messages allow staff to send announcements to
 * filtered groups of students.
 */
export const messageSchema = z.object({
  recipient_id: z.string().uuid("Invalid recipient").optional(),
  subject_line: z
    .string()
    .min(1, "Subject is required")
    .max(200, "Subject must be at most 200 characters"),
  body_text: z
    .string()
    .min(1, "Message body is required")
    .max(10000, "Message must be at most 10,000 characters"),
  is_batch: z.boolean().default(false),
  batch_filter: z
    .object({
      department: z.string().optional(),
      program: z.string().optional(),
      year_level: z.string().optional(),
      section: z.string().optional(),
    })
    .optional(),
});

/**
 * Validate that individual messages have a recipient,
 * and batch messages have at least one filter.
 */
export const messageSubmitSchema = messageSchema.refine(
  (data) => {
    if (data.is_batch) {
      const filter = data.batch_filter;
      return (
        filter &&
        (filter.department || filter.program || filter.year_level || filter.section)
      );
    }
    return !!data.recipient_id;
  },
  {
    message: "Individual messages require a recipient. Batch messages require at least one filter.",
    path: ["recipient_id"],
  }
);

export type MessageInput = z.infer<typeof messageSchema>;
