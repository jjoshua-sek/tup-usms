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
} from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
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
  // Convert "14:30:00" -> "2:30 PM"
  const [hours, minutes] = timeStr.split(":");
  const h = parseInt(hours, 10);
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${minutes} ${period}`;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Fetch student profile
  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, scholastic_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as StudentRow | null;

  // If no student profile yet, prompt them to complete it
  if (!student) {
    return (
      <div>
        <PageHeader
          title="Welcome!"
          description="Let's get your profile set up."
        />
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Complete Your Profile</CardTitle>
            <CardDescription>
              Your student profile hasn&apos;t been set up yet. Please fill it
              out so we can show you your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/profile"
              className={buttonVariants({ variant: "default" })}
            >
              Set up profile
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fetch dashboard data in parallel
  const today = new Date();
  const todayName = DAYS_OF_WEEK[today.getDay()];

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
      .limit(5),
  ]);

  const enrolledCount = enrollmentCountResult.count ?? 0;
  const pendingConcerns = pendingConcernsResult.count ?? 0;
  const unreadMessages = unreadMessagesResult.count ?? 0;
  const gpaData = latestGpaResult.data as { gpa: number } | null;
  const gpaDisplay = gpaData?.gpa ? gpaData.gpa.toFixed(2) : "--";
  const todaySchedule = (todayScheduleResult.data as unknown as ScheduleRow[]) ?? [];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${student.first_name}!`}
        description={`${student.program} · ${student.year_level} · ${student.student_number}`}
      />

      {/* ---------- Stat Cards ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatsCard
          title="Enrolled Subjects"
          value={enrolledCount}
          description="Current semester"
          icon={BookOpen}
        />
        <StatsCard
          title="GPA"
          value={gpaDisplay}
          description="Latest semester"
          icon={TrendingUp}
        />
        <StatsCard
          title="Pending Concerns"
          value={pendingConcerns}
          description="Awaiting response"
          icon={AlertCircle}
        />
        <StatsCard
          title="Unread Messages"
          value={unreadMessages}
          description="In your inbox"
          icon={Mail}
        />
      </div>

      {/* ---------- Two-column layout: Schedule + Quick Actions ---------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Today's Schedule */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calendar className="h-5 w-5" />
                Today&apos;s Schedule
              </CardTitle>
              <CardDescription>{todayName}</CardDescription>
            </div>
            <Link
              href="/schedule"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              View week
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {todaySchedule.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-center">
                <Calendar className="h-10 w-10 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">
                  No classes today
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enjoy your day off!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {todaySchedule.map((sched) => (
                  <div
                    key={sched.id}
                    className="flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex flex-col items-center justify-center rounded-md bg-tup-maroon-900 px-3 py-2 text-white min-w-[80px]">
                      <span className="text-xs font-medium opacity-90">
                        {formatTime(sched.start_time)}
                      </span>
                      <span className="text-[10px] opacity-70">
                        {formatTime(sched.end_time)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {sched.subjects?.subject_code || "—"}
                      </p>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {sched.subjects?.description || "Subject details unavailable"}
                      </p>
                    </div>
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      Room {sched.room}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common student tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              href="/concerns"
              className={
                buttonVariants({ variant: "outline" }) +
                " w-full justify-start"
              }
            >
              <AlertCircle className="mr-2 h-4 w-4" />
              Submit Concern
            </Link>
            <Link
              href="/grades"
              className={
                buttonVariants({ variant: "outline" }) +
                " w-full justify-start"
              }
            >
              <GraduationCap className="mr-2 h-4 w-4" />
              View Grades
            </Link>
            <Link
              href="/evaluation"
              className={
                buttonVariants({ variant: "outline" }) +
                " w-full justify-start"
              }
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Faculty Evaluation
            </Link>
            <Link
              href="/messages"
              className={
                buttonVariants({ variant: "outline" }) +
                " w-full justify-start"
              }
            >
              <Mail className="mr-2 h-4 w-4" />
              Inbox
              {unreadMessages > 0 && (
                <Badge variant="destructive" className="ml-auto">
                  {unreadMessages}
                </Badge>
              )}
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Status Banner ---------- */}
      {student.scholastic_status !== "Regular" && (
        <Card className="mt-6 border-amber-500/50 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              Scholastic Status: {student.scholastic_status}
            </CardTitle>
            <CardDescription>
              Please consult with your department chair regarding your academic
              standing.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
