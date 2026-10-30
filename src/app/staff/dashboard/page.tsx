import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  CaretDownIcon,
  ChartBarIcon,
  ChatTextIcon,
  CheckCircleIcon,
  LightningIcon,
  NotePencilIcon,
  PlusIcon,
  UsersIcon,
  WarningIcon,
} from "@phosphor-icons/react/ssr";

import { buttonVariants } from "@/components/ui/button";
import { StatsCard } from "@/components/shared/stats-card";
import { modelLabel } from "@/lib/ai/concern-summary";
import { aiConfigured, aiModels } from "@/lib/ai/groq-core";
import { getStaffContext } from "@/lib/osa/staff-context";
import { staffNavFor } from "@/lib/osa/staff-nav";
import { greetingFor, todayTasks, WAITING, type TodayCounts } from "@/lib/osa/today";
import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { scoreStudent } from "@/lib/risk/score";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManilaLongDate, manilaWallClock, startOfManilaDay } from "@/lib/utils/time";
import { concernCategoryLabel } from "@/lib/validations/concern";

export const metadata: Metadata = {
  title: "Home",
};

export const revalidate = 30;

interface ConcernRow {
  id: string;
  category: string;
  subject_line: string;
  urgency_level: string | null;
  status: string;
  created_at: string;
  students: { first_name: string; last_name: string; student_number: string } | null;
}

function timeAgo(dateString: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const count = (result: { count: number | null }) => result.count ?? 0;

// Every button here must look pressable to someone who does not use
// computers much: a visible maroon border, not a faint grey one.
const SECONDARY_BUTTON = cn(
  buttonVariants({ variant: "outline" }),
  "border-tup-maroon-300 text-tup-maroon-700 hover:bg-tup-maroon-50 hover:text-tup-maroon-800",
);
const URGENT_BUTTON = cn(buttonVariants(), "bg-destructive text-white hover:bg-destructive/90");

/**
 * Staff home: "Today". It answers one question first, what is waiting for
 * me, as plain sentences with one button each, built for staff who do not
 * want to hunt through menus. The numbers and system status the old
 * overview led with are still here, folded below.
 */
export default async function StaffHomePage() {
  const staff = await getStaffContext();
  // A UITC account works only on Accounts (I1); the OSA home is not theirs.
  if (staff?.role === "registrar") redirect("/staff/accounts");

  const menu = new Set(staffNavFor(staff?.role ?? null).flatMap((s) => s.items.map((i) => i.href)));
  const sees = (href: string) => menu.has(href);

  const supabase = await createClient();
  const db = loose(supabase);
  const now = new Date();
  const todayStart = startOfManilaDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const none = Promise.resolve({ count: 0 });

  // Only the queues this person can open are counted.
  const [
    urgentConcerns, newConcerns, hearingsToday, datesToApprove, casesToSchedule, lettersToRead,
    documentsToCheck, idValidations, clearanceRequests, gateAlerts, openFollowUps,
    concernsToday, concernsYesterday, enrolledStudents, openCases, recentResult, awaitingSummaryResult,
  ] = await Promise.all([
    db.from("concerns").select("id", { count: "exact", head: true })
      .in("urgency_level", ["high", "critical"]).in("status", ["pending", "in_review"]),
    db.from("concerns").select("id", { count: "exact", head: true })
      .eq("status", "pending").or("urgency_level.is.null,urgency_level.not.in.(high,critical)"),
    sees("/staff/hearings")
      ? db.from("case_hearings").select("id", { count: "exact", head: true })
          .in("status", [...WAITING.hearingsGoingAhead])
          .gte("scheduled_start", todayStart.toISOString()).lt("scheduled_start", tomorrowStart.toISOString())
      : none,
    staff?.role === "faculty"
      ? db.from("case_hearings").select("id, violation_cases!inner(complainant_staff_id)", { count: "exact", head: true })
          .eq("status", "awaiting_complainant").eq("violation_cases.complainant_staff_id", staff.staffId)
      : none,
    sees("/staff/cases")
      ? db.from("violation_cases").select("id", { count: "exact", head: true }).in("status", [...WAITING.casesToSchedule])
      : none,
    sees("/staff/cases")
      ? db.from("apology_letters").select("id", { count: "exact", head: true }).eq("review_status", "pending")
      : none,
    sees("/staff/documents")
      ? db.from("academic_documents").select("id", { count: "exact", head: true }).in("processing_status", [...WAITING.documentsToCheck])
      : none,
    sees("/staff/id-validation")
      ? db.from("id_validations").select("id", { count: "exact", head: true }).in("status", [...WAITING.idValidations])
      : none,
    sees("/staff/clearance")
      ? db.from("clearance_requests").select("id", { count: "exact", head: true }).in("status", [...WAITING.clearanceRequests])
      : none,
    sees("/staff/gates")
      ? db.from("access_anomalies").select("id", { count: "exact", head: true }).eq("status", "open")
      : none,
    sees("/staff/interventions")
      ? db.from("risk_interventions").select("id", { count: "exact", head: true }).in("status", [...WAITING.openFollowUps])
      : none,
    db.from("concerns").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
    db.from("concerns").select("id", { count: "exact", head: true })
      .gte("created_at", yesterdayStart.toISOString()).lt("created_at", todayStart.toISOString()),
    db.from("students").select("id", { count: "exact", head: true }),
    db.from("violation_cases").select("id", { count: "exact", head: true }).not("status", "in", "(closed,dismissed)"),
    db.from("concerns")
      .select("id, category, subject_line, urgency_level, status, created_at, students(first_name, last_name, student_number)")
      .order("created_at", { ascending: false })
      .limit(5),
    // Concerns still waiting for their AI summary; the newest error, if any,
    // says why (a "Waiting:" error means the queue is on hold).
    db.from("concerns").select("ai_summary_error", { count: "exact" })
      .eq("ai_summary_status", "pending").order("created_at", { ascending: false }).limit(1),
  ]);

  // At-risk scores are worked out when read, as on the At-Risk page.
  let criticalStudents = 0;
  if (sees("/staff/risk")) {
    const [model, features] = await Promise.all([loadActiveRiskModel(db), loadRiskFeatures(db, { limit: 500 })]);
    if (model) criticalStudents = features.filter((row) => scoreStudent(featuresToInputs(row), model).risk_tier === "critical").length;
  }

  const counts: TodayCounts = {
    urgentConcerns: count(urgentConcerns),
    criticalStudents,
    gateAlerts: count(gateAlerts),
    hearingsToday: count(hearingsToday),
    datesToApprove: count(datesToApprove),
    newConcerns: count(newConcerns),
    casesToSchedule: count(casesToSchedule),
    lettersToRead: count(lettersToRead),
    documentsToCheck: count(documentsToCheck),
    idValidations: count(idValidations),
    clearanceRequests: count(clearanceRequests),
    openFollowUps: count(openFollowUps),
  };
  const tasks = todayTasks(counts, menu);

  const recentConcerns = (recentResult.data as unknown as ConcernRow[] | null) ?? [];
  const awaitingSummary = count(awaitingSummaryResult);
  const latestSummaryError =
    ((awaitingSummaryResult.data as Array<{ ai_summary_error: string | null }> | null) ?? [])[0]?.ai_summary_error ?? null;
  const triageModel = modelLabel(aiModels().text);
  const triageStatus = !aiConfigured()
    ? { label: "Not set up", tone: "danger" as const }
    : latestSummaryError?.startsWith("Waiting:")
      ? { label: "Waiting", tone: "warning" as const }
      : { label: "Working", tone: "success" as const };
  const concernsDelta = count(concernsToday) - count(concernsYesterday);
  const firstName = staff?.fullName?.split(" ")[0] || "there";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {greetingFor(manilaWallClock(now).minutes)}, {firstName}
          </h1>
          <p className="mt-1 text-lg text-muted-foreground">{formatManilaLongDate(now)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/staff/cases/new" className={buttonVariants({ className: "bg-tup-maroon-600 text-white hover:bg-tup-maroon-700" })}>
            <PlusIcon className="h-5 w-5" />
            File a case
          </Link>
          <Link href="/staff/concerns/new" className={SECONDARY_BUTTON}>
            <NotePencilIcon className="h-5 w-5" />
            Record a concern
          </Link>
          {sees("/staff/reports") && (
            <Link href="/staff/reports" className={SECONDARY_BUTTON}>
              <ChartBarIcon className="h-5 w-5" />
              Reports and exports
            </Link>
          )}
        </div>
      </header>

      <section aria-labelledby="waiting-heading" className="rounded-2xl border border-border bg-card">
        <h2 id="waiting-heading" className="border-b border-border px-6 py-4 text-xl font-semibold tracking-tight">
          Waiting for you
        </h2>
        {tasks.length === 0 ? (
          <div className="flex items-center gap-4 px-6 py-8">
            <CheckCircleIcon className="h-8 w-8 shrink-0 text-green-700" />
            <div>
              <p className="text-lg font-medium">Nothing is waiting for you right now.</p>
              <p className="text-base text-muted-foreground">New concerns, cases and requests will appear here as they arrive.</p>
            </div>
          </div>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li
                key={task.key}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border px-6 py-4 last:border-0",
                  task.urgent && "bg-red-50/60",
                )}
              >
                <p className="flex min-w-0 items-center gap-3 text-lg">
                  {task.urgent ? (
                    <WarningIcon className="h-6 w-6 shrink-0 text-destructive" aria-label="Urgent" />
                  ) : (
                    // The sentence already starts with the number; a dot keeps the rows aligned.
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
                      <span className="h-2.5 w-2.5 rounded-full bg-tup-maroon-600" />
                    </span>
                  )}
                  <span className={cn(task.urgent && "font-semibold")}>{task.text}</span>
                </p>
                <Link href={task.href} className={task.urgent ? URGENT_BUTTON : SECONDARY_BUTTON}>
                  {task.action}
                  <ArrowRightIcon className="h-5 w-5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading" className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <h2 id="recent-heading" className="text-xl font-semibold tracking-tight">Recent concerns</h2>
          <Link href="/staff/concerns" className="inline-flex items-center gap-1.5 text-base font-medium text-tup-maroon-600 hover:underline">
            See all concerns
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        </div>
        {recentConcerns.length === 0 ? (
          <p className="px-6 py-8 text-base text-muted-foreground">No concerns yet. New ones will appear here.</p>
        ) : (
          <ul>
            {recentConcerns.map((concern) => (
              <RecentConcern key={concern.id} concern={concern} />
            ))}
          </ul>
        )}
      </section>

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-6 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
          Numbers and system status
          <CaretDownIcon className="h-5 w-5 transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="space-y-6 border-t border-border px-6 py-5">
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              label="Concerns today"
              value={count(concernsToday)}
              trend={
                concernsDelta === 0
                  ? "Same as yesterday"
                  : concernsDelta > 0
                    ? `${concernsDelta} more than yesterday`
                    : `${Math.abs(concernsDelta)} fewer than yesterday`
              }
              trendTone={concernsDelta > 0 ? "warn" : "up"}
              icon={ChatTextIcon}
              iconTone="warn"
            />
            <StatsCard
              label="Urgent concerns"
              value={counts.urgentConcerns}
              valueClassName={counts.urgentConcerns > 0 ? "text-destructive" : ""}
              trend={counts.urgentConcerns > 0 ? "Need a reply" : "None open"}
              trendTone={counts.urgentConcerns > 0 ? "danger" : "up"}
              icon={WarningIcon}
              iconTone={counts.urgentConcerns > 0 ? "danger" : "success"}
            />
            <StatsCard label="Awaiting AI summary" value={awaitingSummary} trend={triageModel} icon={LightningIcon} iconTone="ai" />
            <StatsCard
              label="Students on record"
              value={count(enrolledStudents)}
              trend={`${count(openCases)} open discipline case${count(openCases) === 1 ? "" : "s"}`}
              icon={UsersIcon}
              iconTone="neutral"
            />
          </div>

          <div className="rounded-xl border border-ai-accent-border bg-ai-accent-soft p-5">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <LightningIcon className="h-5 w-5 text-ai-accent" />
              AI concern summaries
            </h3>
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-base sm:grid-cols-2">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Model</dt><dd className="font-medium">{triageModel} on Groq</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Status</dt>
                <dd
                  className={cn(
                    "font-medium",
                    triageStatus.tone === "success" && "text-green-700",
                    triageStatus.tone === "warning" && "text-amber-700",
                    triageStatus.tone === "danger" && "text-destructive",
                  )}
                  title={triageStatus.tone === "warning" ? (latestSummaryError ?? undefined) : undefined}
                >
                  {triageStatus.label}
                </dd>
              </div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Waiting for a summary</dt><dd className="font-medium tabular-nums">{awaitingSummary}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Received today</dt><dd className="font-medium tabular-nums">{count(concernsToday)}</dd></div>
            </dl>
            <p className="mt-3 text-base text-ai-accent">
              The AI writes a short summary to help sort concerns. Staff make every decision.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

function RecentConcern({ concern }: { concern: ConcernRow }) {
  const urgent = concern.urgency_level === "high" || concern.urgency_level === "critical";
  const studentName = concern.students ? `${concern.students.first_name} ${concern.students.last_name}` : "Unknown student";

  return (
    <li className="border-b border-border last:border-0">
      <Link href={`/staff/concerns/${concern.id}`} className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-muted/60">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-medium">
            {urgent && <WarningIcon className="h-5 w-5 shrink-0 text-destructive" aria-label="Urgent" />}
            <span className="truncate">{concern.subject_line}</span>
          </p>
          <p className="mt-0.5 truncate text-base text-muted-foreground">
            {studentName} · <span className="font-mono text-sm">{concern.students?.student_number}</span> · {concernCategoryLabel(concern.category)}
          </p>
        </div>
        <span className="shrink-0 text-base text-muted-foreground">{timeAgo(concern.created_at)}</span>
      </Link>
    </li>
  );
}
