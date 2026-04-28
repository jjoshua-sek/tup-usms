import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  FileWarning,
  GraduationCap,
  MessageSquare,
  ArrowRight,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
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

export const metadata: Metadata = {
  title: "Staff Dashboard",
};

// Cache this page for 30 seconds — keeps the dashboard snappy without going stale
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

const urgencyStyles: Record<string, string> = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
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

export default async function StaffDashboardPage() {
  const supabase = await createClient();

  // Fetch all stats in parallel — Server Components support concurrent awaits
  const [
    pendingConcernsResult,
    activeViolationsResult,
    enrolledStudentsResult,
    unreadMessagesResult,
    recentConcernsResult,
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
      .limit(5),
  ]);

  const pendingConcernsCount = pendingConcernsResult.count ?? 0;
  const activeViolationsCount = activeViolationsResult.count ?? 0;
  const enrolledStudentsCount = enrolledStudentsResult.count ?? 0;
  const unreadMessagesCount = unreadMessagesResult.count ?? 0;
  const recentConcerns = (recentConcernsResult.data as unknown as ConcernRow[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of student affairs activity and pending tasks."
      >
        <Link
          href="/staff/concerns"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          View all concerns
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </PageHeader>

      {/* ---------- Stat Cards ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Pending Concerns"
          value={pendingConcernsCount}
          description="Awaiting staff review"
          icon={AlertTriangle}
          iconClassName="bg-amber-500/10"
        />
        <StatsCard
          title="Active Violations"
          value={activeViolationsCount}
          description="Currently unresolved"
          icon={FileWarning}
          iconClassName="bg-red-500/10"
        />
        <StatsCard
          title="Enrolled Students"
          value={enrolledStudentsCount}
          description="Total registered"
          icon={GraduationCap}
          iconClassName="bg-emerald-500/10"
        />
        <StatsCard
          title="Unread Messages"
          value={unreadMessagesCount}
          description="Require attention"
          icon={MessageSquare}
          iconClassName="bg-blue-500/10"
        />
      </div>

      {/* ---------- Concern Queue ---------- */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Concern Queue</CardTitle>
            <CardDescription>
              Recent student concerns ranked by AI-assessed urgency
            </CardDescription>
          </div>
          {recentConcerns.length > 0 && (
            <Badge variant="outline" className="font-mono text-xs">
              {recentConcerns.length} of {pendingConcernsCount}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {recentConcerns.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
              <div className="rounded-full bg-emerald-500/10 p-3">
                <AlertTriangle className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="mt-3 text-sm font-medium">All caught up!</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No pending concerns at this time.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentConcerns.map((concern) => {
                const studentName = concern.students
                  ? `${concern.students.first_name} ${concern.students.last_name}`
                  : "Unknown student";
                const urgencyClass =
                  urgencyStyles[concern.urgency_level || ""] ||
                  "bg-muted text-muted-foreground border-border";

                return (
                  <Link
                    key={concern.id}
                    href={`/staff/concerns/${concern.id}`}
                    className="block rounded-lg border p-4 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium leading-tight">
                            {concern.subject_line}
                          </p>
                          {concern.urgency_level && (
                            <span
                              className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${urgencyClass}`}
                            >
                              {concern.urgency_level}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {studentName}
                          </span>{" "}
                          ·{" "}
                          {concern.students?.student_number || "no ID"} ·{" "}
                          <Badge variant="secondary" className="text-[10px]">
                            {concern.category}
                          </Badge>
                        </p>
                        {concern.ai_summary ? (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {concern.ai_summary}
                          </p>
                        ) : (
                          <p className="flex items-center gap-1 text-xs italic text-muted-foreground/70">
                            <Clock className="h-3 w-3" />
                            AI summary processing...
                          </p>
                        )}
                        {concern.suggested_dept && (
                          <p className="text-xs">
                            <span className="text-muted-foreground">
                              Suggested dept:
                            </span>{" "}
                            <span className="font-medium">
                              {concern.suggested_dept}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 text-right">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgo(concern.created_at)}
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- Quick Actions ---------- */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">QR Scanner</CardTitle>
            <CardDescription>Verify student IDs in real time</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/staff/scanner"
              className={buttonVariants({ variant: "outline" }) + " w-full"}
            >
              Open Scanner
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Record Violation</CardTitle>
            <CardDescription>Log a new disciplinary record</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/staff/violations"
              className={buttonVariants({ variant: "outline" }) + " w-full"}
            >
              Open Violations
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Student Directory</CardTitle>
            <CardDescription>Browse all enrolled students</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/staff/students"
              className={buttonVariants({ variant: "outline" }) + " w-full"}
            >
              Open Directory
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
