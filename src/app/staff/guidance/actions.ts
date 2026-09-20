"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

const sessionSchema = z.object({
  student_number: z.string().trim().min(4).max(20),
  session_type: z.enum([
    "walk_in",
    "scheduled",
    "referral",
    "risk_intervention",
    "disciplinary",
    "follow_up",
    "crisis",
  ]),
  presenting_concern: z.string().trim().max(300).optional().or(z.literal("")),
  concern_category: z.string().trim().max(60).optional().or(z.literal("")),
  summary: z.string().trim().max(2000).optional().or(z.literal("")),
  confidential_notes: z.string().trim().max(5000).optional().or(z.literal("")),
  follow_up_required: z.string().optional(),
  follow_up_date: z.string().optional().or(z.literal("")),
});

/**
 * Logs a counselling session.
 *
 * Two fields, two audiences. `summary` is the shareable record — enough for
 * the OSA to know a session happened and whether follow-up is due.
 * `confidential_notes` is the counselor's own file: RLS marks these rows
 * 'counselor_only', so nobody else in the system can read them, including
 * the OSA head. That separation is what makes students willing to talk.
 */
export async function logGuidanceSession(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff || (!staff.isCounselor && staff.role !== "osa_head" && !staff.isAdmin)) {
    return { error: "Only guidance counselors can log sessions." };
  }

  const parsed = sessionSchema.safeParse({
    student_number: formData.get("student_number"),
    session_type: formData.get("session_type"),
    presenting_concern: formData.get("presenting_concern") ?? "",
    concern_category: formData.get("concern_category") ?? "",
    summary: formData.get("summary") ?? "",
    confidential_notes: formData.get("confidential_notes") ?? "",
    follow_up_required: formData.get("follow_up_required") ?? undefined,
    follow_up_date: formData.get("follow_up_date") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the session details." };
  }

  const db = loose(createAdminClient());

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("student_number", parsed.data.student_number.toUpperCase())
    .maybeSingle();

  const student = studentRow as { id: string } | null;
  if (!student) return { error: "No student with that number." };

  const now = new Date().toISOString();
  const hasConfidential = Boolean(parsed.data.confidential_notes);

  const { error } = await db.from("guidance_sessions").insert({
    student_id: student.id,
    counselor_id: staff.staffId,
    session_type: parsed.data.session_type,
    started_at: now,
    ended_at: now,
    status: "completed",
    presenting_concern: parsed.data.presenting_concern
      ? sanitizeText(parsed.data.presenting_concern, 300)
      : null,
    concern_category: parsed.data.concern_category || null,
    summary: parsed.data.summary ? sanitizeText(parsed.data.summary, 2000) : null,
    confidential_notes: hasConfidential
      ? sanitizeText(parsed.data.confidential_notes!, 5000)
      : null,
    follow_up_required: parsed.data.follow_up_required === "on",
    follow_up_date: parsed.data.follow_up_date || null,
    confidentiality: hasConfidential ? "counselor_only" : "restricted",
  });

  if (error) return { error: "Could not save the session." };

  revalidatePath("/staff/guidance");
  return { ok: true, message: "Session logged." };
}
