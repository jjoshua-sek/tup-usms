"use server";

import { revalidatePath } from "next/cache";

import { getCurrentTerm } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import type { IdValidationStatus } from "@/types/osa";

interface ActionResult {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Ask the OSA to validate this student's ID for the current term.
 *
 * Validation is what makes a card open turnstiles: the gate looks for a row
 * in `id_validations` with status 'validated' for the running school year and
 * semester. Students can queue the request from the portal, but only OSA staff
 * can move it to 'validated' — the RLS policy from 00013 lets a student INSERT
 * their own row and nothing more.
 */
export async function requestIdValidation(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out. Please sign in again." };

  // Requests are cheap for us and rare for them; this only stops accidental
  // double-taps and scripted spam.
  const limit = checkRateLimit({
    identifier: `id-validation:${user.id}`,
    maxRequests: 5,
    windowSeconds: 3600,
  });
  if (!limit.success) {
    return { error: "You've already sent several requests. Please try again later." };
  }

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id, profile_completed_at, photo_url")
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRow as
    | { id: string; profile_completed_at: string | null; photo_url: string | null }
    | null;
  if (!student) return { error: "Complete your profile first." };

  // OSA verifies the photo against the person at the counter, so an ID
  // without one cannot be validated.
  if (!student.photo_url) {
    return { error: "Add a profile photo before requesting ID validation." };
  }

  const term = getCurrentTerm();

  const { data: existingRow } = await db
    .from("id_validations")
    .select("id, status")
    .eq("student_id", student.id)
    .eq("school_year", term.schoolYear)
    .eq("semester", term.semester)
    .maybeSingle();

  const existing = existingRow as { id: string; status: IdValidationStatus } | null;

  if (existing) {
    if (existing.status === "validated") {
      return { ok: true, message: "Your ID is already validated for this term." };
    }
    if (existing.status === "pending" || existing.status === "under_review") {
      return { ok: true, message: "Your request is already with the OSA." };
    }
    if (existing.status === "suspended" || existing.status === "revoked") {
      return {
        error:
          "Your ID is on hold. Please visit the OSA in person — this cannot be reset online.",
      };
    }

    // rejected / expired: reopen the same row (one row per student per term).
    const { error } = await db
      .from("id_validations")
      .update({
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) return { error: "Could not send your request. Please try again." };
  } else {
    const { error } = await db.from("id_validations").insert({
      student_id: student.id,
      school_year: term.schoolYear,
      semester: term.semester,
      status: "pending",
    });

    if (error) return { error: "Could not send your request. Please try again." };
  }

  await logAuditEvent(user.id, "id_validation_requested", "id_validations", {
    school_year: term.schoolYear,
    semester: term.semester,
  });

  revalidatePath("/id");
  return {
    ok: true,
    message: "Request sent. The OSA will review it and validate your ID.",
  };
}
