"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

const requestSchema = z.object({
  request_type: z.enum([
    "good_moral",
    "graduation_clearance",
    "transfer_clearance",
    "general_clearance",
  ]),
  purpose: z
    .string()
    .trim()
    .min(5, { message: "Tell the OSA what the certificate is for." })
    .max(300),
});

/**
 * Student requests a clearance / Certificate of Good Moral Character.
 *
 * The student only files the request. The automated check against open cases
 * and unresolved sanctions runs on the OSA side (`check_student_clearance()`
 * from migration 00010) — a student-triggered check would let anyone probe
 * their own record for blockers and try to time a request around them.
 */
export async function requestClearance(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You are signed out." };

  const limit = checkRateLimit({
    identifier: `clearance-request:${user.id}`,
    maxRequests: 5,
    windowSeconds: 3600,
  });
  if (!limit.success) {
    return { error: "You've filed several requests already. Please wait before filing again." };
  }

  const parsed = requestSchema.safeParse({
    request_type: formData.get("request_type"),
    purpose: formData.get("purpose") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) return { error: "Complete your profile first." };

  // One live request per type is enough; duplicates just split the queue.
  const { data: openRow } = await db
    .from("clearance_requests")
    .select("id")
    .eq("student_id", student.id)
    .eq("request_type", parsed.data.request_type)
    .in("status", ["submitted", "verifying", "on_hold", "cleared", "fee_pending", "ready"])
    .maybeSingle();

  if (openRow) {
    return { ok: true, message: "You already have a request of this type in progress." };
  }

  const { error } = await db.from("clearance_requests").insert({
    student_id: student.id,
    request_type: parsed.data.request_type,
    purpose: sanitizeText(parsed.data.purpose),
    status: "submitted",
  });

  if (error) return { error: "Could not file your request. Please try again." };

  await logAuditEvent(user.id, "clearance_requested", "clearance_requests", {
    request_type: parsed.data.request_type,
  });

  revalidatePath("/clearance");
  return { ok: true, message: "Request filed. The OSA will verify your record." };
}
