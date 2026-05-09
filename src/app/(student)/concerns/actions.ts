"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { concernSchema } from "@/lib/validations/concern";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface ActionResult {
  success?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  concernId?: string;
}

/**
 * Submit a new concern.
 *
 * Flow:
 * 1. Authenticate the user (RLS will also enforce, but defense in depth)
 * 2. Validate form data with Zod
 * 3. Sanitize text inputs (strip null bytes, enforce length)
 * 4. Look up the student's id from the students table
 * 5. INSERT into concerns — this triggers the Supabase webhook → Edge Function
 *    → Anthropic Claude API → updates the row with ai_summary/urgency/dept
 * 6. Audit log the submission
 * 7. revalidatePath() so the list refreshes immediately
 */
export async function submitConcern(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to submit a concern." };
  }

  // Validate
  const parsed = concernSchema.safeParse({
    category: formData.get("category"),
    subject_line: formData.get("subject_line"),
    body_text: formData.get("body_text"),
  });

  if (!parsed.success) {
    return {
      error: "Please check your input.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Sanitize
  const sanitized = {
    category: parsed.data.category,
    subject_line: sanitizeText(parsed.data.subject_line, 200),
    body_text: sanitizeText(parsed.data.body_text, 10000),
  };

  // Look up student record
  const { data: studentRaw } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as { id: string } | null;
  if (!student) {
    return {
      error:
        "Your student profile isn't set up yet. Please complete your profile first.",
    };
  }

  // Insert (RLS policy enforces student_id matches)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const { data: insertedRaw, error } = await (supabase as any)
    .from("concerns")
    .insert({
      student_id: student.id,
      category: sanitized.category,
      subject_line: sanitized.subject_line,
      body_text: sanitized.body_text,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Concern insert failed:", error);
    return { error: "Failed to submit concern. Please try again." };
  }

  const concernId = (insertedRaw as { id: string }).id;

  // Audit log
  await logAuditEvent(user.id, "concern_submit", `concerns/${concernId}`, {
    category: sanitized.category,
    subject_line: sanitized.subject_line,
  });

  // Refresh the list
  revalidatePath("/concerns");

  return { success: true, concernId };
}

/**
 * Add a follow-up message to a concern's response thread.
 * Both students and staff can post (RLS enforces who can read which concerns).
 */
export async function addConcernResponse(
  concernId: string,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to reply." };
  }

  const responseText = sanitizeText(
    String(formData.get("response_text") || ""),
    10000
  );

  if (responseText.length < 1) {
    return {
      error: "Reply cannot be empty.",
      fieldErrors: { response_text: ["Please enter a message."] },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("concern_responses").insert({
    concern_id: concernId,
    responder_id: user.id,
    response_text: responseText,
  });

  if (error) {
    console.error("Response insert failed:", error);
    return { error: "Failed to send reply." };
  }

  await logAuditEvent(user.id, "concern_respond", `concerns/${concernId}`, {
    length: responseText.length,
  });

  revalidatePath(`/concerns/${concernId}`);
  revalidatePath(`/staff/concerns/${concernId}`);

  return { success: true };
}

/**
 * Helper used by the form component to redirect after successful submission.
 * Server Actions can call redirect() outside try/catch.
 */
export async function redirectToConcern(concernId: string) {
  redirect(`/concerns/${concernId}`);
}
