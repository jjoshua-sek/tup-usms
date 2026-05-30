import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StaffShell } from "./staff-shell";

/**
 * Staff Layout — Server Component that fetches staff user data
 * and wraps all staff pages in the AppShell with staff navigation.
 */
export default async function StaffLayout({
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

  // Verify this is actually a staff/admin user.
  // Read role from app_metadata only — user_metadata is user-modifiable and unsafe.
  const role = user.app_metadata?.role;
  if (role !== "staff" && role !== "admin") {
    redirect("/dashboard");
  }

  // Fetch staff profile (role text appears in the header as "OSA Officer" etc.)
  const { data: staffMember } = await supabase
    .from("staff")
    .select("full_name, position, department")
    .eq("user_id", user.id)
    .maybeSingle();

  const staffData = staffMember as
    | { full_name: string; position: string | null; department: string | null }
    | null;
  const userName = staffData?.full_name || user.email || "Staff";
  const userSubtitle =
    staffData?.position ||
    (role === "admin" ? "Administrator" : "OSA Officer");

  // Sidebar badges + notification count
  const [{ count: unreadCount }, { count: pendingConcernsCount }] = await Promise.all([
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("status", "unread"),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "in_review"]),
  ]);

  const sidebarBadges: Record<string, number> = {};
  if (pendingConcernsCount && pendingConcernsCount > 0) {
    sidebarBadges["/staff/concerns"] = pendingConcernsCount;
  }

  return (
    <StaffShell
      userName={userName}
      userSubtitle={userSubtitle}
      role={role as "staff" | "admin"}
      notificationCount={unreadCount || 0}
      sidebarBadges={sidebarBadges}
    >
      {children}
    </StaffShell>
  );
}
