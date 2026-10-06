"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { STUDENT_NUMBER } from "@/lib/accounts/enrollment";
import { planSelfReset, type InvitationForReset } from "@/lib/accounts/self-reset";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logSystemAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";

interface Result {
  ok?: boolean;
  error?: string;
}

const schema = z.object({
  login_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(STUDENT_NUMBER, "Enter your student number in the form TUPM-22-0148."),
  email: z.string().trim().email("Enter a valid email address.").max(254),
});

/**
 * "Forgot password?" — emails a one-time link to choose a new password.
 *
 * Reuses the administrator's reset machinery (migration 00022): the
 * account's invitation is re-queued with purpose "reset", the dispatcher
 * mints a fresh token when it sends, and the person chooses a new password
 * on /activate, which ends every other session of the account. The rules for
 * when a link may go out live in src/lib/accounts/self-reset.ts.
 *
 * Every request that passes validation gets the same answer, whether or not
 * anything was sent, so the form reveals nothing about which accounts exist.
 */
export async function requestPasswordReset(formData: FormData): Promise<Result> {
  const parsed = schema.safeParse({ login_id: formData.get("login_id"), email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
  const { login_id: loginId, email } = parsed.data;

  // Counted per server instance, so this only slows a burst down. What holds
  // across instances is the cooldown in planSelfReset: a link is not resent
  // within ten minutes however many times the form is submitted.
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "unknown";
  const byIp = checkRateLimit({ identifier: `reset:ip:${ip}`, maxRequests: 5, windowSeconds: 15 * 60 });
  const byAccount = checkRateLimit({ identifier: `reset:id:${loginId}`, maxRequests: 3, windowSeconds: 60 * 60 });
  if (!byIp.success || !byAccount.success) {
    return { error: "Too many requests. Wait a few minutes, then try again." };
  }

  const db = loose(createAdminClient());

  // "*" so this keeps working before migration 00022 adds link_purpose.
  const { data, error } = await db
    .from("account_invitations")
    .select("*")
    .eq("student_number", loginId)
    .maybeSingle();
  if (error) {
    console.error("[reset] invitation lookup failed", error);
    return { error: "That couldn't be processed right now. Try again in a few minutes." };
  }

  const invitation = data as (InvitationForReset & { id: string; user_id: string }) | null;
  const plan = planSelfReset({ invitation, email, now: new Date() });

  let outcome: string = plan.action === "ignore" ? plan.reason : `queued_${plan.purpose}`;

  if (plan.action === "queue" && invitation) {
    const { data: updated, error: updateError } = await db
      .from("account_invitations")
      .update({ status: "queued", link_purpose: plan.purpose, attempts: 0, next_attempt_at: null, last_error: null })
      .eq("id", invitation.id)
      // Only from the state just read: if an administrator or another
      // request moved it meanwhile, theirs stands and this changes nothing.
      .eq("status", invitation.status)
      .select("id");

    if (updateError) {
      console.error("[reset] could not queue the link", invitation.id, updateError);
      outcome = "queue_failed";
    } else if (((updated as unknown[] | null) ?? []).length === 0) {
      outcome = "changed_meanwhile";
    }
  }

  // Recorded against the account whether or not a link went out, so the OSA
  // can see repeated requests for one student. The email typed is not kept.
  if (invitation) {
    await logSystemAuditEvent(invitation.user_id, "password_reset_requested", "account_invitations", {
      outcome,
      via: "sign-in page",
    });
  }

  return { ok: true };
}
