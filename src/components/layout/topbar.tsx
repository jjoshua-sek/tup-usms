"use client";

import { Menu, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AvatarWithDot } from "@/components/profile/avatar-with-dot";

interface TopbarProps {
  onMenuClick: () => void;
  userName?: string;
  userAvatar?: string;
  photoIsProvisional?: boolean;
  role: "student" | "staff" | "admin";
  notificationCount?: number;
}

export function Topbar({
  onMenuClick,
  userName = "User",
  userAvatar,
  photoIsProvisional,
  role,
  notificationCount = 0,
}: TopbarProps) {
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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-6">
      {/* Left: Mobile menu button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground hidden sm:block">
          TUP-Manila USMS
        </h1>
      </div>

      {/* Right: Notifications + Profile */}
      <div className="flex items-center gap-2">
        {/* Notification Bell */}
        <Link
          href={role === "student" ? "/messages" : "/staff/messages"}
          className="relative inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </Badge>
          )}
        </Link>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 px-2 rounded-md hover:bg-accent transition-colors"
          >
            <AvatarWithDot
              src={userAvatar}
              fallback={initials}
              isProvisional={photoIsProvisional}
              className="h-8 w-8"
              fallbackClassName="bg-primary text-primary-foreground text-xs"
            />
            <span className="text-sm font-medium hidden md:inline-block">
              {userName}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem>
              <Link href={role === "student" ? "/profile" : "/staff/settings"} className="w-full">
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link href={role === "student" ? "/settings" : "/staff/settings"} className="w-full">
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              variant="destructive"
            >
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
