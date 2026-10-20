"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import {
  CONCERN_ATTACHMENT_BUCKET,
  MAX_CONCERN_FILES,
  attachmentFileProblem,
  attachmentSetProblem,
  listConcernAttachments,
} from "@/lib/concerns/attachments";
import { summarizeConcerns } from "@/lib/concerns/summarize";
import { loose } from "@/lib/supabase/loose";
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
 * 5. INSERT into concerns, then summarize it with the AI (Groq) once this request
 *    has finished (lib/concerns/summarize.ts) — ai_summary/urgency/dept
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

  // Summarize once the student's request has finished, so they never wait
  // on the AI. (The Edge Function + webhook this used to rely on was never
  // deployed; see lib/concerns/summarize.ts.) If this fails or is cut
  // short, the once-a-minute dispatch job picks the concern up.
  after(() => summarizeConcerns({ concernId, limit: 1 }));

  // Audit log
  await logAuditEvent(user.id, "concern_submit", `concerns/${concernId}`, {
    category: sanitized.category,
    subject_line: sanitized.subject_line,
  });

  // Refresh the list
  revalidatePath("/concerns");

  return { success: true, concernId };
}

const uploadedFilesSchema = z
  .array(
    z.object({
      path: z.string().min(5).max(400),
      name: z.string().trim().min(1).max(200),
    }),
  )
  .min(1)
  .max(MAX_CONCERN_FILES);

/**
 * Records the files the form uploaded for a concern it has just filed.
 *
 * The files go browser → Storage (the private bucket from 00033) after the
 * concern exists, so they can sit in its folder:
 * <auth uid>/<concern id>/. Only paths and display names travel through
 * here. Sizes and types are read back from Storage rather than taken from
 * the browser, so the limits hold even against a hand-made request.
 */
export async function attachConcernFiles(
  concernId: string,
  files: Array<{ path: string; name: string }>,
): Promise<ActionResult & { attached?: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out, so your files weren't attached." };

  const parsed = uploadedFilesSchema.safeParse(files);
  if (!z.string().uuid().safeParse(concernId).success || !parsed.success) {
    return { error: "Those files could not be attached." };
  }

  const folder = `${user.id}/${concernId}`;
  // The insert policy already pins the first folder to the uploader; this
  // also keeps one concern's row from naming another concern's file.
  const outside = parsed.data.find(
    (file) => !file.path.startsWith(`${folder}/`) || file.path.slice(folder.length + 1).includes("/"),
  );
  if (outside) return { error: "Those files are not yours to attach." };

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  // RLS would show staff any concern; a student only their own. Checking
  // student_id says "theirs", not merely "visible to them".
  const { data: concernRow } = await db
    .from("concerns")
    .select("id")
    .eq("id", concernId)
    .eq("student_id", student.id)
    .maybeSingle();
  if (!concernRow) return { error: "That concern isn't yours." };

  const { data: objects, error: listError } = await supabase.storage
    .from(CONCERN_ATTACHMENT_BUCKET)
    .list(folder, { limit: 100 });
  if (listError) return { error: "Could not check your uploaded files. Please try again." };

  const stored = new Map((objects ?? []).map((object) => [`${folder}/${object.name}`, object]));
  const rows = [];
  for (const file of parsed.data) {
    const object = stored.get(file.path);
    if (!object) return { error: `${file.name} did not finish uploading.` };
    const row = {
      name: file.name,
      size: Number(object.metadata?.size ?? 0),
      type: String(object.metadata?.mimetype ?? ""),
    };
    const problem = attachmentFileProblem(row);
    if (problem) return { error: problem };
    rows.push({ ...row, path: file.path });
  }

  // Count what is already attached too, so the cap is per concern rather
  // than per request.
  const existing = await listConcernAttachments(db, concernId);
  const setProblem = attachmentSetProblem([
    ...existing.map((attachment) => ({
      name: attachment.file_name,
      size: attachment.file_size,
      type: attachment.mime_type,
    })),
    ...rows,
  ]);
  if (setProblem) return { error: setProblem };

  const { error } = await db.from("concern_attachments").insert(
    rows.map((row) => ({
      concern_id: concernId,
      uploaded_by: user.id,
      file_path: row.path,
      file_name: row.name,
      mime_type: row.type,
      file_size: row.size,
    })),
  );
  if (error) {
    console.error("Concern attachment insert failed:", error);
    return { error: "Your files uploaded but could not be attached. Please try again." };
  }

  await logAuditEvent(user.id, "file_upload", `concerns/${concernId}`, {
    category: "concern_attachment",
    files: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.size, 0),
  });

  revalidatePath(`/concerns/${concernId}`);
  revalidatePath(`/staff/concerns/${concernId}`);
  return { success: true, attached: rows.length };
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
