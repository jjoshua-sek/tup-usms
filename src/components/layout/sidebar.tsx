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
  IdCard,
  FolderOpen,
  ShieldAlert,
  BarChart3,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Student navigation — grouped into "Main" and "Account" matching the mockup.
 */
const studentSections: NavSection[] = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Enrollment", href: "/enrollment", icon: BookOpen },
      { label: "Schedule", href: "/schedule", icon: Calendar },
      { label: "Grades", href: "/grades", icon: GraduationCap },
      { label: "Concerns", href: "/concerns", icon: MessageSquare },
      { label: "Violations", href: "/violations", icon: ShieldAlert },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Digital ID", href: "/id", icon: IdCard },
      { label: "Documents", href: "/documents", icon: FolderOpen },
      { label: "Messages", href: "/messages", icon: FileText },
      { label: "Profile", href: "/profile", icon: User },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/**
 * Staff navigation — grouped into "Console" and "Compliance" matching the
 * admin mockup screens.
 */
const staffSections: NavSection[] = [
  {
    label: "Console",
    items: [
      { label: "Overview", href: "/staff/dashboard", icon: LayoutDashboard },
      { label: "Concerns", href: "/staff/concerns", icon: MessageSquare },
      { label: "Violations", href: "/staff/violations", icon: AlertTriangle },
      { label: "Students", href: "/staff/students", icon: Users },
      { label: "QR Scanner", href: "/staff/scanner", icon: ScanLine },
      { label: "Files", href: "/staff/files", icon: FolderOpen },
    ],
  },
  {
    label: "Compliance",
    items: [
      { label: "Messages", href: "/staff/messages", icon: FileText },
      { label: "Calendar", href: "/staff/calendar", icon: CalendarDays },
      { label: "Reports", href: "/staff/reports", icon: BarChart3 },
      { label: "Settings", href: "/staff/settings", icon: Settings },
    ],
  },
];

interface SidebarProps {
  role: "student" | "staff" | "admin";
  /** Optional per-route badge counts for sidebar items (e.g. { "/concerns": 3 }) */
  badges?: Record<string, number>;
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ role, badges, open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const sections = role === "student" ? studentSections : staffSections;

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
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — sits below the TUP header (top-[60px]) on desktop;
          full-height slide-out drawer on mobile */}
      <aside
        className={cn(
          "fixed lg:sticky inset-y-0 lg:inset-auto left-0 z-40 lg:z-auto",
          "w-60 flex flex-col bg-white border-r border-border",
          "transition-transform duration-200 lg:translate-x-0",
          "lg:top-[60px] lg:h-[calc(100vh-60px)]",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Mobile-only close button (header is hidden on mobile sidebar) */}
        <div className="lg:hidden flex h-14 items-center justify-between px-4 border-b border-border bg-tup-maroon-600 text-white">
          <span className="text-sm font-semibold">Navigation</span>
          <button onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section, idx) => (
            <div key={section.label} className={cn(idx > 0 && "mt-5")}>
              {/* Section label — Geist Mono uppercase per mockup */}
              <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
                {section.label}
              </div>

              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard" &&
                      item.href !== "/staff/dashboard" &&
                      pathname.startsWith(item.href + "/"));
                  const badge = badges?.[item.href];

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          "group flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
                          isActive
                            ? "bg-tup-maroon-600 text-white"
                            : "text-foreground hover:bg-muted"
                        )}
                      >
                        <item.icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground"
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                        {badge !== undefined && badge > 0 && (
                          <span
                            className={cn(
                              "ml-auto font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                              isActive
                                ? "bg-white/25 text-white"
                                : "bg-tup-gold-500 text-tup-maroon-700"
                            )}
                          >
                            {badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-3 py-3">
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 px-3 py-2 rounded-md text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
