"use client";

import Link from "next/link";
import { Bell, HelpCircle, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface TupHeaderProps {
  onMenuClick: () => void;
  /** Display name for the user block on the right */
  userName?: string;
  /** Short role descriptor below the name (e.g. "BSIT · 4th Year" or "OSA Officer") */
  userSubtitle?: string;
  /** Mark provisional photo via amber dot in the corner of the avatar */
  photoIsProvisional?: boolean;
  /** Whether this is the admin/staff console (changes branding line) */
  isStaffConsole?: boolean;
  notificationCount?: number;
  role: "student" | "staff" | "admin";
}

/**
 * Full-width TUP institutional header.
 *
 * Visual language (matches the mockup precisely):
 * - Background: TUP maroon (#7A1F2B)
 * - Bottom border: 3px solid TUP gold (#d4a017) — the signature institutional touch
 * - Left: 36px gold seal with "TUP" + brand text (university name + system name)
 * - Right: Help link, notification bell with count, user block (avatar + name + role)
 *
 * This component sits ABOVE the sidebar+main grid, full-width, sticky to the top.
 */
export function TupHeader({
  onMenuClick,
  userName = "User",
  userSubtitle,
  photoIsProvisional,
  isStaffConsole,
  notificationCount = 0,
  role,
}: TupHeaderProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between bg-tup-maroon-600 px-4 sm:px-6 py-2.5 text-white border-b-[3px] border-tup-gold-500"
      style={{ minHeight: 60 }}
    >
      {/* LEFT: mobile menu + brand */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="lg:hidden p-1 -ml-1 text-white/90 hover:text-white"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link href={role === "student" ? "/dashboard" : "/staff/dashboard"} className="flex items-center gap-3">
          {/* Gold TUP seal */}
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full bg-tup-gold-500 text-tup-maroon-600 font-bold text-[13px] tracking-tight border-2 border-white shrink-0"
            aria-label="TUP seal"
          >
            TUP
          </div>

          {/* Brand text */}
          <div className="hidden sm:block leading-tight">
            <div className="text-[11px] tracking-wide opacity-85">
              TUP — Manila{isStaffConsole && " · OSA Console"}
            </div>
            <div className="text-base font-semibold tracking-tight">
              {isStaffConsole ? "USMS Admin" : "USMS"}
            </div>
          </div>
        </Link>
      </div>

      {/* RIGHT: Help, notifications, user */}
      <div className="flex items-center gap-3 sm:gap-5">
        <Link
          href="/help"
          className="hidden sm:inline text-xs text-white/85 hover:text-white transition-colors"
        >
          <HelpCircle className="h-4 w-4 inline mr-1 -mt-0.5" />
          Help
        </Link>

        <Link
          href={role === "student" ? "/messages" : "/staff/messages"}
          className="relative text-white/85 hover:text-white transition-colors"
          aria-label={`Notifications (${notificationCount})`}
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span
              className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-tup-gold-500 text-tup-maroon-600 text-[10px] font-bold flex items-center justify-center font-mono"
              aria-hidden="true"
            >
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </Link>

        {/* User block with separator on its left */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2.5 pl-3 sm:pl-5 sm:border-l border-white/20 rounded-sm transition-colors">
            <div className="relative">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 border border-white/30 text-xs font-medium text-white">
                {initials}
              </div>
              {photoIsProvisional && (
                <span
                  aria-label="Provisional photo"
                  className="absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full bg-tup-gold-500 border border-tup-maroon-600"
                />
              )}
            </div>
            <div className="hidden md:block text-left leading-tight">
              <div className="text-xs font-medium text-white truncate max-w-[140px]">
                {userName}
              </div>
              {userSubtitle && (
                <div className="text-[11px] text-white/70 truncate max-w-[140px]">
                  {userSubtitle}
                </div>
              )}
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem>
              <Link
                href={role === "student" ? "/profile" : "/staff/settings"}
                className="w-full"
              >
                {role === "student" ? "My Profile" : "Account"}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link
                href={role === "student" ? "/settings" : "/staff/settings"}
                className="w-full"
              >
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} variant="destructive">
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
