import { redirect } from "next/navigation";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { STAFF_ROLE_LABELS, type StaffRole } from "@/types/osa";
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

  // Two sources of truth meet here, and the header must not blur them:
  //   app_metadata.role  (staff | admin) — only admits the account to /staff
  //   staff.role_type                    — decides what every page and every
  //                                        RLS policy (is_osa_staff()) allows
  // An account with the first and no staff row gets in, then finds every
  // screen refusing it. The header used to label that account
  // "Administrator" anyway, which is exactly how the gap went unnoticed.
  // It now shows the permission role that is actually in force.
  const { data: staffMember } = await loose(supabase)
    .from("staff")
    .select("full_name, position, role_type")
    .eq("user_id", user.id)
    .maybeSingle();

  const staffData = staffMember as
    | { full_name: string; position: string | null; role_type: StaffRole }
    | null;
  const userName = staffData?.full_name || user.email || "Staff";
  const roleLabel = staffData ? STAFF_ROLE_LABELS[staffData.role_type] : null;
  const userSubtitle = !staffData
    ? "No staff record"
    : staffData.position && staffData.position !== roleLabel
      ? `${roleLabel} · ${staffData.position}`
      : (roleLabel ?? "Staff");

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
      // The shell's idea of "admin" comes from the staff record, the same
      // place every page's permission check reads — not from the login
      // role, which only decides entry to /staff.
      role={staffData?.role_type === "admin" ? "admin" : "staff"}
      notificationCount={unreadCount || 0}
      sidebarBadges={sidebarBadges}
    >
      {!staffData && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-950"
        >
          <p className="font-semibold">This account has no staff record.</p>
          <p className="mt-1">
            It can sign in to the staff area, but what a staff member may see and do comes from
            their staff record — and this account has none. Every OSA screen will refuse it until
            an administrator adds a staff record with a role for {user.email ?? "this account"}.
          </p>
        </div>
      )}
      {children}
    </StaffShell>
  );
}
