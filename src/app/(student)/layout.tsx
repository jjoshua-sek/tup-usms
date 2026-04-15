import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StudentShell } from "./student-shell";

/**
 * Student Layout — Server Component that fetches the current user
 * and wraps all student pages in the AppShell with sidebar.
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

  // Fetch student profile for the sidebar
  const { data: student } = await supabase
    .from("students")
    .select("first_name, last_name, photo_url")
    .eq("user_id", user.id)
    .single();

  const studentData = student as { first_name: string; last_name: string; photo_url: string | null } | null;

  const userName = studentData
    ? `${studentData.first_name} ${studentData.last_name}`
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
      notificationCount={unreadCount || 0}
    >
      {children}
    </StudentShell>
  );
}
