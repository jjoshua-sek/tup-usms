"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { newPasswordSchema } from "@/lib/validations/auth";

interface Result {
  error?: string;
}

/** Invitation states from which a first password may still be set. */
const AWAITING = new Set(["queued", "sending", "sent", "failed"]);

/**
 * Sets the password on an account that arrived by one-time link.
 *
 * Deliberately narrow: this changes a password without asking for the old
 * one, which is only safe for an account that has never had one. So it
 * works only while the account's invitation is still awaiting activation,
 * and the first successful use closes it. A stolen session cannot come back
 * here later to take over an account.
 */
export async function activateAccount(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your sign-in link has expired. Ask the OSA to send a new one." };

  // "*" so this keeps working before migration 00022 adds link_purpose.
  const { data } = await loose(supabase)
    .from("account_invitations")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const invitation = data as { id: string; status: string; link_purpose?: "setup" | "reset" } | null;

  if (!invitation || !AWAITING.has(invitation.status)) {
    return { error: "This account is already set up. Sign in with your student number and password." };
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
  if (password !== confirm) return { error: "The two passwords don't match." };

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.error("[activate] updateUser failed", updateError);
    return {
      error: /same|different/i.test(updateError.message)
        ? "Choose a password you haven't used before."
        : "Your password could not be saved. Try again, or ask the OSA to send a new link.",
    };
  }

  // Students cannot write their own invitation row (RLS), and should not be
  // able to: closing it is what stops this page from being reused.
  const { error: closeError } = await loose(createAdminClient())
    .from("account_invitations")
    .update({ status: "activated", activated_at: new Date().toISOString() })
    .eq("id", invitation.id);
  if (closeError) console.error("[activate] could not close invitation", invitation.id, closeError);

  // A new password should end every other sign-in of this account. For a
  // reset that is the point — whoever was using the old password is out —
  // and for first-time setup there are no other sessions to end.
  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) console.error("[activate] could not end other sessions", othersError);

  const reset = invitation.link_purpose === "reset";
  await logAuditEvent(user.id, "account_activated", "account_invitations", {
    invitation_id: invitation.id,
    purpose: reset ? "reset" : "setup",
  });

  // First sign-in continues into the profile, prefilled from the enrollment
  // list. After a reset the profile already exists; the dashboard's own
  // gate still sends anyone with an unfinished profile to finish it. Staff
  // arrive here only by reset, and go to their own console.
  const role = user.app_metadata?.role;
  if (role === "staff" || role === "admin") redirect("/staff/dashboard");
  redirect(reset ? "/dashboard" : "/profile");
}
