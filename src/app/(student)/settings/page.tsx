import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountActivity } from "@/components/settings/account-activity";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { EmailPreferencesForm } from "@/components/settings/email-preferences-form";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_PREFERENCES, type NotificationPreferences } from "@/lib/notifications/policy";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings",
};

/** Notices sent whatever the settings say (ALWAYS_DELIVER in policy.ts), in a student's words. */
const ALWAYS_EMAILED = [
  "A case filed against you",
  "A summons, a change to its schedule, or a hearing reminder",
  "A request for an apology letter",
  "A settlement, an escalation, a sanction or a decision on your case",
  "The opening of a window to appeal",
  "A hold on your clearance",
];

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await loose(supabase)
    .from("notification_preferences")
    .select("email_enabled, scholarship_alerts, guidance_reminders, announcements")
    .eq("user_id", user.id)
    .maybeSingle();
  const preferences = (data as NotificationPreferences | null) ?? DEFAULT_PREFERENCES;

  return (
    <div>
      <PageHeader title="Settings" description="Your password, the emails you receive, and recent account activity." />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Password</CardTitle>
            <CardDescription>Enter your current password to choose a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Email notifications</CardTitle>
            <CardDescription>Choose which routine updates are also emailed to your institutional address.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <EmailPreferencesForm initial={preferences} />
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-[13px]">
              <p className="font-medium">Always emailed</p>
              <p className="mt-0.5 text-muted-foreground">
                These notices ask something of you or start a deadline, so they are sent whatever you choose:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                {ALWAYS_EMAILED.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent account activity</CardTitle>
            <CardDescription>When and from where your account was used.</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountActivity userId={user.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
