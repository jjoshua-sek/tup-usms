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

  // Fetch staff profile
  const { data: staffMember } = await supabase
    .from("staff")
    .select("full_name")
    .eq("user_id", user.id)
    .single();

  const staffData = staffMember as { full_name: string } | null;
  const userName = staffData?.full_name || user.email || "Staff";

  // Get unread message count
  const { count: unreadCount } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .eq("status", "unread");

  return (
    <StaffShell
      userName={userName}
      role={role as "staff" | "admin"}
      notificationCount={unreadCount || 0}
    >
      {children}
    </StaffShell>
  );
}
