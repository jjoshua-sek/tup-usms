import type { Metadata } from "next";
import Link from "next/link";
import {
  MessageSquare,
  AlertTriangle,
  Zap,
  Users,
  Plus,
  Download,
  ArrowRight,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Overview",
};

export const revalidate = 30;

interface ConcernRow {
  id: string;
  category: string;
  subject_line: string;
  ai_summary: string | null;
  urgency_level: string | null;
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
  position: string | null;
}

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: staffRaw } = user
    ? await supabase
        .from("staff")
        .select("full_name, position")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const staff = staffRaw as StaffRow | null;

  const dateString = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Compute today's window for "Concerns Today"
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Compute yesterday's window for the comparison
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const [
    concernsTodayResult,
    concernsYesterdayResult,
    highUrgencyResult,
    enrolledStudentsResult,
    activeViolationsResult,
    recentConcernsResult,
  ] = await Promise.all([
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString()),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .in("urgency_level", ["high", "critical"])
      .in("status", ["pending", "in_review"]),
    supabase
      .from("students")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("violations")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("concerns")
      .select(
        `
        id,
        category,
        subject_line,
        ai_summary,
        urgency_level,
        status,
        created_at,
        students (
          first_name,
          last_name,
          student_number
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const concernsToday = concernsTodayResult.count ?? 0;
  const concernsYesterday = concernsYesterdayResult.count ?? 0;
  const concernsDelta = concernsToday - concernsYesterday;
  const highUrgency = highUrgencyResult.count ?? 0;
  const enrolledStudents = enrolledStudentsResult.count ?? 0;
  const activeViolations = activeViolationsResult.count ?? 0;
  const recentConcerns = (recentConcernsResult.data as unknown as ConcernRow[]) ?? [];

  const totalActive = highUrgency + (concernsTodayResult.count ?? 0);
  const greeting = staff?.full_name?.split(" ")[0] || "Officer";

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Console", href: "/staff/dashboard" },
          { label: "Overview" },
        ]}
        title="OSA Operations"
        description={`${dateString} · ${totalActive} active items requiring attention`}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Export Report
        </button>
        <Link
          href="/staff/concerns"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Action
        </Link>
      </PageHeader>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
        <StatsCard
          label="Concerns Today"
          value={concernsToday}
          trend={
            concernsDelta === 0
              ? "Same as yesterday"
              : concernsDelta > 0
                ? `↑ ${concernsDelta} from yesterday`
                : `↓ ${Math.abs(concernsDelta)} from yesterday`
          }
          trendTone={concernsDelta > 0 ? "warn" : "up"}
          icon={MessageSquare}
          iconTone="warn"
        />
        <StatsCard
          label="High Urgency"
          value={highUrgency}
          valueClassName={highUrgency > 0 ? "text-destructive" : ""}
          trend={highUrgency > 0 ? "Routed to staff" : "All clear"}
          trendTone={highUrgency > 0 ? "danger" : "up"}
          icon={AlertTriangle}
          iconTone={highUrgency > 0 ? "danger" : "success"}
        />
        <StatsCard
          label="Avg. AI Triage"
          value="1.4s"
          trend="Claude Sonnet 4"
          icon={Zap}
          iconTone="ai"
        />
        <StatsCard
          label="Enrolled Students"
          value={enrolledStudents}
          trend={`${activeViolations} active violations`}
          icon={Users}
          iconTone="neutral"
        />
      </div>

      {/* Activity feed */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card border border-border rounded-md p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-border">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">
                Recent Activity
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Latest concerns received across all categories
              </p>
            </div>
            <Link
              href="/staff/concerns"
              className="text-xs font-medium text-tup-maroon-600 hover:underline inline-flex items-center gap-1"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recentConcerns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No recent activity. New concerns will appear here.
            </p>
          ) : (
            <ul className="space-y-0">
              {recentConcerns.map((concern) => (
                <ActivityRow key={concern.id} concern={concern} />
              ))}
            </ul>
          )}
        </div>

        {/* AI badge / context card */}
        <div className="bg-card border border-border rounded-md p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-md bg-ai-accent-soft text-ai-accent flex items-center justify-center">
              <Zap className="h-3.5 w-3.5" />
            </div>
            <h3 className="text-[15px] font-semibold tracking-tight">
              AI Triage Status
            </h3>
          </div>

          <div className="space-y-3 text-[13px]">
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono text-[11px]">Claude Sonnet 4</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Avg. latency</span>
              <span className="font-medium tabular-nums">1.4s</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Processed today</span>
              <span className="font-medium tabular-nums">{concernsToday}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground">Status</span>
              <span className="inline-flex items-center gap-1 text-[#16a34a] text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                Operational
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-border bg-ai-accent-soft -mx-5 -mb-5 px-5 pb-5 rounded-b-md">
            <p className="text-[11px] text-ai-accent leading-relaxed">
              AI generates routing summaries to assist triage. Final review and
              decisions remain with human staff.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Activity feed row — matches mockup style
// ============================================================
function ActivityRow({ concern }: { concern: ConcernRow }) {
  const isHigh = concern.urgency_level === "high" || concern.urgency_level === "critical";
  const isResolved = concern.status === "resolved" || concern.status === "closed";

  const studentName = concern.students
    ? `${concern.students.first_name} ${concern.students.last_name}`
    : "Unknown student";

  return (
    <li className="grid grid-cols-[auto_1fr_auto] gap-3 items-center py-2.5 border-b border-border last:border-0">
      <div
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          isHigh && "bg-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.1)]",
          !isHigh && isResolved && "bg-[#16a34a]",
          !isHigh && !isResolved && "bg-muted-foreground"
        )}
      />
      <div className="min-w-0">
        <Link
          href={`/staff/concerns/${concern.id}`}
          className="text-[13px] font-medium leading-tight hover:underline truncate block"
        >
          {concern.subject_line}
        </Link>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {studentName} ·{" "}
          <span className="font-mono">{concern.students?.student_number}</span>{" "}
          · {concern.category}
        </p>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono shrink-0">
        {timeAgo(concern.created_at)}
      </div>
    </li>
  );
}
