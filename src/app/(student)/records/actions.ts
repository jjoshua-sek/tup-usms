"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAcademicExtraction } from "@/lib/ai/run-extraction";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
  documentId?: string;
}

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

const registerSchema = z.object({
  document_type: z.enum(["certificate_of_registration", "rating_slip", "transcript"]),
  school_year: z.string().trim().regex(/^\d{4}-\d{4}$/, {
    message: "School year must look like 2026-2027.",
  }),
  semester: z.enum(["1st Semester", "2nd Semester", "Summer"]),
  file_path: z.string().trim().min(5).max(400),
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.enum(ALLOWED_MIME),
  file_size: z.number().int().positive().max(10 * 1024 * 1024),
});

export type RegisterDocumentInput = z.infer<typeof registerSchema>;

/**
 * Records an uploaded COR / rating slip.
 *
 * The file itself goes straight from the browser to Supabase Storage (the
 * private `academic-documents` bucket added in 00016) — routing a 10 MB scan
 * through a Server Action would mean buffering it in the Node process for no
 * benefit. This action only writes the row that tracks it.
 *
 * The row lands as `uploaded`. Nothing in it feeds the risk model until an
 * OSA officer verifies the extracted figures: an unverified document is a
 * photo of a claim, not a grade.
 */
export async function registerAcademicDocument(
  input: RegisterDocumentInput,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const limit = checkRateLimit({
    identifier: `academic-upload:${user.id}`,
    maxRequests: 10,
    windowSeconds: 3600,
  });
  if (!limit.success) return { error: "Too many uploads. Please try again later." };

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "That file could not be accepted." };
  }

  // The storage policy already scopes writes to the uploader's own folder;
  // this check keeps a crafted payload from pointing the row at someone
  // else's file.
  if (!parsed.data.file_path.startsWith(`${user.id}/`)) {
    return { error: "That file path is not yours." };
  }

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  const { data: inserted, error } = await db
    .from("academic_documents")
    .insert({
      student_id: student.id,
      document_type: parsed.data.document_type,
      school_year: parsed.data.school_year,
      semester: parsed.data.semester,
      file_path: parsed.data.file_path,
      file_name: parsed.data.file_name,
      mime_type: parsed.data.mime_type,
      file_size: parsed.data.file_size,
      processing_status: "uploaded",
    })
    .select("id")
    .maybeSingle();

  if (error) return { error: "Could not save your upload. Please try again." };

  revalidatePath("/records");
  return {
    ok: true,
    documentId: (inserted as { id: string } | null)?.id,
    message: "Uploaded. The OSA will verify it shortly.",
  };
}

/**
 * Kicks off the AI read of a document the student just uploaded.
 *
 * Separate from the upload so the file lands safely first: reading a document
 * takes tens of seconds, and a failure there should never cost the student
 * their upload. If this never runs — network drop, closed tab, no API key —
 * the document simply waits for an OSA officer to read it by hand.
 */
export async function extractMyDocument(documentId: string): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  // Each run costs real money, so it's capped per student per hour.
  const limit = checkRateLimit({
    identifier: `academic-extract:${user.id}`,
    maxRequests: 12,
    windowSeconds: 3600,
  });
  if (!limit.success) {
    return { error: "Too many documents read recently. The OSA can still verify this by hand." };
  }

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  // Ownership check before spending anything: RLS would hide someone else's
  // row from this select, so a mismatch means it isn't theirs.
  const { data: documentRow } = await db
    .from("academic_documents")
    .select("id")
    .eq("id", documentId)
    .eq("student_id", student.id)
    .maybeSingle();
  if (!documentRow) return { error: "That document isn't yours." };

  const outcome = await runAcademicExtraction(documentId);
  if (outcome.error) return { error: outcome.error };

  revalidatePath("/records");
  return {
    ok: true,
    message:
      outcome.confidence != null && outcome.confidence < 0.6
        ? "Read, but some figures were hard to make out. The OSA will check them."
        : "Read. The OSA will confirm the figures.",
  };
}
