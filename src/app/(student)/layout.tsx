import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StudentShell } from "./student-shell";
import { isProfileComplete } from "@/lib/utils/profile-completeness";

/**
 * Student Layout — fetches user + student profile, enforces the
 * "profile must be complete" gate, and wraps pages in the AppShell.
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

  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";

  // Fetch student profile for the header subtitle + completion check
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

  // Gate: redirect to /profile if incomplete and not already there
  if (!profileIsComplete && !pathname.startsWith("/profile")) {
    redirect("/profile");
  }

  const userName = studentData
    ? `${studentData.first_name} ${studentData.last_name}`.trim() || user.email || "Student"
    : user.email || "Student";

  // Header subtitle: "BSIT · 4th Year" style
  const userSubtitle =
    studentData?.program && studentData?.year_level
      ? `${studentData.program} · ${studentData.year_level}`
      : undefined;

  // Sidebar badges — counts of pending concerns + unread messages
  const studentId = await (async () => {
    const { data } = await supabase
      .from("students")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    return (data as { id: string } | null)?.id;
  })();

  const [{ count: unreadCount }, { count: pendingConcernsCount }] = await Promise.all([
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("status", "unread"),
    studentId
      ? supabase
          .from("concerns")
          .select("*", { count: "exact", head: true })
          .eq("student_id", studentId)
          .in("status", ["pending", "in_review"])
      : Promise.resolve({ count: 0 } as { count: number | null }),
  ]);

  const sidebarBadges: Record<string, number> = {};
  if (pendingConcernsCount && pendingConcernsCount > 0) {
    sidebarBadges["/concerns"] = pendingConcernsCount;
  }
  if (unreadCount && unreadCount > 0) {
    sidebarBadges["/messages"] = unreadCount;
  }

  return (
    <StudentShell
      userName={userName}
      userSubtitle={userSubtitle}
      userAvatar={studentData?.photo_url || undefined}
      photoIsProvisional={studentData?.photo_is_provisional ?? false}
      notificationCount={unreadCount || 0}
      sidebarBadges={sidebarBadges}
    >
      {children}
    </StudentShell>
  );
}
