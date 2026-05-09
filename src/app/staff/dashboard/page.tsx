import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  FileWarning,
  GraduationCap,
  MessageSquare,
  ArrowRight,
  Clock,
  ScanLine,
  ChevronRight,
  Users,
  Sparkles,
  Inbox,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Staff Dashboard",
};

export const revalidate = 30;

interface ConcernRow {
  id: string;
  category: string;
  subject_line: string;
  ai_summary: string | null;
  urgency_level: string | null;
  suggested_dept: string | null;
  status: string;
  created_at: string;
  students: {
    first_name: string;
    last_name: string;
    student_number: string;
  } | null;
}

interface StaffRow {
  full_name: string;
  position: string;
  department: string;
}

const urgencyStyles: Record<string, { bar: string; badge: string; label: string }> = {
  critical: {
    bar: "bg-red-500",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    label: "Critical",
  },
  high: {
    bar: "bg-orange-500",
    badge: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    label: "High",
  },
  medium: {
    bar: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    label: "Medium",
  },
  low: {
    bar: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    label: "Low",
  },
};

function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function StaffDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch staff name
  const { data: staffRaw } = await supabase
    .from("staff")
    .select("full_name, position, department")
    .eq("user_id", user!.id)
    .maybeSingle();

  const staff = staffRaw as StaffRow | null;
  const displayName =
    staff?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "Admin";

  const today = new Date();
  const dateString = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const [
    pendingConcernsResult,
    activeViolationsResult,
    enrolledStudentsResult,
    unreadMessagesResult,
    criticalConcernsResult,
    recentConcernsResult,
    concernsByCategoryResult,
  ] = await Promise.all([
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("violations")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("status", "unread"),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .in("urgency_level", ["critical", "high"])
      .in("status", ["pending", "in_review"]),
    supabase
      .from("concerns")
      .select(
        `
        id,
        category,
        subject_line,
        ai_summary,
        urgency_level,
        suggested_dept,
        status,
        created_at,
        students (
          first_name,
          last_name,
          student_number
        )
      `
      )
      .in("status", ["pending", "in_review"])
      .order("urgency_level", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("concerns")
      .select("category")
      .in("status", ["pending", "in_review"]),
  ]);

  const pendingConcernsCount = pendingConcernsResult.count ?? 0;
  const activeViolationsCount = activeViolationsResult.count ?? 0;
  const enrolledStudentsCount = enrolledStudentsResult.count ?? 0;
  const unreadMessagesCount = unreadMessagesResult.count ?? 0;
  const criticalCount = criticalConcernsResult.count ?? 0;
  const recentConcerns = (recentConcernsResult.data as unknown as ConcernRow[]) ?? [];

  // Compute category breakdown
  type CategoryAgg = Record<string, number>;
  const categoryRows = (concernsByCategoryResult.data as { category: string }[]) ?? [];
  const categoryCounts: CategoryAgg = categoryRows.reduce<CategoryAgg>((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    return acc;
  }, {});
  const categoryEntries = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const totalCategorized = categoryEntries.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-6">
      {/* ====== HERO BANNER ====== */}
      <div className="bg-tup-gradient bg-grid-pattern relative overflow-hidden rounded-2xl p-6 sm:p-8 text-white">
        <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-tup-gold-400/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/3 h-32 w-32 rounded-full bg-tup-maroon-400/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white/70">{dateString}</p>
            <h1 className="mt-1 text-3xl sm:text-4xl font-display font-bold tracking-tight text-balance">
              {getGreeting()}, {displayName}
            </h1>
            <p className="mt-2 text-sm text-white/80">
              {staff?.position && (
                <>
                  <span className="font-medium text-tup-gold-100">
                    {staff.position}
                  </span>
                  {staff.department && <> · {staff.department}</>}
                </>
              )}
              {!staff && <span>Staff Dashboard</span>}
            </p>
          </div>

          {/* Critical alert indicator */}
          {criticalCount > 0 && (
            <Link
              href="/staff/concerns?urgency=critical"
              className="rounded-xl border border-red-300/30 bg-red-500/15 p-3 backdrop-blur-md min-w-[200px] hover:bg-red-500/25 transition-colors group"
            >
              <p className="text-[10px] uppercase font-semibold tracking-widest text-red-100">
                Needs immediate attention
              </p>
              <p className="mt-1 font-display text-2xl font-bold leading-tight">
                {criticalCount}{" "}
                <span className="text-sm font-normal opacity-80">
                  high-urgency
                </span>
              </p>
              <p className="text-xs text-white/70 group-hover:text-white transition-colors flex items-center gap-1">
                Review now <ArrowRight className="h-3 w-3" />
              </p>
            </Link>
          )}
        </div>
      </div>

      {/* ====== STAT CARDS ====== */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending Concerns"
          value={pendingConcernsCount}
          subtext="awaiting review"
          icon={AlertTriangle}
          accent="amber"
          href="/staff/concerns"
        />
        <StatCard
          label="Active Violations"
          value={activeViolationsCount}
          subtext="unresolved"
          icon={FileWarning}
          accent="red"
          href="/staff/violations"
        />
        <StatCard
          label="Enrolled Students"
          value={enrolledStudentsCount}
          subtext="total registered"
          icon={GraduationCap}
          accent="emerald"
          href="/staff/students"
        />
        <StatCard
          label="Unread Messages"
          value={unreadMessagesCount}
          subtext="require attention"
          icon={MessageSquare}
          accent="violet"
          href="/staff/messages"
        />
      </div>

      {/* ====== TWO-COLUMN MAIN ====== */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Concern Queue */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5">
                  <Inbox className="h-4 w-4 text-primary" />
                </div>
                Concern Queue
              </CardTitle>
              <CardDescription>
                AI-prioritized by urgency · {recentConcerns.length} of {pendingConcernsCount}
              </CardDescription>
            </div>
            <Link
              href="/staff/concerns"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground"
              )}
            >
              View all
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentConcerns.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-emerald-500/10 p-4">
                  <Sparkles className="h-8 w-8 text-emerald-600" />
                </div>
                <p className="mt-4 font-medium">All caught up!</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  No pending concerns at this time.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {recentConcerns.map((concern) => {
                  const studentName = concern.students
                    ? `${concern.students.first_name} ${concern.students.last_name}`
                    : "Unknown student";
                  const urgency = urgencyStyles[concern.urgency_level || ""];
                  const unprocessed = !concern.ai_summary;

                  return (
                    <li key={concern.id}>
                      <Link
                        href={`/staff/concerns/${concern.id}`}
                        className="flex items-stretch gap-4 px-6 py-4 transition-colors hover:bg-accent/30"
                      >
                        {/* Urgency bar */}
                        <div
                          className={cn(
                            "w-1 rounded-full",
                            urgency?.bar || "bg-muted"
                          )}
                        />

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-display font-semibold leading-tight text-balance">
                              {concern.subject_line}
                            </p>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {timeAgo(concern.created_at)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-medium">{studentName}</span>
                            <span className="text-muted-foreground/60">·</span>
                            <span className="font-mono text-muted-foreground">
                              {concern.students?.student_number}
                            </span>
                            <Badge variant="secondary" className="h-5 text-[10px]">
                              {concern.category}
                            </Badge>
                            {urgency && (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                  urgency.badge
                                )}
                              >
                                {urgency.label}
                              </span>
                            )}
                          </div>

                          {unprocessed ? (
                            <p className="flex items-center gap-1 text-xs italic text-muted-foreground/70">
                              <Clock className="h-3 w-3 animate-pulse" />
                              AI summary processing...
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {concern.ai_summary}
                            </p>
                          )}

                          {concern.suggested_dept && (
                            <p className="text-xs text-muted-foreground">
                              Suggested:{" "}
                              <span className="font-medium text-foreground">
                                {concern.suggested_dept}
                              </span>
                            </p>
                          )}
                        </div>

                        <ChevronRight className="h-4 w-4 text-muted-foreground/50 self-center" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right column: Category breakdown + Quick actions */}
        <div className="space-y-6">
          {/* Concerns by category */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Category</CardTitle>
              <CardDescription>
                Active concerns ({totalCategorized})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {categoryEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No active concerns to categorize.
                </p>
              ) : (
                <ul className="space-y-3">
                  {categoryEntries.map(([category, count]) => {
                    const pct = Math.round((count / totalCategorized) * 100);
                    return (
                      <li key={category}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-medium">{category}</span>
                          <span className="text-muted-foreground tabular-nums">
                            {count}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <QuickAction
                href="/staff/scanner"
                icon={ScanLine}
                label="QR Scanner"
                accent="text-blue-600"
              />
              <QuickAction
                href="/staff/violations"
                icon={FileWarning}
                label="Record Violation"
                accent="text-red-600"
              />
              <QuickAction
                href="/staff/students"
                icon={Users}
                label="Student Directory"
                accent="text-emerald-600"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Subcomponents (kept consistent with student dashboard)
// ============================================================

interface StatCardProps {
  label: string;
  value: string | number;
  subtext: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: "blue" | "emerald" | "amber" | "violet" | "red";
  href?: string;
}

const accentStyles: Record<StatCardProps["accent"], string> = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
};

function StatCard({ label, value, subtext, icon: Icon, accent, href }: StatCardProps) {
  const inner = (
    <Card
      className={cn(
        "relative overflow-hidden h-full transition-all",
        href && "cursor-pointer hover:border-primary/50 hover:shadow-md"
      )}
    >
      <CardContent className="pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 font-display text-3xl font-bold tracking-tight tabular-nums">
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{subtext}</p>
          </div>
          <div className={cn("rounded-xl p-2.5", accentStyles[accent])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

interface QuickActionProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent: string;
}

function QuickAction({ href, icon: Icon, label, accent }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
    >
      <span className="flex items-center gap-3">
        <Icon className={cn("h-4 w-4", accent)} />
        <span className="font-medium">{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
    </Link>
  );
}
