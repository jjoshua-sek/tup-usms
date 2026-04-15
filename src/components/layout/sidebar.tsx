"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  User,
  BookOpen,
  Calendar,
  GraduationCap,
  MessageSquare,
  FileText,
  AlertTriangle,
  ClipboardCheck,
  Award,
  Settings,
  LogOut,
  ScanLine,
  Users,
  CalendarDays,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const studentNavItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Enrollment", href: "/enrollment", icon: BookOpen },
  { label: "Schedule", href: "/schedule", icon: Calendar },
  { label: "Grades", href: "/grades", icon: GraduationCap },
  { label: "Concerns", href: "/concerns", icon: MessageSquare },
  { label: "Messages", href: "/messages", icon: FileText },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "Violations", href: "/violations", icon: AlertTriangle },
  { label: "Evaluation", href: "/evaluation", icon: ClipboardCheck },
  { label: "Graduation", href: "/graduation", icon: Award },
];

const staffNavItems: NavItem[] = [
  { label: "Dashboard", href: "/staff/dashboard", icon: LayoutDashboard },
  { label: "Concerns", href: "/staff/concerns", icon: MessageSquare },
  { label: "Violations", href: "/staff/violations", icon: AlertTriangle },
  { label: "QR Scanner", href: "/staff/scanner", icon: ScanLine },
  { label: "Students", href: "/staff/students", icon: Users },
  { label: "Messages", href: "/staff/messages", icon: FileText },
  { label: "Calendar", href: "/staff/calendar", icon: CalendarDays },
];

interface SidebarProps {
  role: "student" | "staff" | "admin";
  userName?: string;
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ role, userName, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = role === "student" ? studentNavItems : staffNavItems;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-tup-maroon-900 text-white font-bold text-sm">
              TUP
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">
                TUP-Manila
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                {role === "student" ? "Student Portal" : "Staff Portal"}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-sidebar-foreground"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" &&
                  item.href !== "/staff/dashboard" &&
                  pathname.startsWith(item.href));

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <Separator className="bg-sidebar-border" />

        {/* Footer */}
        <div className="p-3 space-y-1">
          <Link
            href={role === "student" ? "/settings" : "/staff/settings"}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          >
            <Settings className="h-5 w-5" />
            <span>Settings</span>
          </Link>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-destructive/20 hover:text-destructive transition-colors"
          >
            <LogOut className="h-5 w-5" />
            <span>Sign Out</span>
          </button>
          {userName && (
            <div className="px-3 py-2 text-xs text-sidebar-foreground/50">
              Signed in as {userName}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
