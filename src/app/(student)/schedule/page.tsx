import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Calendar,
  List,
  ArrowRight,
  CalendarOff,
  User,
  MapPin,
  Clock,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { TimetableGrid } from "@/components/schedule/timetable-grid";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "My Schedule",
};

export const revalidate = 30;

const CURRENT_SCHOOL_YEAR = "2025-2026";
const CURRENT_SEMESTER = "1st Semester";

interface ScheduleRow {
  id: string;
  subject_id: string;
  section_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room: string;
  subjects: {
    subject_code: string;
    description: string;
    lec_units: number;
    lab_units: number;
    total_units: number;
  } | null;
  sections: { section_code: string } | null;
  staff: { full_name: string } | null;
}

const DAY_ORDER: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":");
  const h = parseInt(hours, 10);
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${minutes} ${period}`;
}

export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as { id: string } | null;
  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Schedule" />
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Profile required</CardTitle>
            <CardDescription>
              Complete your student profile before viewing your schedule.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/profile"
              className={buttonVariants({ variant: "default" })}
            >
              Complete profile
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get the section IDs the student is enrolled in
  const { data: enrolledRaw } = await supabase
    .from("enrollments")
    .select("section_id")
    .eq("student_id", student.id)
    .eq("school_year", CURRENT_SCHOOL_YEAR)
    .eq("semester", CURRENT_SEMESTER)
    .eq("status", "enrolled");

  const enrolled = (enrolledRaw as { section_id: string }[]) ?? [];
  const sectionIds = enrolled.map((e) => e.section_id);

  let schedules: ScheduleRow[] = [];
  if (sectionIds.length > 0) {
    const { data: schedulesRaw } = await supabase
      .from("schedules")
      .select(
        `
        id, subject_id, section_id, day_of_week, start_time, end_time, room,
        subjects ( subject_code, description, lec_units, lab_units, total_units ),
        sections ( section_code ),
        staff ( full_name )
      `
      )
      .in("section_id", sectionIds)
      .eq("school_year", CURRENT_SCHOOL_YEAR)
      .eq("semester", CURRENT_SEMESTER);

    schedules = (schedulesRaw as unknown as ScheduleRow[]) ?? [];

    // Sort by day of week, then start time
    schedules.sort((a, b) => {
      const dayDiff =
        (DAY_ORDER[a.day_of_week] || 99) - (DAY_ORDER[b.day_of_week] || 99);
      return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time);
    });
  }

  // Compute totals
  const uniqueSubjects = new Set(schedules.map((s) => s.subject_id));
  const totalUnits = Array.from(uniqueSubjects).reduce((sum, sid) => {
    const sched = schedules.find((s) => s.subject_id === sid);
    return sum + (sched?.subjects?.total_units || 0);
  }, 0);

  // Map schedules to format expected by TimetableGrid
  const gridSchedules = schedules.map((s) => ({
    id: s.id,
    subject_code: s.subjects?.subject_code || "—",
    subject_description: s.subjects?.description || "",
    section_code: s.sections?.section_code || "—",
    faculty_name: s.staff?.full_name || "TBA",
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    room: s.room,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Schedule"
        description={`${CURRENT_SCHOOL_YEAR} · ${CURRENT_SEMESTER}`}
      >
        <Link
          href="/enrollment"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Manage enrollment
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </PageHeader>

      {/* Stats strip */}
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Subjects
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {uniqueSubjects.size}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Units
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {totalUnits}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Class Sessions
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {schedules.length}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                / week
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {schedules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarOff className="h-10 w-10 text-muted-foreground/50" />
            <h3 className="mt-4 font-display font-semibold">
              No schedule yet
            </h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Once you&apos;re enrolled in subjects, your weekly schedule
              will appear here.
            </p>
            <Link
              href="/enrollment"
              className={buttonVariants({ variant: "default" }) + " mt-6"}
            >
              Go to enrollment
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="grid" className="space-y-4">
          <TabsList>
            <TabsTrigger value="grid">
              <Calendar className="mr-1 h-3.5 w-3.5" />
              Weekly View
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="mr-1 h-3.5 w-3.5" />
              Subject List
            </TabsTrigger>
          </TabsList>

          {/* Grid view */}
          <TabsContent value="grid">
            <Card>
              <CardContent className="p-4">
                <TimetableGrid schedules={gridSchedules} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* List view */}
          <TabsContent value="list">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-center">Section</TableHead>
                      <TableHead className="text-center">Units</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Faculty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(uniqueSubjects).map((subjectId) => {
                      const subjSchedules = schedules.filter(
                        (s) => s.subject_id === subjectId
                      );
                      const first = subjSchedules[0];
                      if (!first?.subjects) return null;

                      return (
                        <TableRow key={subjectId}>
                          <TableCell className="font-display font-semibold">
                            {first.subjects.subject_code}
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <p className="font-medium line-clamp-1">
                              {first.subjects.description}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {first.subjects.lec_units} lec ·{" "}
                              {first.subjects.lab_units} lab
                            </p>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary" className="text-[10px]">
                              {first.sections?.section_code}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-mono">
                            {first.subjects.total_units}
                          </TableCell>
                          <TableCell>
                            <ul className="space-y-0.5">
                              {subjSchedules.map((s) => (
                                <li
                                  key={s.id}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className="font-medium min-w-[40px]">
                                    {s.day_of_week.slice(0, 3)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {formatTime(s.start_time)}–
                                    {formatTime(s.end_time)}
                                  </span>
                                  <span className="text-muted-foreground inline-flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />
                                    {s.room}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 text-xs">
                              <User className="h-3 w-3 text-muted-foreground" />
                              {first.staff?.full_name || "TBA"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
