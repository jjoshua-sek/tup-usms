"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { newPasswordSchema } from "@/lib/validations/auth";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

// Every export here acts on the signed-in user's own account and nothing
// else — the session decides whose, never a value from the form.

function revalidateSettings() {
  revalidatePath("/settings");
  revalidatePath("/staff/settings");
}

// ============================================================
// PASSWORD
// ============================================================

/**
 * Changes the signed-in user's password, after proving they know the
 * current one.
 *
 * Supabase's updateUser() does not ask for the old password, so a session
 * left open on a shared computer would be enough to take the account over.
 * The current password is therefore checked first, by signing in with it on
 * a throwaway client that keeps nothing; that check's own session is revoked
 * straight away. Saving the new password then ends every other session of
 * the account, as a reset link does.
 */
export async function changePassword(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "You're signed out. Sign in again to change your password." };

  const current = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current) return { error: "Enter your current password." };
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Choose a stronger password." };
  if (password !== confirm) return { error: "The two new passwords don't match." };
  if (password === current) return { error: "Choose a password different from your current one." };

  // Guessing the current password through this form is still guessing a
  // password; slow it down the way the sign-in form does.
  const attempts = checkRateLimit({ identifier: `password-change:${user.id}`, maxRequests: 5, windowSeconds: 15 * 60 });
  if (!attempts.success) return { error: "Too many attempts. Wait a few minutes, then try again." };

  const verifier = createStatelessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error: verifyError } = await verifier.auth.signInWithPassword({ email: user.email, password: current });
  if (verifyError) {
    return {
      error:
        verifyError.status === 429
          ? "Too many attempts. Wait a few minutes, then try again."
          : "Your current password is incorrect.",
    };
  }
  // The check signed in a second time; end that session so it can't be used.
  await verifier.auth.signOut({ scope: "local" });

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.error("[settings] password change failed", updateError);
    return {
      error: /same|different/i.test(updateError.message)
        ? "Choose a password you haven't used before."
        : "Your password could not be changed. Try again in a moment.",
    };
  }

  const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
  if (othersError) console.error("[settings] could not end other sessions", othersError);

  await logAuditEvent(user.id, "password_change", "auth.users", { ended_other_sessions: !othersError });
  revalidateSettings();

  return { ok: true, message: "Password changed. You've been signed out on every other device." };
}

// ============================================================
// EMAIL PREFERENCES
// ============================================================

const preferencesSchema = z.object({
  email_enabled: z.boolean(),
  scholarship_alerts: z.boolean(),
  guidance_reminders: z.boolean(),
  announcements: z.boolean(),
});

/**
 * Saves which optional emails the user wants. Notices that create an
 * obligation or start a deadline are sent whatever is chosen here — that
 * rule lives in src/lib/notifications/policy.ts, not in this form.
 *
 * A checkbox left out of the form is read as "off", so a form showing only
 * some toggles (the staff page shows one) must pass the rest as hidden
 * fields to keep them.
 */
export async function saveEmailPreferences(formData: FormData): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You're signed out. Sign in again to change your settings." };

  const on = (name: string) => formData.get(name) === "on";
  const parsed = preferencesSchema.safeParse({
    email_enabled: on("email_enabled"),
    scholarship_alerts: on("scholarship_alerts"),
    guidance_reminders: on("guidance_reminders"),
    announcements: on("announcements"),
  });
  if (!parsed.success) return { error: "Those settings couldn't be read. Reload the page and try again." };

  const { error } = await loose(supabase)
    .from("notification_preferences")
    .upsert({ user_id: user.id, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) {
    console.error("[settings] preferences not saved", error);
    return { error: "Your email settings could not be saved. Try again in a moment." };
  }

  revalidateSettings();
  return { ok: true, message: "Email settings saved." };
}

// ============================================================
// SIGN-IN HISTORY
// ============================================================

/**
 * Records a successful sign-in, so the account's owner can see when and
 * from where their account was used (Settings → Recent sign-ins).
 *
 * Called by the sign-in form once Supabase has accepted the password. The
 * session the browser now holds decides whose sign-in it was; a request
 * with no session records nothing.
 */
export async function recordSignIn(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await logAuditEvent(user.id, "login", "auth.session", { method: "password" });
}
