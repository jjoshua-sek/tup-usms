"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { COUNT_BASES, PENALTY_BASES, appealWindow, prescribeMinorSanction, resolveAppealRoute } from "@/lib/osa/sanctions";
import { getStaffContext } from "@/lib/osa/staff-context";
import { addCaseTimelineEntry } from "@/lib/osa/timeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";
import type { CaseStatus } from "@/types/osa";

/**
 * Sanctions, community service, non-appearance and appeals.
 *
 * Split from `actions.ts` because these implement the handbook's own rules
 * (Table of Offenses, Rules on Discipline Sec. 7.7 and Sec. 9) rather than the
 * OSA's case workflow — they can be verified against the page, not against
 * practice.
 */

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

// ============================================================
// Offense counting
// ============================================================

export interface OffenseCounts {
  cumulative: number;
  schoolYear: number;
  term: number;
  sameOffense: number;
  /** Next sequence number under each reading, i.e. prior count + 1. */
  suggested: { cumulative: number; schoolYear: number; term: number; sameOffense: number };
}

/**
 * Counts a student's prior minor offenses four ways.
 *
 * The handbook prescribes sanctions by offense number but never says over what
 * period the count runs, so the officer is shown every reading and records
 * which one they used. Guessing here would quietly change how severely a
 * student is treated.
 *
 * "Prior" means filed before this case and not dismissed — a dismissed
 * complaint is not an offense.
 */
export async function getMinorOffenseCounts(caseId: string): Promise<{
  counts?: OffenseCounts;
  error?: string;
}> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Not permitted." };

  const db = loose(createAdminClient());

  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, student_id, incident_date, created_at, violation_type_id")
    .eq("id", caseId)
    .maybeSingle();

  const current = caseRow as {
    id: string;
    student_id: string;
    incident_date: string;
    created_at: string;
    violation_type_id: string | null;
  } | null;
  if (!current) return { error: "Case not found." };

  const { data: priorRows } = await db
    .from("violation_cases")
    .select("id, incident_date, created_at, violation_type_id, status")
    .eq("student_id", current.student_id)
    .eq("classification", "minor")
    .neq("status", "dismissed")
    .neq("id", current.id);

  const prior =
    (priorRows as Array<{
      incident_date: string;
      violation_type_id: string | null;
    }> | null) ?? [];

  // School year runs August to July at TUP, so the boundary is not January.
  const incident = new Date(current.incident_date);
  const yearStart = new Date(
    incident.getMonth() + 1 >= 8 ? incident.getFullYear() : incident.getFullYear() - 1,
    7,
    1,
  );
  // Term boundary: Aug–Dec, Jan–May, Jun–Jul.
  const month = incident.getMonth() + 1;
  const termStart = new Date(
    month >= 8 ? incident.getFullYear() : incident.getFullYear(),
    month >= 8 ? 7 : month >= 6 ? 5 : 0,
    1,
  );

  const before = prior.filter((row) => new Date(row.incident_date) <= incident);
  const counts: OffenseCounts = {
    cumulative: before.length,
    schoolYear: before.filter((row) => new Date(row.incident_date) >= yearStart).length,
    term: before.filter((row) => new Date(row.incident_date) >= termStart).length,
    sameOffense: before.filter(
      (row) =>
        current.violation_type_id != null &&
        row.violation_type_id === current.violation_type_id,
    ).length,
    suggested: { cumulative: 0, schoolYear: 0, term: 0, sameOffense: 0 },
  };

  counts.suggested = {
    cumulative: counts.cumulative + 1,
    schoolYear: counts.schoolYear + 1,
    term: counts.term + 1,
    sameOffense: counts.sameOffense + 1,
  };

  return { counts };
}

// ============================================================
// Community service
// ============================================================

const assignSchema = z.object({
  case_id: z.string().uuid(),
  offense_sequence: z.coerce.number().int().min(2).max(10),
  count_basis: z.enum(COUNT_BASES),
  hours_required: z.coerce.number().int().min(1).max(200),
  service_detail: z.string().trim().max(500).optional().or(z.literal("")),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Give a completion deadline." })
    .optional()
    .or(z.literal("")),
});

/**
 * Assigns community service for a second or later minor offense.
 *
 * The hours are checked against the handbook's band for that rung: an officer
 * may still go outside it, but the record then shows the prescribed band
 * alongside what was actually assigned, which is the difference between a
 * documented exception and a mistake.
 */
export async function assignCommunityService(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can assign community service." };

  const parsed = assignSchema.safeParse({
    case_id: formData.get("case_id"),
    offense_sequence: formData.get("offense_sequence"),
    count_basis: formData.get("count_basis") ?? "cumulative",
    hours_required: formData.get("hours_required"),
    service_detail: formData.get("service_detail") ?? "",
    deadline: formData.get("deadline") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the assignment." };
  }

  const prescribed = prescribeMinorSanction(parsed.data.offense_sequence);
  if (prescribed.kind !== "community_service") {
    return {
      error: "A first offense carries a warning and a letter of apology, not community service.",
    };
  }

  const db = loose(createAdminClient());

  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, case_number, status, student_id, classification, students(user_id)")
    .eq("id", parsed.data.case_id)
    .maybeSingle();

  const violationCase = caseRow as {
    id: string;
    case_number: string;
    status: CaseStatus;
    student_id: string;
    classification: string;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };

  const { error } = await db.from("community_service_assignments").insert({
    case_id: violationCase.id,
    student_id: violationCase.student_id,
    offense_sequence: parsed.data.offense_sequence,
    count_basis: parsed.data.count_basis,
    hours_required: parsed.data.hours_required,
    band_min: prescribed.bandMin,
    band_max: prescribed.bandMax,
    handbook_reference: prescribed.handbookReference,
    service_detail: parsed.data.service_detail
      ? sanitizeText(parsed.data.service_detail, 500)
      : null,
    deadline: parsed.data.deadline || null,
    assigned_by: staff.staffId,
    status: "assigned",
  });

  if (error) return { error: "Could not save the assignment." };

  await db
    .from("violation_cases")
    .update({ sanction_applied: `${parsed.data.hours_required} hours of community service` })
    .eq("id", violationCase.id);

  const outsideBand =
    prescribed.bandMin != null &&
    prescribed.bandMax != null &&
    (parsed.data.hours_required < prescribed.bandMin ||
      parsed.data.hours_required > prescribed.bandMax);

  await addCaseTimelineEntry(db, {
    caseId: violationCase.id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "sanction_applied",
    summary: `${parsed.data.hours_required} hours of community service assigned as offense no. ${parsed.data.offense_sequence}.${
      outsideBand
        ? ` Outside the prescribed ${prescribed.bandMin}–${prescribed.bandMax} hour band.`
        : ""
    }`,
    details: {
      handbook_reference: prescribed.handbookReference,
      band: [prescribed.bandMin, prescribed.bandMax],
      count_basis: parsed.data.count_basis,
      outside_band: outsideBand,
    },
  });

  if (violationCase.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: violationCase.students.user_id,
      p_type: "sanction_applied",
      p_title: `${parsed.data.hours_required} hours of community service assigned`,
      p_body: `For case ${violationCase.case_number}.${parsed.data.deadline ? ` To be completed by ${parsed.data.deadline}.` : ""} Clearance and Good Moral requests are held until the hours are served.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "See the details",
      p_entity_type: "violation_case",
      p_entity_id: violationCase.id,
    });
  }

  await logAuditEvent(staff.userId, "case_updated", "community_service_assignments", {
    case_id: violationCase.id,
    hours: parsed.data.hours_required,
  });

  revalidatePath(`/staff/cases/${violationCase.id}`);
  revalidatePath("/staff/cases");
  return {
    ok: true,
    message: outsideBand
      ? "Assigned, and recorded as outside the handbook band."
      : "Assigned, and the student has been told.",
  };
}

const serviceProgressSchema = z.object({
  assignment_id: z.string().uuid(),
  hours_completed: z.coerce.number().min(0).max(500),
  verifier_role: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  mark: z.enum(["progress", "completed", "not_served", "waived"]),
});

/**
 * Records hours served. Completing the last assignment on a case closes it —
 * the handbook's ladder ends at the sanction being served, and a case parked
 * open after the student has done the work is the same failure as the apology
 * loop had.
 */
export async function recordServiceProgress(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can record service hours." };

  const parsed = serviceProgressSchema.safeParse({
    assignment_id: formData.get("assignment_id"),
    hours_completed: formData.get("hours_completed") ?? 0,
    verifier_role: formData.get("verifier_role") ?? "",
    notes: formData.get("notes") ?? "",
    mark: formData.get("mark") ?? "progress",
  });
  if (!parsed.success) return { error: "Check the hours you entered." };

  const db = loose(createAdminClient());

  const { data: assignmentRow } = await db
    .from("community_service_assignments")
    .select("id, case_id, hours_required, violation_cases(case_number, status, students(user_id))")
    .eq("id", parsed.data.assignment_id)
    .maybeSingle();

  const assignment = assignmentRow as {
    id: string;
    case_id: string;
    hours_required: number;
    violation_cases: {
      case_number: string;
      status: CaseStatus;
      students: { user_id: string } | null;
    } | null;
  } | null;
  if (!assignment) return { error: "Assignment not found." };

  const now = new Date().toISOString();
  const status =
    parsed.data.mark === "progress"
      ? parsed.data.hours_completed >= assignment.hours_required
        ? "completed"
        : "in_progress"
      : parsed.data.mark;

  const { error } = await db
    .from("community_service_assignments")
    .update({
      hours_completed: parsed.data.hours_completed,
      status,
      verifier_role: parsed.data.verifier_role || null,
      verification_notes: parsed.data.notes ? sanitizeText(parsed.data.notes, 500) : null,
      verified_by: status === "completed" || status === "waived" ? staff.staffId : null,
      verified_at: status === "completed" || status === "waived" ? now : null,
    })
    .eq("id", assignment.id);

  if (error) return { error: "Could not record the hours." };

  const settled = status === "completed" || status === "waived";
  let closedCase = false;

  if (settled) {
    // Any other assignment on this case still outstanding?
    const { count } = await db
      .from("community_service_assignments")
      .select("id", { count: "exact", head: true })
      .eq("case_id", assignment.case_id)
      .in("status", ["assigned", "in_progress", "not_served"]);

    if ((count ?? 0) === 0) {
      await db
        .from("violation_cases")
        .update({
          status: "closed",
          resolution_path: "counselling_apology",
          closed_at: now,
        })
        .eq("id", assignment.case_id);
      closedCase = true;
    }
  }

  await addCaseTimelineEntry(db, {
    caseId: assignment.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: closedCase ? "closed" : "note_added",
    summary:
      status === "waived"
        ? `Community service waived.${parsed.data.notes ? ` ${parsed.data.notes}` : ""}`
        : status === "not_served"
          ? `Community service not served: ${parsed.data.hours_completed} of ${assignment.hours_required} hours.${parsed.data.notes ? ` ${parsed.data.notes}` : ""}`
          : `${parsed.data.hours_completed} of ${assignment.hours_required} hours recorded${parsed.data.verifier_role ? `, verified by ${parsed.data.verifier_role}` : ""}.${closedCase ? " Sanction served; case closed." : ""}`,
    fromStatus: assignment.violation_cases?.status ?? null,
    toStatus: closedCase ? "closed" : null,
  });

  if (closedCase && assignment.violation_cases?.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: assignment.violation_cases.students.user_id,
      p_type: "case_resolved",
      p_title: "Your case is closed",
      p_body: `Your community service for case ${assignment.violation_cases.case_number} is recorded as complete. Nothing further is required.`,
      p_priority: "normal",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: assignment.case_id,
    });
  }

  revalidatePath(`/staff/cases/${assignment.case_id}`);
  revalidatePath("/staff/cases");
  return {
    ok: true,
    message: closedCase ? "Recorded — the case is now closed." : "Recorded.",
  };
}

// ============================================================
// Non-appearance — Rules on Discipline Sec. 7.7
// ============================================================

const nonAppearanceSchema = z.object({
  hearing_id: z.string().uuid(),
  party: z.enum(["student", "complainant"]),
  proceeded: z.enum(["ex_parte", "reset"]),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Records that a party did not appear.
 *
 * Sec. 7.7: where either party fails to appear after due notice and without
 * justifiable cause, the fact is noted and the proceeding continues ex-parte.
 * The system offers "reset" as well, because a justifiable cause is exactly the
 * exception the rule carves out — but ex-parte is the default, since that is
 * what the handbook prescribes.
 */
export async function recordNonAppearance(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can record a non-appearance." };

  const parsed = nonAppearanceSchema.safeParse({
    hearing_id: formData.get("hearing_id"),
    party: formData.get("party") ?? "student",
    proceeded: formData.get("proceeded") ?? "ex_parte",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "Invalid entry." };

  const db = loose(createAdminClient());

  const { data: hearingRow } = await db
    .from("case_hearings")
    .select("id, case_id, scheduled_start, violation_cases(case_number, status)")
    .eq("id", parsed.data.hearing_id)
    .maybeSingle();

  const hearing = hearingRow as {
    id: string;
    case_id: string;
    scheduled_start: string;
    violation_cases: { case_number: string; status: CaseStatus } | null;
  } | null;
  if (!hearing) return { error: "Hearing not found." };

  const { error } = await db
    .from("case_hearings")
    .update({
      status:
        parsed.data.party === "student" ? "no_show_student" : "no_show_complainant",
      meeting_notes: parsed.data.notes ? sanitizeText(parsed.data.notes, 500) : null,
      completed_at: parsed.data.proceeded === "ex_parte" ? new Date().toISOString() : null,
      outcome: parsed.data.proceeded === "ex_parte" ? "no_resolution" : null,
    })
    .eq("id", hearing.id);

  if (error) return { error: "Could not record the non-appearance." };

  await addCaseTimelineEntry(db, {
    caseId: hearing.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "no_show",
    summary:
      parsed.data.proceeded === "ex_parte"
        ? `The ${parsed.data.party} did not appear after due notice. Noted, and the proceeding continued ex-parte (Sec. 7.7).${parsed.data.notes ? ` ${parsed.data.notes}` : ""}`
        : `The ${parsed.data.party} did not appear. Reset for a justifiable cause.${parsed.data.notes ? ` ${parsed.data.notes}` : ""}`,
    details: { handbook_reference: "Rules on Discipline Sec. 7.7" },
  });

  revalidatePath(`/staff/cases/${hearing.case_id}`);
  revalidatePath("/staff/hearings");
  return {
    ok: true,
    message:
      parsed.data.proceeded === "ex_parte"
        ? "Recorded — the proceeding continues ex-parte."
        : "Recorded — schedule a new date.",
  };
}

// ============================================================
// Manual scheduling — when the slot finder comes back empty
// ============================================================

const manualHearingSchema = z.object({
  case_id: z.string().uuid(),
  hearing_type: z.enum([
    "counselling",
    "conference",
    "mediation",
    "pic_hearing",
    "sdb_hearing",
    "follow_up",
  ]),
  scheduled_start: z.string().min(10, { message: "Give a date and time." }),
  duration_minutes: z.coerce.number().int().min(15).max(480),
  venue: z.string().trim().min(2).max(120),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

/**
 * Books a hearing by hand.
 *
 * The scheduler finds slots where both parties are free; when it finds none
 * inside the horizon, the case still has to be heard. This records that the
 * date was chosen by a person rather than proposed by the system — the
 * distinction matters when reviewing why a student was called at an awkward
 * hour.
 */
export async function scheduleHearingManually(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can schedule hearings." };

  const parsed = manualHearingSchema.safeParse({
    case_id: formData.get("case_id"),
    hearing_type: formData.get("hearing_type") ?? "conference",
    scheduled_start: formData.get("scheduled_start") ?? "",
    duration_minutes: formData.get("duration_minutes") ?? 45,
    venue: formData.get("venue") ?? "OSA Office",
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the date and venue." };
  }

  const start = new Date(parsed.data.scheduled_start);
  if (Number.isNaN(start.getTime())) return { error: "That date could not be read." };
  if (start.getTime() < Date.now()) return { error: "That date is in the past." };

  const end = new Date(start.getTime() + parsed.data.duration_minutes * 60_000);
  const db = loose(createAdminClient());

  const { error } = await db.from("case_hearings").insert({
    case_id: parsed.data.case_id,
    hearing_type: parsed.data.hearing_type,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
    venue: sanitizeText(parsed.data.venue, 120),
    status: "awaiting_complainant",
    proposed_by: "staff",
  });

  if (error) return { error: "Could not create the hearing." };

  await addCaseTimelineEntry(db, {
    caseId: parsed.data.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "status_changed",
    summary: `Meeting booked by hand for ${start.toLocaleString("en-PH")} at ${parsed.data.venue}.${parsed.data.reason ? ` Reason: ${parsed.data.reason}` : ""}`,
    details: { proposed_by: "staff" },
  });

  await logAuditEvent(staff.userId, "hearing_scheduled", "case_hearings", {
    case_id: parsed.data.case_id,
    manual: true,
  });

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  revalidatePath("/staff/hearings");
  return { ok: true, message: "Booked. The complainant still has to approve the date." };
}

// ============================================================
// Appeals — Rules on Discipline Sec. 9
// ============================================================

const openAppealSchema = z.object({
  case_id: z.string().uuid(),
  escalation_id: z.string().uuid().optional().or(z.literal("")),
  penalty_basis: z.enum(PENALTY_BASES),
  notice_received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "When did the student receive the Notice of Decision?",
  }),
});

/**
 * Opens the appeal window once the Notice of Decision has been served.
 *
 * The appellate body and the deadline are both derived from the penalty, not
 * typed in — Sec. 9.2 fixes them, and the whole point of recording this is to
 * stop a student losing a right because nobody counted ten days.
 */
export async function openAppealWindow(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can record an appeal window." };

  const parsed = openAppealSchema.safeParse({
    case_id: formData.get("case_id"),
    escalation_id: formData.get("escalation_id") ?? "",
    penalty_basis: formData.get("penalty_basis"),
    notice_received_on: formData.get("notice_received_on"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the dates." };
  }

  const route = resolveAppealRoute(parsed.data.penalty_basis);
  const window = appealWindow(parsed.data.notice_received_on, route.days);
  const deadline = window.deadline.toISOString().slice(0, 10);

  const db = loose(createAdminClient());

  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, case_number, students(user_id)")
    .eq("id", parsed.data.case_id)
    .maybeSingle();

  const violationCase = caseRow as {
    id: string;
    case_number: string;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };

  const { error } = await db.from("case_appeals").insert({
    case_id: parsed.data.case_id,
    escalation_id: parsed.data.escalation_id || null,
    penalty_basis: parsed.data.penalty_basis,
    appellate_body: route.appellateBody,
    notice_received_on: parsed.data.notice_received_on,
    appeal_deadline: deadline,
    status: "window_open",
    recorded_by: staff.staffId,
  });

  if (error) return { error: "Could not open the appeal window." };

  await addCaseTimelineEntry(db, {
    caseId: parsed.data.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "note_added",
    summary: `Notice of Decision received ${parsed.data.notice_received_on}. Appealable to the ${route.bodyLabel} until ${deadline} (${route.handbookReference}).`,
    details: {
      penalty_basis: parsed.data.penalty_basis,
      appellate_body: route.appellateBody,
      deadline,
    },
  });

  // The student is the one with a deadline to keep.
  if (violationCase.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: violationCase.students.user_id,
      p_type: "appeal_window_opened",
      p_title: "You may appeal this decision until " + deadline,
      p_body: `For case ${violationCase.case_number}: an appeal is filed with the ${route.bodyLabel} within ${route.days} days of your receipt of the Notice of Decision (${route.handbookReference}). The OSA does not decide the appeal.${route.furtherRecourse ? ` ${route.furtherRecourse}` : ""}`,
      p_priority: "urgent",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: parsed.data.case_id,
    });
  }

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  return { ok: true, message: `Window open until ${deadline}. The student has been told.` };
}

const appealOutcomeSchema = z.object({
  appeal_id: z.string().uuid(),
  status: z.enum(["filed", "decided", "lapsed", "withdrawn"]),
  filed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  outcome: z
    .enum(["upheld", "modified", "reversed", "remanded", "dismissed"])
    .optional()
    .or(z.literal("")),
  decided_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  outcome_notes: z.string().trim().max(1000).optional().or(z.literal("")),
  external_reference: z.string().trim().max(80).optional().or(z.literal("")),
});

export async function recordAppealOutcome(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can update an appeal." };

  const parsed = appealOutcomeSchema.safeParse({
    appeal_id: formData.get("appeal_id"),
    status: formData.get("status"),
    filed_on: formData.get("filed_on") ?? "",
    outcome: formData.get("outcome") ?? "",
    decided_on: formData.get("decided_on") ?? "",
    outcome_notes: formData.get("outcome_notes") ?? "",
    external_reference: formData.get("external_reference") ?? "",
  });
  if (!parsed.success) return { error: "Invalid update." };

  if (parsed.data.status === "decided" && !parsed.data.outcome) {
    return { error: "Name the appellate body's decision." };
  }

  const db = loose(createAdminClient());

  const { data: appealRow } = await db
    .from("case_appeals")
    .select("id, case_id, appellate_body")
    .eq("id", parsed.data.appeal_id)
    .maybeSingle();

  const appeal = appealRow as {
    id: string;
    case_id: string;
    appellate_body: string;
  } | null;
  if (!appeal) return { error: "Appeal record not found." };

  const { error } = await db
    .from("case_appeals")
    .update({
      status: parsed.data.status,
      filed_on: parsed.data.filed_on || null,
      outcome: parsed.data.outcome || null,
      decided_on: parsed.data.decided_on || null,
      outcome_notes: parsed.data.outcome_notes
        ? sanitizeText(parsed.data.outcome_notes, 1000)
        : null,
      external_reference: parsed.data.external_reference || null,
    })
    .eq("id", appeal.id);

  if (error) return { error: "Could not save the appeal." };

  // A reversal or a remand puts the case back in play; the OSA moves the case
  // status itself, since only they know what the appellate order requires.
  await addCaseTimelineEntry(db, {
    caseId: appeal.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "note_added",
    summary:
      parsed.data.status === "lapsed"
        ? "Appeal window lapsed without an appeal. The decision is final and executory."
        : parsed.data.status === "filed"
          ? `Appeal filed${parsed.data.filed_on ? ` on ${parsed.data.filed_on}` : ""}.`
          : parsed.data.status === "withdrawn"
            ? "Appeal withdrawn."
            : `Appeal ${parsed.data.outcome}${parsed.data.external_reference ? ` (${parsed.data.external_reference})` : ""}.${parsed.data.outcome_notes ? ` ${parsed.data.outcome_notes}` : ""}`,
    details: { appellate_body: appeal.appellate_body, status: parsed.data.status },
  });

  await logAuditEvent(staff.userId, "case_updated", "case_appeals", {
    appeal_id: appeal.id,
    status: parsed.data.status,
  });

  revalidatePath(`/staff/cases/${appeal.case_id}`);
  return { ok: true, message: "Saved." };
}
