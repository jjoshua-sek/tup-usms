"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";

interface ActionResult {
  success?: boolean;
  error?: string;
}

/**
 * Enroll a student in a specific subject + section.
 * Conflict detection happens both server-side (here) and client-side
 * (the UI hides conflicting sections), giving defense-in-depth.
 */
export async function enrollInSection(
  subjectId: string,
  sectionId: string,
  schoolYear: string,
  semester: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Get student id
  const { data: studentRaw } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRaw as { id: string } | null;
  if (!student) return { error: "Student profile not found." };

  // Check for time conflicts with existing enrollments
  // 1. Get the schedules for the section we want to enroll in
  const { data: targetSchedulesRaw } = await supabase
    .from("schedules")
    .select("day_of_week, start_time, end_time")
    .eq("section_id", sectionId)
    .eq("subject_id", subjectId)
    .eq("school_year", schoolYear)
    .eq("semester", semester);

  const targetSchedules =
    (targetSchedulesRaw as {
      day_of_week: string;
      start_time: string;
      end_time: string;
    }[]) ?? [];

  // 2. Get all schedules of currently enrolled subjects this semester
  const { data: existingRaw } = await supabase
    .from("enrollments")
    .select(
      `
      subject_id,
      section_id,
      schedules:schedules!inner (
        day_of_week,
        start_time,
        end_time,
        section_id,
        subject_id,
        school_year,
        semester
      )
    `
    )
    .eq("student_id", student.id)
    .eq("school_year", schoolYear)
    .eq("semester", semester)
    .eq("status", "enrolled");

  // Flatten existing schedules
  type ScheduleRow = {
    day_of_week: string;
    start_time: string;
    end_time: string;
    section_id: string;
    subject_id: string;
    school_year: string;
    semester: string;
  };
  const existingEnrollments =
    (existingRaw as unknown as { schedules: ScheduleRow[] }[]) ?? [];

  const existingSchedules = existingEnrollments
    .flatMap((e) => e.schedules)
    .filter(
      (s) => s.school_year === schoolYear && s.semester === semester
    );

  // Conflict detection
  for (const target of targetSchedules) {
    for (const existing of existingSchedules) {
      if (target.day_of_week === existing.day_of_week) {
        if (
          target.start_time < existing.end_time &&
          existing.start_time < target.end_time
        ) {
          return {
            error: `Schedule conflict on ${target.day_of_week} ${target.start_time}–${target.end_time}.`,
          };
        }
      }
    }
  }

  // No conflict — enroll
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const { error } = await (supabase as any).from("enrollments").insert({
    student_id: student.id,
    subject_id: subjectId,
    section_id: sectionId,
    school_year: schoolYear,
    semester,
    status: "enrolled",
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You're already enrolled in this subject." };
    }
    console.error("Enrollment failed:", error);
    return { error: "Failed to enroll. Please try again." };
  }

  await logAuditEvent(
    user.id,
    "enrollment_change",
    `enrollments/${subjectId}`,
    { action: "enroll", section_id: sectionId, school_year: schoolYear, semester }
  );

  revalidatePath("/enrollment");
  revalidatePath("/schedule");
  revalidatePath("/dashboard");

  return { success: true };
}

/**
 * Drop an enrollment. The row is updated to status="dropped" instead of
 * deleted, preserving the historical record for audit purposes.
 */
export async function dropEnrollment(
  enrollmentId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("enrollments")
    .update({ status: "dropped" })
    .eq("id", enrollmentId);

  if (error) {
    console.error("Drop failed:", error);
    return { error: "Failed to drop subject." };
  }

  await logAuditEvent(
    user.id,
    "enrollment_change",
    `enrollments/${enrollmentId}`,
    { action: "drop" }
  );

  revalidatePath("/enrollment");
  revalidatePath("/schedule");
  revalidatePath("/dashboard");

  return { success: true };
}
