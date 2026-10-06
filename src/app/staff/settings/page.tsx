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
import { STAFF_ROLE_LABELS, type StaffRole } from "@/types/osa";

export const metadata: Metadata = {
  title: "Settings",
};

interface StaffRecord {
  full_name: string;
  department: string | null;
  position: string | null;
  office: string | null;
  role_type: StaffRole;
  institutional_email: string | null;
}

export default async function StaffSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = loose(supabase);
  const [{ data: staffRow }, { data: preferenceRow }] = await Promise.all([
    db
      .from("staff")
      .select("full_name, department, position, office, role_type, institutional_email")
      .eq("user_id", user.id)
      .maybeSingle(),
    db
      .from("notification_preferences")
      .select("email_enabled, scholarship_alerts, guidance_reminders, announcements")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const staff = staffRow as StaffRecord | null;
  const preferences = (preferenceRow as NotificationPreferences | null) ?? DEFAULT_PREFERENCES;
  const loginId = user.email?.split("@")[0]?.toUpperCase() ?? "—";

  const details: Array<[string, string]> = [
    ["Name", staff?.full_name ?? "—"],
    ["Login ID", loginId],
    ["Role", staff ? STAFF_ROLE_LABELS[staff.role_type] : "No staff record"],
    ["Position", staff?.position ?? "—"],
    ["Department", staff?.department ?? "—"],
    ["Office", staff?.office ?? "—"],
    ["Institutional email", staff?.institutional_email ?? "—"],
  ];

  return (
    <div>
      <PageHeader title="Settings" description="Your account details, password, email and recent account activity." />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your account</CardTitle>
            <CardDescription>
              Your role decides what the console shows you. To change any of these, ask the administrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[12px] text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

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
            <CardDescription>
              Your notifications always appear under the bell. Choose whether copies are also emailed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailPreferencesForm initial={preferences} categories={false} />
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
