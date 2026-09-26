import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ActivateForm } from "@/components/auth/activate-form";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Set Up Your Account",
};

const AWAITING = new Set(["queued", "sending", "sent", "failed"]);

/**
 * Where a one-time sign-in link leads (via /auth/confirm): the student is
 * signed in but has no password yet, and chooses one here.
 *
 * Only reachable while the account's invitation is open. Anyone else —
 * signed out, already activated, or an account that was never invited —
 * is sent where they belong instead of being shown a form that would
 * change a password without asking for the old one.
 */
export default async function ActivatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?notice=link-expired");

  const { data } = await loose(supabase)
    .from("account_invitations")
    .select("student_number, first_name, status")
    .eq("user_id", user.id)
    .maybeSingle();
  const invitation = data as { student_number: string; first_name: string; status: string } | null;

  if (!invitation || !AWAITING.has(invitation.status)) {
    const role = user.app_metadata?.role;
    redirect(role === "staff" || role === "admin" ? "/staff/dashboard" : "/dashboard");
  }

  return <ActivateForm firstName={invitation.first_name} studentNumber={invitation.student_number} />;
}
