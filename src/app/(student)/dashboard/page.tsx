import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  TrendingUp,
  AlertCircle,
  Mail,
  Calendar,
  ArrowRight,
  ClipboardCheck,
  GraduationCap,
  Sparkles,
  Clock,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const revalidate = 30;

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string;
  year_level: string;
  scholastic_status: string;
  section: string | null;
}

interface ScheduleRow {
  id: string;
  subject_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room: string;
  subjects: {
    subject_code: string;
    description: string;
  } | null;
}

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":");
  const h = parseInt(hours, 10);
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${minutes} ${period}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, scholastic_status, section"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as StudentRow | null;

  // Profile not set up yet — friendly onboarding screen
  if (!student) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="bg-tup-gradient bg-grid-pattern relative overflow-hidden rounded-2xl p-8 text-white">
          <div className="relative z-10">
            <Badge className="mb-3 bg-white/15 text-white border-white/20 backdrop-blur-sm">
              <Sparkles className="mr-1 h-3 w-3" />
              Welcome to TUP-Manila USMS
            </Badge>
            <h1 className="text-3xl font-display font-bold tracking-tight">
              Let&apos;s set up your profile
            </h1>
            <p className="mt-2 text-white/80 max-w-prose">
              Before you can access your enrollment, schedule, and grades, we
              need a few details. It only takes about 5 minutes.
            </p>
            <Link
              href="/profile"
              className={cn(
                buttonVariants({ variant: "default" }),
                "mt-6 bg-white text-tup-maroon-900 hover:bg-white/90"
              )}
            >
              Set up my profile
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Today's date string
  const today = new Date();
  const todayName = DAYS_OF_WEEK[today.getDay()];
  const dateString = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Parallel data fetches
  const [
    enrollmentCountResult,
    pendingConcernsResult,
    unreadMessagesResult,
    latestGpaResult,
    todayScheduleResult,
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("status", "enrolled"),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .in("status", ["pending", "in_review"]),
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .eq("status", "unread"),
    supabase
      .from("academic_records")
      .select("gpa, school_year, semester")
      .eq("student_id", student.id)
      .order("school_year", { ascending: false })
      .order("semester", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("schedules")
      .select(
        `
        id,
        subject_id,
        day_of_week,
        start_time,
        end_time,
        room,
        subjects (
          subject_code,
          description
        )
      `
      )
      .eq("day_of_week", todayName)
      .order("start_time", { ascending: true })
      .limit(8),
  ]);

  const enrolledCount = enrollmentCountResult.count ?? 0;
  const pendingConcerns = pendingConcernsResult.count ?? 0;
  const unreadMessages = unreadMessagesResult.count ?? 0;

  // Resolve GPA data safely — avoid double-casting later in JSX
  const gpaData = latestGpaResult.data as
    | { gpa: number; school_year: string; semester: string }
    | null;
  const gpaDisplay = gpaData?.gpa ? gpaData.gpa.toFixed(2) : "—";
  const gpaSubtext = gpaData
    ? `${gpaData.school_year} · ${gpaData.semester}`
    : "no records yet";

  const todaySchedule = (todayScheduleResult.data as unknown as ScheduleRow[]) ?? [];

  // Determine current/next class
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const minutesFromTime = (t: string) => {
    const [h, m] = t.split(":").map((s) => parseInt(s, 10));
    return h * 60 + m;
  };

  const currentClass = todaySchedule.find((s) => {
    const start = minutesFromTime(s.start_time);
    const end = minutesFromTime(s.end_time);
    return nowMinutes >= start && nowMinutes < end;
  });

  const nextClass = todaySchedule.find((s) => {
    return minutesFromTime(s.start_time) > nowMinutes;
  });

  return (
    <div className="space-y-6">
      {/* ====== HERO BANNER ====== */}
      <div className="bg-tup-gradient bg-grid-pattern relative overflow-hidden rounded-2xl p-6 sm:p-8 text-white">
        {/* Decorative blob */}
        <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-tup-gold-400/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/3 h-32 w-32 rounded-full bg-tup-maroon-400/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white/70">{dateString}</p>
            <h1 className="mt-1 text-3xl sm:text-4xl font-display font-bold tracking-tight text-balance">
              {getGreeting()}, {student.first_name}
            </h1>
            <p className="mt-2 text-sm text-white/80">
              <span className="font-medium text-tup-gold-100">
                {student.program}
              </span>{" "}
              · {student.year_level}
              {student.section && <> · Section {student.section}</>}
              <span className="ml-2 inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-mono tracking-wide backdrop-blur-sm">
                {student.student_number}
              </span>
            </p>
          </div>

          {/* Now / Next class indicator */}
          {(currentClass || nextClass) && (
            <div className="rounded-xl border border-white/20 bg-white/10 p-3 backdrop-blur-md min-w-[200px]">
              <p className="text-[10px] uppercase font-semibold tracking-widest text-tup-gold-100">
                {currentClass ? "Class in progress" : "Up next"}
              </p>
              <p className="mt-1 font-display font-semibold leading-tight">
                {(currentClass || nextClass)?.subjects?.subject_code}
              </p>
              <p className="text-xs text-white/70">
                {formatTime((currentClass || nextClass)!.start_time)} ·{" "}
                Room {(currentClass || nextClass)!.room}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ====== STAT CARDS ====== */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Enrolled Subjects"
          value={enrolledCount}
          subtext="this semester"
          icon={BookOpen}
          accent="blue"
        />
        <StatCard
          label="Latest GPA"
          value={gpaDisplay}
          subtext={gpaSubtext}
          icon={TrendingUp}
          accent="emerald"
        />
        <StatCard
          label="Pending Concerns"
          value={pendingConcerns}
          subtext="awaiting response"
          icon={AlertCircle}
          accent="amber"
          href="/concerns"
        />
        <StatCard
          label="Unread Messages"
          value={unreadMessages}
          subtext="in your inbox"
          icon={Mail}
          accent="violet"
          href="/messages"
        />
      </div>

      {/* ====== TWO-COLUMN MAIN ====== */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's Schedule (timeline) */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <div className="rounded-lg bg-primary/10 p-1.5">
                  <Calendar className="h-4 w-4 text-primary" />
                </div>
                Today&apos;s Schedule
              </CardTitle>
              <CardDescription>{todayName} · {todaySchedule.length} class{todaySchedule.length === 1 ? "" : "es"}</CardDescription>
            </div>
            <Link
              href="/schedule"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "text-muted-foreground"
              )}
            >
              Full week
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {todaySchedule.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="rounded-full bg-emerald-500/10 p-4">
                  <Calendar className="h-8 w-8 text-emerald-600" />
                </div>
                <p className="mt-4 font-medium">No classes today</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Take a breather — you&apos;ve earned it.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {todaySchedule.map((sched) => {
                  const isCurrent = currentClass?.id === sched.id;
                  const startMin = minutesFromTime(sched.start_time);
                  const isPast = startMin < nowMinutes && !isCurrent;
                  return (
                    <li
                      key={sched.id}
                      className={cn(
                        "relative flex items-stretch gap-4 px-6 py-4 transition-colors hover:bg-accent/30",
                        isCurrent && "bg-primary/5"
                      )}
                    >
                      {/* Time block */}
                      <div className="flex flex-col items-center justify-center gap-1 min-w-[88px] py-1">
                        <span
                          className={cn(
                            "text-sm font-display font-semibold tabular-nums",
                            isCurrent && "text-primary",
                            isPast && "text-muted-foreground/50"
                          )}
                        >
                          {formatTime(sched.start_time)}
                        </span>
                        <div className="h-3 w-px bg-border" />
                        <span
                          className={cn(
                            "text-xs text-muted-foreground tabular-nums",
                            isPast && "text-muted-foreground/50"
                          )}
                        >
                          {formatTime(sched.end_time)}
                        </span>
                      </div>

                      {/* Vertical accent line */}
                      <div
                        className={cn(
                          "w-1 rounded-full",
                          isCurrent
                            ? "bg-primary"
                            : isPast
                              ? "bg-muted"
                              : "bg-tup-maroon-300"
                        )}
                      />

                      {/* Subject info */}
                      <div className="flex-1 min-w-0 py-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              "font-display font-semibold",
                              isPast && "text-muted-foreground/70"
                            )}
                          >
                            {sched.subjects?.subject_code || "—"}
                          </p>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                              Now
                            </span>
                          )}
                        </div>
                        <p
                          className={cn(
                            "text-sm text-muted-foreground line-clamp-1",
                            isPast && "text-muted-foreground/50"
                          )}
                        >
                          {sched.subjects?.description}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            Room {sched.room}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.round(
                              (minutesFromTime(sched.end_time) -
                                minutesFromTime(sched.start_time)) /
                                30
                            ) * 0.5}{" "}
                            hr
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right column: Quick Actions + Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
              <CardDescription>Common tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <QuickAction
                href="/concerns"
                icon={AlertCircle}
                label="Submit a concern"
                accent="text-amber-600"
              />
              <QuickAction
                href="/grades"
                icon={GraduationCap}
                label="View my grades"
                accent="text-emerald-600"
              />
              <QuickAction
                href="/evaluation"
                icon={ClipboardCheck}
                label="Faculty evaluation"
                accent="text-blue-600"
              />
              <QuickAction
                href="/messages"
                icon={Mail}
                label="Messages"
                accent="text-violet-600"
                badge={unreadMessages > 0 ? unreadMessages : undefined}
              />
            </CardContent>
          </Card>

          {/* Scholastic Status */}
          {student.scholastic_status !== "Regular" ? (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  Scholastic Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-display font-bold text-amber-700 dark:text-amber-400">
                  {student.scholastic_status}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Please consult your department chair regarding your standing.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-emerald-500/40 bg-emerald-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <Sparkles className="h-4 w-4" />
                  All clear
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-display font-bold text-emerald-700 dark:text-emerald-400">
                  Regular Status
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You&apos;re in good academic standing. Keep it up!
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Subcomponents
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
            <p className="mt-2 font-display text-3xl font-bold tracking-tight">
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
  badge?: number;
}

function QuickAction({ href, icon: Icon, label, accent, badge }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-accent"
    >
      <span className="flex items-center gap-3">
        <Icon className={cn("h-4 w-4", accent)} />
        <span className="font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {badge !== undefined && badge > 0 && (
          <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
            {badge}
          </Badge>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </span>
    </Link>
  );
}
