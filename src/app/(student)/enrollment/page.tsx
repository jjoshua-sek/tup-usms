import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BookOpen,
  Clock,
  MapPin,
  User,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { EnrollButton, DropButton } from "@/components/enrollment/enroll-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Enrollment",
};

export const revalidate = 0;

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string;
  year_level: string;
  scholastic_status: string;
}

interface SubjectRow {
  id: string;
  subject_code: string;
  description: string;
  lec_units: number;
  lab_units: number;
  total_units: number;
  prerequisite: string | null;
  semester: string;
  year_level: string;
}

interface ScheduleRow {
  id: string;
  subject_id: string;
  section_id: string;
  faculty_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  room: string;
  staff: { full_name: string } | null;
  sections: { section_code: string } | null;
}

interface EnrollmentRow {
  id: string;
  subject_id: string;
  section_id: string;
  status: string;
  subjects: SubjectRow | null;
  sections: { section_code: string } | null;
}

// Resolve current academic period — in production this would come from
// a settings table; for now we use a sensible default.
const CURRENT_SCHOOL_YEAR = "2025-2026";
const CURRENT_SEMESTER = "1st Semester";

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

/**
 * Returns true if two schedule rows time-overlap (same day + time intersect).
 */
function schedulesConflict(a: ScheduleRow, b: ScheduleRow): boolean {
  if (a.day_of_week !== b.day_of_week) return false;
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

export default async function EnrollmentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, scholastic_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as StudentRow | null;

  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="Enrollment" />
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Profile required</CardTitle>
            <CardDescription>
              Complete your student profile before enrolling in subjects.
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

  // Load current enrollments (status = enrolled)
  const { data: enrollmentsRaw } = await supabase
    .from("enrollments")
    .select(
      `
      id,
      subject_id,
      section_id,
      status,
      subjects (
        id, subject_code, description, lec_units, lab_units, total_units,
        prerequisite, semester, year_level
      ),
      sections (
        section_code
      )
    `
    )
    .eq("student_id", student.id)
    .eq("school_year", CURRENT_SCHOOL_YEAR)
    .eq("semester", CURRENT_SEMESTER)
    .eq("status", "enrolled");

  const enrollments = (enrollmentsRaw as unknown as EnrollmentRow[]) ?? [];
  const enrolledSubjectIds = new Set(enrollments.map((e) => e.subject_id));
  const enrolledSectionIds = enrollments.map((e) => e.section_id);

  // Load schedules for current enrollments (to detect conflicts on candidate sections)
  const { data: enrolledSchedulesRaw } = await supabase
    .from("schedules")
    .select(
      `
      id, subject_id, section_id, faculty_id, day_of_week, start_time,
      end_time, room,
      staff:staff!inner ( full_name ),
      sections!inner ( section_code )
    `
    )
    .in("section_id", enrolledSectionIds.length ? enrolledSectionIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("school_year", CURRENT_SCHOOL_YEAR)
    .eq("semester", CURRENT_SEMESTER);

  const enrolledSchedules = (enrolledSchedulesRaw as unknown as ScheduleRow[]) ?? [];

  // Load available subjects for student's program/year/semester
  const { data: subjectsRaw } = await supabase
    .from("subjects")
    .select(
      "id, subject_code, description, lec_units, lab_units, total_units, prerequisite, semester, year_level"
    )
    .eq("year_level", student.year_level)
    .eq("semester", CURRENT_SEMESTER)
    .order("subject_code", { ascending: true });

  const subjects = (subjectsRaw as unknown as SubjectRow[]) ?? [];

  // Filter to subjects not already enrolled
  const availableSubjects = subjects.filter((s) => !enrolledSubjectIds.has(s.id));

  // For each available subject, fetch its sections + schedules in current period
  const subjectIds = availableSubjects.map((s) => s.id);
  const { data: candidateSchedulesRaw } =
    subjectIds.length > 0
      ? await supabase
          .from("schedules")
          .select(
            `
            id, subject_id, section_id, faculty_id, day_of_week, start_time,
            end_time, room,
            staff:staff!inner ( full_name ),
            sections!inner ( section_code )
          `
          )
          .in("subject_id", subjectIds)
          .eq("school_year", CURRENT_SCHOOL_YEAR)
          .eq("semester", CURRENT_SEMESTER)
      : { data: [] };

  const candidateSchedules =
    (candidateSchedulesRaw as unknown as ScheduleRow[]) ?? [];

  // Group schedules by (subject_id, section_id)
  type SectionGroup = {
    sectionId: string;
    sectionCode: string;
    facultyName: string;
    schedules: ScheduleRow[];
    hasConflict: boolean;
  };
  const sectionsBySubject = new Map<string, SectionGroup[]>();

  for (const sched of candidateSchedules) {
    const key = sched.subject_id;
    if (!sectionsBySubject.has(key)) {
      sectionsBySubject.set(key, []);
    }
    const groups = sectionsBySubject.get(key)!;
    let group = groups.find((g) => g.sectionId === sched.section_id);
    if (!group) {
      group = {
        sectionId: sched.section_id,
        sectionCode: sched.sections?.section_code || "—",
        facultyName: sched.staff?.full_name || "TBA",
        schedules: [],
        hasConflict: false,
      };
      groups.push(group);
    }
    group.schedules.push(sched);
  }

  // Compute conflict flag per section group
  for (const groups of sectionsBySubject.values()) {
    for (const group of groups) {
      group.hasConflict = group.schedules.some((s) =>
        enrolledSchedules.some((e) => schedulesConflict(s, e))
      );
      // Sort schedules by day order, then time
      group.schedules.sort((a, b) => {
        const dayDiff =
          (DAY_ORDER[a.day_of_week] || 99) - (DAY_ORDER[b.day_of_week] || 99);
        return dayDiff !== 0 ? dayDiff : a.start_time.localeCompare(b.start_time);
      });
    }
  }

  // Compute total enrolled units
  const totalUnits = enrollments.reduce(
    (sum, e) => sum + (e.subjects?.total_units || 0),
    0
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enrollment"
        description={`${CURRENT_SCHOOL_YEAR} · ${CURRENT_SEMESTER}`}
      />

      {/* Student summary strip */}
      <Card>
        <CardContent className="grid gap-4 py-5 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Student
            </p>
            <p className="mt-1 font-medium">
              {student.first_name} {student.last_name}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {student.student_number}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Program · Year
            </p>
            <p className="mt-1 font-medium">{student.program}</p>
            <p className="text-xs text-muted-foreground">
              {student.year_level}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Enrolled
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {enrollments.length}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                subject{enrollments.length === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Total Units
            </p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">
              {totalUnits}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scholastic status warning */}
      {student.scholastic_status !== "Regular" && (
        <Alert className="border-amber-500/50 bg-amber-500/5">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <AlertDescription>
            Your scholastic status is{" "}
            <strong>{student.scholastic_status}</strong>. Please consult your
            department chair before enrolling.
          </AlertDescription>
        </Alert>
      )}

      {/* Currently enrolled subjects */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Currently Enrolled</CardTitle>
          <CardDescription>
            Subjects you&apos;re registered for this semester
          </CardDescription>
        </CardHeader>
        <CardContent>
          {enrollments.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              You haven&apos;t enrolled in any subjects yet. Pick from the list
              below to get started.
            </p>
          ) : (
            <ul className="divide-y">
              {enrollments.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-display font-semibold">
                        {e.subjects?.subject_code}
                      </p>
                      <Badge variant="secondary" className="text-[10px]">
                        {e.sections?.section_code}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {e.subjects?.total_units} units
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">
                      {e.subjects?.description}
                    </p>
                  </div>
                  <DropButton enrollmentId={e.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Available subjects */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Subjects</CardTitle>
          <CardDescription>
            Subjects offered for {student.year_level} ·{" "}
            {CURRENT_SEMESTER}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {availableSubjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="mt-3 font-medium">
                You&apos;re enrolled in all available subjects.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check back later if more sections open up.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {availableSubjects.map((subject) => {
                const sections = sectionsBySubject.get(subject.id) || [];
                const hasAnySection = sections.length > 0;

                return (
                  <li
                    key={subject.id}
                    className="rounded-lg border overflow-hidden"
                  >
                    {/* Subject header */}
                    <div className="bg-muted/30 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                            <p className="font-display font-semibold">
                              {subject.subject_code}
                            </p>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {subject.total_units} units (
                              {subject.lec_units} lec /{" "}
                              {subject.lab_units} lab)
                            </span>
                          </div>
                          <p className="mt-1 text-sm">{subject.description}</p>
                          {subject.prerequisite && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Prerequisite:{" "}
                              <span className="font-mono">{subject.prerequisite}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Sections */}
                    {!hasAnySection ? (
                      <p className="px-4 py-4 text-sm text-muted-foreground">
                        No sections offered yet.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {sections.map((sec) => (
                          <li
                            key={sec.sectionId}
                            className={cn(
                              "px-4 py-3",
                              sec.hasConflict && "bg-red-500/5"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline">
                                    Section {sec.sectionCode}
                                  </Badge>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <User className="h-3 w-3" />
                                    {sec.facultyName}
                                  </span>
                                  {sec.hasConflict && (
                                    <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
                                      <AlertCircle className="h-3 w-3" />
                                      Time Conflict
                                    </span>
                                  )}
                                </div>
                                <ul className="space-y-0.5">
                                  {sec.schedules.map((s) => (
                                    <li
                                      key={s.id}
                                      className="flex items-center gap-3 text-xs text-muted-foreground"
                                    >
                                      <span className="inline-flex items-center gap-1 min-w-[100px]">
                                        <Clock className="h-3 w-3" />
                                        <span className="font-medium">
                                          {s.day_of_week.slice(0, 3)}
                                        </span>{" "}
                                        {formatTime(s.start_time)}–
                                        {formatTime(s.end_time)}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <MapPin className="h-3 w-3" />
                                        Room {s.room}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <EnrollButton
                                subjectId={subject.id}
                                sectionId={sec.sectionId}
                                schoolYear={CURRENT_SCHOOL_YEAR}
                                semester={CURRENT_SEMESTER}
                                hasConflict={sec.hasConflict}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground text-center">
        Sections marked &quot;Time Conflict&quot; cannot be enrolled until you
        drop the conflicting subject.
      </p>
    </div>
  );
}
