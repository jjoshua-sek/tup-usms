"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

const submitSchema = z
  .object({
    case_id: z.string().uuid(),
    letter_text: z.string().trim().max(5000).optional().or(z.literal("")),
    file_path: z.string().trim().max(400).optional().or(z.literal("")),
    file_name: z.string().trim().max(200).optional().or(z.literal("")),
  })
  .refine(
    (value) => (value.letter_text && value.letter_text.length >= 80) || value.file_path,
    {
      message:
        "Write at least a few sentences, or attach a photo of your signed letter.",
      path: ["letter_text"],
    },
  );

/**
 * Student submits the written apology that closes a MINOR case.
 *
 * Two guards matter here beyond RLS:
 *   - the case must actually be at `awaiting_apology`. A letter filed against
 *     a case at any other stage is noise in the record, and a student who has
 *     already been cleared shouldn't be able to re-open the exchange.
 *   - a letter already accepted is final. Re-submitting after acceptance
 *     would let a student paper over the version staff actually read.
 *
 * The case status is NOT advanced here. An apology is submitted, then judged;
 * only the OSA's acceptance closes the case.
 */
export async function submitApologyLetter(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const limit = checkRateLimit({
    identifier: `apology:${user.id}`,
    maxRequests: 10,
    windowSeconds: 3600,
  });
  if (!limit.success) return { error: "Too many submissions. Try again later." };

  const parsed = submitSchema.safeParse({
    case_id: formData.get("case_id"),
    letter_text: formData.get("letter_text") ?? "",
    file_path: formData.get("file_path") ?? "",
    file_name: formData.get("file_name") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your letter." };
  }

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  // Ownership is enforced by RLS too; this check is what produces a readable
  // message instead of a silent zero-row write.
  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, status, student_id, case_number")
    .eq("id", parsed.data.case_id)
    .eq("student_id", student.id)
    .maybeSingle();

  const violationCase = caseRow as {
    id: string;
    status: string;
    case_number: string;
  } | null;
  if (!violationCase) return { error: "That case isn't yours." };

  if (violationCase.status !== "awaiting_apology") {
    return {
      error:
        "This case isn't waiting for an apology letter right now. Check with the OSA if you think that's wrong.",
    };
  }

  const { data: existingRows } = await db
    .from("apology_letters")
    .select("id, review_status")
    .eq("case_id", violationCase.id)
    .order("submitted_at", { ascending: false })
    .limit(1);

  const latest = ((existingRows as Array<{ review_status: string }> | null) ?? [])[0];
  if (latest?.review_status === "accepted") {
    return { ok: true, message: "Your letter has already been accepted." };
  }
  if (latest?.review_status === "pending") {
    return { ok: true, message: "Your letter is already with the OSA for review." };
  }

  if (parsed.data.file_path && !parsed.data.file_path.startsWith(`${user.id}/`)) {
    return { error: "That file path is not yours." };
  }

  const { error } = await db.from("apology_letters").insert({
    case_id: violationCase.id,
    student_id: student.id,
    letter_text: parsed.data.letter_text
      ? sanitizeText(parsed.data.letter_text, 5000)
      : null,
    file_path: parsed.data.file_path || null,
    review_status: "pending",
  });

  if (error) return { error: "Could not submit your letter. Please try again." };

  revalidatePath("/violations");
  return {
    ok: true,
    message: "Submitted. The OSA will read it and let you know.",
  };
}
