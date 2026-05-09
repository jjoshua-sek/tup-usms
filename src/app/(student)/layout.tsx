import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StudentShell } from "./student-shell";
import { isProfileComplete } from "@/lib/utils/profile-completeness";

/**
 * Student Layout — fetches user + student profile, enforces the
 * "profile must be complete" gate, and wraps pages in the AppShell.
 *
 * Profile gate: if a student tries to access ANY student page other than
 * /profile while their profile is incomplete, they're redirected to /profile.
 * /profile itself is allowed (that's where the wizard lives).
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Read the request pathname from header (set by middleware)
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";

  // Fetch student profile for the sidebar + completion check
  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "first_name, last_name, photo_url, photo_is_provisional, profile_completed_at, dpa_consent, address_barangay, address_city, address_province, address_zip, gender, birth_date, email_address, campus, department, program, year_level"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const studentData = studentRaw as
    | {
        first_name: string;
        last_name: string;
        photo_url: string | null;
        photo_is_provisional: boolean;
        profile_completed_at: string | null;
        dpa_consent: boolean;
        address_barangay: string | null;
        address_city: string | null;
        address_province: string | null;
        address_zip: string | null;
        gender: string | null;
        birth_date: string | null;
        email_address: string | null;
        campus: string | null;
        department: string | null;
        program: string | null;
        year_level: string | null;
      }
    | null;

  const profileIsComplete = isProfileComplete(studentData);

  // Gate: redirect to /profile if profile is incomplete and they're not already there
  if (!profileIsComplete && !pathname.startsWith("/profile")) {
    redirect("/profile");
  }

  const userName = studentData
    ? `${studentData.first_name} ${studentData.last_name}`.trim() || user.email || "Student"
    : user.email || "Student";

  // Get unread message count for notification badge
  const { count: unreadCount } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .eq("status", "unread");

  return (
    <StudentShell
      userName={userName}
      userAvatar={studentData?.photo_url || undefined}
      photoIsProvisional={studentData?.photo_is_provisional ?? false}
      notificationCount={unreadCount || 0}
    >
      {children}
    </StudentShell>
  );
}
