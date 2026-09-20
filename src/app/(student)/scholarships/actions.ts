"use server";

import { revalidatePath } from "next/cache";

import { getCurrentTerm } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Declare interest in a scholarship.
 *
 * Deliberately NOT an application. The USMS does not submit anything to a
 * sponsor on a student's behalf — most TUP scholarships are still filed at
 * the OSA window or on the sponsor's own portal, and auto-applying would put
 * the university's name on a claim the student never reviewed.
 *
 * What this does is put the student on the OSA's list for that scholarship so
 * staff can hand them the requirement checklist and track the cohort.
 */
export async function declareScholarshipInterest(
  scholarshipId: string,
): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const limit = checkRateLimit({
    identifier: `scholarship-interest:${user.id}`,
    maxRequests: 20,
    windowSeconds: 3600,
  });
  if (!limit.success) return { error: "Too many requests. Try again later." };

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  const term = getCurrentTerm();

  const { data: existingRow } = await db
    .from("scholarship_applications")
    .select("id, status")
    .eq("student_id", student.id)
    .eq("scholarship_id", scholarshipId)
    .eq("school_year", term.schoolYear)
    .maybeSingle();

  if (existingRow) {
    return { ok: true, message: "You're already on the OSA's list for this scholarship." };
  }

  const { error } = await db.from("scholarship_applications").insert({
    student_id: student.id,
    scholarship_id: scholarshipId,
    status: "interest_declared",
    school_year: term.schoolYear,
    semester: term.semester,
  });

  if (error) return { error: "Could not record your interest. Please try again." };

  revalidatePath("/scholarships");
  return {
    ok: true,
    message: "Noted. Bring your requirements to the OSA to complete the application.",
  };
}
