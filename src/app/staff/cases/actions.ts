"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { addCaseTimelineEntry } from "@/lib/osa/timeline";
import {
  findAvailableSlots,
  formatSlot,
  type AvailabilityBlock,
} from "@/lib/scheduling/find-slots";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { sanitizeText } from "@/lib/utils/sanitize";
import { CASE_STATUSES, type CaseStatus } from "@/types/osa";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

export interface StudentMatch {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  program: string | null;
  year_level: string | null;
}

/**
 * Type-ahead for the complainee field.
 *
 * Filing against the wrong student is the most damaging mistake this form can
 * make, so the filer picks a real record rather than typing a number and
 * hoping. Results are capped and the query is only run for staff.
 */
export async function searchStudentsForCase(query: string): Promise<{
  students?: StudentMatch[];
  error?: string;
}> {
  const staff = await getStaffContext();
  if (!staff) return { error: "Only staff can file a case." };

  const term = query.trim();
  if (term.length < 2) return { students: [] };

  const escaped = term.replace(/[%_,()]/g, " ");
  const db = loose(createAdminClient());

  const { data } = await db
    .from("students")
    .select("id, student_number, first_name, last_name, program, year_level")
    .or(
      `student_number.ilike.%${escaped}%,last_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%`,
    )
    .order("last_name", { ascending: true })
    .limit(8);

  return { students: (data as StudentMatch[] | null) ?? [] };
}

export interface TrackRecord {
  minor: number;
  major: number;
  open: number;
  lastIncidentDate: string | null;
}

/**
 * The complainee's history (requirement #2), shown to the filer before they
 * submit. A repeat minor offense is handled differently from a first one, and
 * the person filing is usually the first to need that context.
 *
 * Counts only — never the case details, which stay with the OSA.
 */
export async function getStudentTrackRecord(studentId: string): Promise<{
  record?: TrackRecord;
  error?: string;
}> {
  const staff = await getStaffContext();
  if (!staff) return { error: "Not permitted." };

  const db = loose(createAdminClient());
  const { data } = await db
    .from("violation_cases")
    .select("classification, status, incident_date")
    .eq("student_id", studentId)
    // CODI matters never inform a general filing screen.
    .neq("confidentiality", "codi")
    .order("incident_date", { ascending: false });

  const rows =
    (data as Array<{
      classification: string;
      status: CaseStatus;
      incident_date: string;
    }> | null) ?? [];

  return {
    record: {
      minor: rows.filter((row) => row.classification === "minor").length,
      major: rows.filter((row) => row.classification === "major").length,
      open: rows.filter((row) => !["closed", "dismissed"].includes(row.status)).length,
      lastIncidentDate: rows[0]?.incident_date ?? null,
    },
  };
}

const fileCaseSchema = z.object({
  student_id: z.string().uuid({ message: "Pick the student from the search results." }),
  violation_type_id: z.string().uuid({ message: "Choose what happened." }),
  complainant_type: z.enum(["faculty", "staff", "student", "osa_initiated", "external"]),
  complainant_name: z.string().trim().max(120).optional().or(z.literal("")),
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Give the date of the incident.",
  }),
  incident_time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Time must look like 14:30." })
    .optional()
    .or(z.literal("")),
  incident_location: z.string().trim().max(120).optional().or(z.literal("")),
  description: z
    .string()
    .trim()
    .min(30, { message: "Describe what happened in at least a couple of sentences." })
    .max(5000),
});

/**
 * Files a complaint (requirement #4).
 *
 * Three things are decided here rather than left to the filer:
 *   - the classification comes from the violation type, not from a dropdown
 *     the complainant can talk themselves into; OSA can reclassify later,
 *     and that reclassification is recorded
 *   - a type marked `auto_route_codi` (harassment and the like) is filed as
 *     confidential and disappears from the general OSA queue immediately,
 *     per the OSA process document
 *   - the student is NOT notified on filing. Notice comes with the summons,
 *     after the OSA has triaged and a date is approved.
 */
export async function fileCase(formData: FormData): Promise<Result & { caseId?: string }> {
  const staff = await getStaffContext();
  if (!staff) return { error: "Only staff can file a case." };

  // A complaint is cheap to file and expensive to receive; this is the brake
  // on a bad afternoon turning into forty cases.
  const limit = checkRateLimit({
    identifier: `file-case:${staff.userId}`,
    maxRequests: 20,
    windowSeconds: 3600,
  });
  if (!limit.success) {
    return { error: "You've filed a lot of cases in the last hour. Take a moment." };
  }

  const parsed = fileCaseSchema.safeParse({
    student_id: formData.get("student_id"),
    violation_type_id: formData.get("violation_type_id"),
    complainant_type: formData.get("complainant_type") ?? "faculty",
    complainant_name: formData.get("complainant_name") ?? "",
    incident_date: formData.get("incident_date"),
    incident_time: formData.get("incident_time") ?? "",
    incident_location: formData.get("incident_location") ?? "",
    description: formData.get("description") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  // An incident cannot have happened tomorrow.
  const incidentDate = new Date(`${parsed.data.incident_date}T00:00:00`);
  if (incidentDate.getTime() > Date.now()) {
    return { error: "The incident date is in the future." };
  }

  const db = loose(createAdminClient());

  const { data: typeRow } = await db
    .from("violation_types")
    .select("id, code, name, default_classification, auto_route_codi, is_active")
    .eq("id", parsed.data.violation_type_id)
    .maybeSingle();

  const violationType = typeRow as {
    id: string;
    code: string;
    name: string;
    default_classification: "minor" | "major" | "confidential";
    auto_route_codi: boolean;
    is_active: boolean;
  } | null;
  if (!violationType || !violationType.is_active) {
    return { error: "That offense type is no longer available." };
  }

  const isConfidential =
    violationType.auto_route_codi || violationType.default_classification === "confidential";

  const { data: studentRow } = await db
    .from("students")
    .select("id, first_name, last_name, student_number")
    .eq("id", parsed.data.student_id)
    .maybeSingle();

  const student = studentRow as {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
  } | null;
  if (!student) return { error: "That student record no longer exists." };

  const { data: inserted, error } = await db
    .from("violation_cases")
    .insert({
      student_id: student.id,
      complainant_staff_id: parsed.data.complainant_type === "osa_initiated" ? null : staff.staffId,
      complainant_type: parsed.data.complainant_type,
      complainant_name:
        parsed.data.complainant_name?.trim() ||
        (parsed.data.complainant_type === "osa_initiated" ? "OSA-initiated" : staff.fullName),
      violation_type_id: violationType.id,
      classification: isConfidential ? "confidential" : violationType.default_classification,
      incident_date: parsed.data.incident_date,
      incident_time: parsed.data.incident_time || null,
      incident_location: parsed.data.incident_location
        ? sanitizeText(parsed.data.incident_location, 120)
        : null,
      description: sanitizeText(parsed.data.description, 5000),
      status: isConfidential ? "referred_codi" : "filed",
      confidentiality: isConfidential ? "codi" : "normal",
      resolution_path: isConfidential ? "codi_referral" : null,
    })
    .select("id, case_number")
    .maybeSingle();

  if (error) return { error: "Could not file the case. Please try again." };

  const created = inserted as { id: string; case_number: string } | null;
  if (!created) return { error: "The case was not created." };

  await addTimelineEntry(db, {
    caseId: created.id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "case_filed",
    summary: `${staff.fullName} filed a complaint for ${violationType.name} (${violationType.code}).`,
    toStatus: isConfidential ? "referred_codi" : "filed",
    details: {
      violation_code: violationType.code,
      classification: isConfidential ? "confidential" : violationType.default_classification,
      routed_to_codi: isConfidential,
    },
  });

  await logAuditEvent(staff.userId, "case_filed", "violation_cases", {
    case_id: created.id,
    case_number: created.case_number,
    student_number: student.student_number,
    violation_code: violationType.code,
    confidential: isConfidential,
  });

  revalidatePath("/staff/cases");
  return {
    ok: true,
    caseId: created.id,
    message: isConfidential
      ? `Filed as ${created.case_number} and routed to CODI. It will not appear in the general case queue.`
      : `Filed as ${created.case_number}.`,
  };
}

/**
 * Local alias for the shared history helper, kept so the call sites below read
 * unchanged. The implementation lives in lib/osa/timeline.ts because an export
 * from a "use server" module is a public endpoint, and forging case history
 * must not be one.
 */
const addTimelineEntry = addCaseTimelineEntry;

/**
 * Cross-checks the complainant's and the student's schedules and records the
 * best mutually free slots (requirement #1).
 *
 * The search itself is pure (`find-slots.ts`); this action's job is to gather
 * both parties' busy blocks and persist the ranked results so the rationale
 * behind a proposed date survives past the request that produced it. Older
 * suggestions are superseded rather than deleted — the case file should show
 * that a date was offered and replaced, not just the final answer.
 */
export async function proposeHearingSlots(caseId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can run the scheduler." };

  const db = loose(createAdminClient());

  const { data: caseData } = await db
    .from("violation_cases")
    .select(
      "id, case_number, status, classification, student_id, complainant_staff_id, students(user_id)",
    )
    .eq("id", caseId)
    .maybeSingle();

  const violationCase = caseData as {
    id: string;
    case_number: string;
    status: CaseStatus;
    classification: string;
    student_id: string;
    complainant_staff_id: string | null;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };

  const studentUserId = violationCase.students?.user_id ?? null;

  let complainantUserId: string | null = null;
  if (violationCase.complainant_staff_id) {
    const { data: complainantRow } = await db
      .from("staff")
      .select("user_id")
      .eq("id", violationCase.complainant_staff_id)
      .maybeSingle();
    complainantUserId = (complainantRow as { user_id: string } | null)?.user_id ?? null;
  }

  const userIds = [studentUserId, complainantUserId].filter(Boolean) as string[];
  const { data: blockRows } = userIds.length
    ? await db.from("availability_blocks").select("*").in("user_id", userIds)
    : { data: [] };

  const blocks = (blockRows as AvailabilityBlock[] | null) ?? [];

  const slots = findAvailableSlots({
    complainantBlocks: complainantUserId
      ? blocks.filter((block) => block.user_id === complainantUserId)
      : [],
    studentBlocks: studentUserId
      ? blocks.filter((block) => block.user_id === studentUserId)
      : [],
  });

  if (slots.length === 0) {
    return {
      error:
        "No slot works for both parties in the next two weeks. Schedule manually, or ask them to trim their busy blocks.",
    };
  }

  // Keep the history, retire the old suggestions.
  await db
    .from("hearing_slot_proposals")
    .update({ status: "superseded" })
    .eq("case_id", caseId)
    .eq("status", "suggested");

  const batchId = randomUUID();
  const { error } = await db.from("hearing_slot_proposals").insert(
    slots.map((slot, index) => ({
      case_id: caseId,
      proposed_start: slot.start.toISOString(),
      proposed_end: slot.end.toISOString(),
      score: slot.score,
      rationale: slot.rationale,
      score_factors: slot.factors,
      rank: index + 1,
      batch_id: batchId,
      status: "suggested",
    })),
  );

  if (error) return { error: "Could not save the proposed slots." };

  await addTimelineEntry(db, {
    caseId,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "slots_proposed",
    summary: `${slots.length} meeting slots proposed from both parties' schedules.`,
    details: {
      batch_id: batchId,
      top_slot: formatSlot(slots[0]),
      student_blocks: blocks.filter((b) => b.user_id === studentUserId).length,
      complainant_blocks: blocks.filter((b) => b.user_id === complainantUserId).length,
    },
  });

  revalidatePath(`/staff/cases/${caseId}`);
  return { ok: true, message: `${slots.length} slots proposed.` };
}

const scheduleSchema = z.object({
  proposal_id: z.string().uuid(),
  hearing_type: z.enum([
    "counselling",
    "conference",
    "mediation",
    "pic_hearing",
    "sdb_hearing",
    "follow_up",
  ]),
  venue: z.string().trim().min(2).max(120),
});

/**
 * Turns a proposed slot into an actual hearing, pending the complainant's
 * approval. The professor approves the date *before* the student is told —
 * that ordering is the requirement, and it's enforced by the status ladder
 * rather than by convention.
 */
export async function scheduleHearingFromProposal(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can schedule hearings." };

  const parsed = scheduleSchema.safeParse({
    proposal_id: formData.get("proposal_id"),
    hearing_type: formData.get("hearing_type"),
    venue: formData.get("venue") ?? "OSA Office",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the hearing details." };
  }

  const db = loose(createAdminClient());

  const { data: proposalRow } = await db
    .from("hearing_slot_proposals")
    .select("id, case_id, proposed_start, proposed_end, rationale")
    .eq("id", parsed.data.proposal_id)
    .maybeSingle();

  const proposal = proposalRow as {
    id: string;
    case_id: string;
    proposed_start: string;
    proposed_end: string;
    rationale: string | null;
  } | null;
  if (!proposal) return { error: "That slot is no longer available." };

  const { error } = await db.from("case_hearings").insert({
    case_id: proposal.case_id,
    hearing_type: parsed.data.hearing_type,
    scheduled_start: proposal.proposed_start,
    scheduled_end: proposal.proposed_end,
    venue: sanitizeText(parsed.data.venue, 120),
    status: "awaiting_complainant",
    proposed_by: "system",
  });

  if (error) return { error: "Could not create the hearing." };

  await db
    .from("hearing_slot_proposals")
    .update({ status: "selected", selected_by: staff.staffId, selected_at: new Date().toISOString() })
    .eq("id", proposal.id);
  await db
    .from("hearing_slot_proposals")
    .update({ status: "superseded" })
    .eq("case_id", proposal.case_id)
    .eq("status", "suggested");

  await addTimelineEntry(db, {
    caseId: proposal.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "status_changed",
    summary: `Meeting pencilled in for ${new Date(proposal.proposed_start).toLocaleString("en-PH")}, awaiting the complainant's approval.`,
    details: { rationale: proposal.rationale },
  });

  await logAuditEvent(staff.userId, "hearing_scheduled", "case_hearings", {
    case_id: proposal.case_id,
  });

  revalidatePath(`/staff/cases/${proposal.case_id}`);
  revalidatePath("/staff/hearings");
  return { ok: true, message: "Slot reserved. Ask the complainant to approve it." };
}

/**
 * Complainant (or the OSA head acting on a written approval) confirms the
 * date. Only after this does the student hear anything.
 */
export async function approveHearing(hearingId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff) return { error: "You are signed out." };

  const db = loose(createAdminClient());

  const { data: hearingRow } = await db
    .from("case_hearings")
    .select("id, case_id, status, scheduled_start, violation_cases(complainant_staff_id)")
    .eq("id", hearingId)
    .maybeSingle();

  const hearing = hearingRow as {
    id: string;
    case_id: string;
    status: string;
    scheduled_start: string;
    violation_cases: { complainant_staff_id: string | null } | null;
  } | null;
  if (!hearing) return { error: "Hearing not found." };

  const isComplainant =
    hearing.violation_cases?.complainant_staff_id === staff.staffId;
  if (!isComplainant && !staff.isOsa) {
    return { error: "Only the complainant or the OSA can approve this date." };
  }
  if (hearing.status !== "awaiting_complainant") {
    return { error: "This date has already moved past approval." };
  }

  const { error } = await db
    .from("case_hearings")
    .update({
      status: "complainant_approved",
      complainant_approved_by: staff.staffId,
      complainant_approved_at: new Date().toISOString(),
    })
    .eq("id", hearingId);

  if (error) return { error: "Could not record the approval." };

  await addTimelineEntry(db, {
    caseId: hearing.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "schedule_approved",
    summary: `${staff.fullName} approved the meeting date.`,
  });

  revalidatePath(`/staff/cases/${hearing.case_id}`);
  revalidatePath("/staff/hearings");
  return { ok: true, message: "Approved. The student can now be notified." };
}

/**
 * Sends the summons through the portal and the student's institutional email
 * (requirement #4). `create_notification` fans out to email only where the
 * student's notification preferences allow it.
 */
export async function notifyStudentOfHearing(hearingId: string): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can send a summons." };

  const db = loose(createAdminClient());

  const { data: hearingRow } = await db
    .from("case_hearings")
    .select(
      "id, case_id, status, scheduled_start, scheduled_end, venue, hearing_type, violation_cases(case_number, status, student_id, students(user_id, first_name))",
    )
    .eq("id", hearingId)
    .maybeSingle();

  const hearing = hearingRow as {
    id: string;
    case_id: string;
    status: string;
    scheduled_start: string;
    venue: string;
    hearing_type: string;
    violation_cases: {
      case_number: string;
      status: CaseStatus;
      students: { user_id: string; first_name: string } | null;
    } | null;
  } | null;
  if (!hearing) return { error: "Hearing not found." };

  if (hearing.status !== "complainant_approved") {
    return {
      error:
        "The complainant has to approve the date first — that approval is what the summons rests on.",
    };
  }

  const when = new Date(hearing.scheduled_start).toLocaleString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const { error } = await db
    .from("case_hearings")
    .update({
      status: "student_notified",
      student_notified_at: new Date().toISOString(),
      notified_via_portal: true,
      notified_via_email: true,
    })
    .eq("id", hearingId);

  if (error) return { error: "Could not send the summons." };

  const studentUserId = hearing.violation_cases?.students?.user_id;
  if (studentUserId) {
    await db.rpc("create_notification", {
      p_user_id: studentUserId,
      p_type: "hearing_summons",
      p_title: "You have a meeting with the Office of Student Affairs",
      p_body: `${when} at ${hearing.venue}, regarding case ${hearing.violation_cases?.case_number}. Please open the portal and confirm you've seen this.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/appointments",
      p_action_label: "View and acknowledge",
      p_entity_type: "case_hearing",
      p_entity_id: hearingId,
    });
  }

  await db
    .from("violation_cases")
    .update({ status: "summons_sent" })
    .eq("id", hearing.case_id);

  await addTimelineEntry(db, {
    caseId: hearing.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "student_notified",
    summary: `Summons sent for ${when} at ${hearing.venue}.`,
    fromStatus: hearing.violation_cases?.status ?? null,
    toStatus: "summons_sent",
  });

  await logAuditEvent(staff.userId, "hearing_notified", "case_hearings", {
    hearing_id: hearingId,
    case_id: hearing.case_id,
  });

  revalidatePath(`/staff/cases/${hearing.case_id}`);
  revalidatePath("/staff/hearings");
  return { ok: true, message: "Summons sent through the portal and by email." };
}

const apologyReviewSchema = z.object({
  letter_id: z.string().uuid(),
  decision: z.enum(["accept", "request_revision", "reject"]),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

/**
 * OSA verdict on an apology letter — the step that actually closes a MINOR
 * case (counselling → apology → closed, per the OSA flowchart).
 *
 * Accepting does three things at once, and they belong together: the letter
 * is marked accepted, the case is closed with `resolution_path` recorded as
 * counselling_apology, and the student is told. Leaving any of the three to a
 * second manual step is how cases sit at `awaiting_apology` for a semester
 * after the student has already apologised.
 */
export async function reviewApologyLetter(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can review apology letters." };

  const parsed = apologyReviewSchema.safeParse({
    letter_id: formData.get("letter_id"),
    decision: formData.get("decision"),
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: "Invalid review." };

  // Asking for changes without saying what to change wastes everyone's time.
  if (parsed.data.decision !== "accept" && !parsed.data.notes) {
    return { error: "Tell the student what to change — they see this note." };
  }

  const db = loose(createAdminClient());

  const { data: letterRow } = await db
    .from("apology_letters")
    .select(
      "id, case_id, review_status, violation_cases(case_number, status), students(user_id, first_name)",
    )
    .eq("id", parsed.data.letter_id)
    .maybeSingle();

  const letter = letterRow as {
    id: string;
    case_id: string;
    review_status: string;
    violation_cases: { case_number: string; status: CaseStatus } | null;
    students: { user_id: string; first_name: string } | null;
  } | null;
  if (!letter) return { error: "Letter not found." };
  if (letter.review_status === "accepted") {
    return { error: "This letter has already been accepted." };
  }

  const now = new Date().toISOString();
  const reviewStatus =
    parsed.data.decision === "accept"
      ? "accepted"
      : parsed.data.decision === "request_revision"
        ? "revision_requested"
        : "rejected";

  const { error } = await db
    .from("apology_letters")
    .update({
      review_status: reviewStatus,
      reviewed_by: staff.staffId,
      reviewed_at: now,
      reviewer_notes: parsed.data.notes ? sanitizeText(parsed.data.notes, 1000) : null,
    })
    .eq("id", letter.id);

  if (error) return { error: "Could not save the review." };

  if (parsed.data.decision === "accept") {
    await db
      .from("violation_cases")
      .update({
        status: "closed",
        resolution_path: "counselling_apology",
        closed_at: now,
      })
      .eq("id", letter.case_id);

    await addTimelineEntry(db, {
      caseId: letter.case_id,
      actorId: staff.userId,
      actorLabel: staff.fullName,
      eventType: "apology_accepted",
      summary: `Apology letter accepted; case closed on the counselling + apology path.${parsed.data.notes ? ` ${parsed.data.notes}` : ""}`,
      fromStatus: letter.violation_cases?.status ?? null,
      toStatus: "closed",
    });
  } else {
    await addTimelineEntry(db, {
      caseId: letter.case_id,
      actorId: staff.userId,
      actorLabel: staff.fullName,
      eventType: "apology_rejected",
      summary:
        parsed.data.decision === "request_revision"
          ? `Revision requested: ${parsed.data.notes}`
          : `Apology letter not accepted: ${parsed.data.notes}`,
    });
  }

  if (letter.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: letter.students.user_id,
      p_type: "apology_review",
      p_title:
        parsed.data.decision === "accept"
          ? "Your apology letter was accepted"
          : "Your apology letter needs changes",
      p_body:
        parsed.data.decision === "accept"
          ? `Case ${letter.violation_cases?.case_number} is now closed. Nothing further is required from you.`
          : `The OSA asked for changes to your letter for case ${letter.violation_cases?.case_number}: ${parsed.data.notes}`,
      p_priority: parsed.data.decision === "accept" ? "normal" : "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "apology_letter",
      p_entity_id: letter.id,
    });
  }

  await logAuditEvent(staff.userId, "case_updated", "apology_letters", {
    letter_id: letter.id,
    case_id: letter.case_id,
    decision: parsed.data.decision,
  });

  revalidatePath(`/staff/cases/${letter.case_id}`);
  revalidatePath("/staff/cases");
  return {
    ok: true,
    message:
      parsed.data.decision === "accept"
        ? "Accepted — the case is closed and the student has been told."
        : "Saved. The student has been asked for a revised letter.",
  };
}

/** Short-lived link to a scanned apology letter, for OSA review. */
export async function getApologyFileUrl(letterId: string): Promise<{
  url?: string;
  error?: string;
}> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Not permitted." };

  const db = loose(createAdminClient());
  const { data } = await db
    .from("apology_letters")
    .select("file_path")
    .eq("id", letterId)
    .maybeSingle();

  const letter = data as { file_path: string | null } | null;
  if (!letter?.file_path) return { error: "No file attached to that letter." };

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from("case-documents")
    .createSignedUrl(letter.file_path, 300);

  if (error || !signed?.signedUrl) return { error: "Could not open that file." };
  return { url: signed.signedUrl };
}

// ============================================================
// SETTLEMENTS — the mediated "win-win" close-out
// ============================================================

const settlementSchema = z.object({
  case_id: z.string().uuid(),
  hearing_id: z.string().uuid().optional().or(z.literal("")),
  terms: z
    .string()
    .trim()
    .min(20, { message: "Write out what both sides agreed to." })
    .max(4000),
  student_obligations: z.string().trim().max(2000).optional().or(z.literal("")),
  compliance_deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Give a deadline date." })
    .optional()
    .or(z.literal("")),
});

/**
 * Records the agreement reached at mediation.
 *
 * Drafting does not settle the case. A settlement takes effect only when all
 * three parties have signed — student, complainant, OSA as witness — which is
 * what `recordSettlementSignature` below tracks. Writing the terms down and
 * calling the case settled in the same step would record consent nobody gave.
 */
export async function draftSettlement(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can draft a settlement." };

  const parsed = settlementSchema.safeParse({
    case_id: formData.get("case_id"),
    hearing_id: formData.get("hearing_id") ?? "",
    terms: formData.get("terms") ?? "",
    student_obligations: formData.get("student_obligations") ?? "",
    compliance_deadline: formData.get("compliance_deadline") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the settlement terms." };
  }

  const db = loose(createAdminClient());

  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, case_number, status, students(user_id)")
    .eq("id", parsed.data.case_id)
    .maybeSingle();

  const violationCase = caseRow as {
    id: string;
    case_number: string;
    status: CaseStatus;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };

  const { error } = await db.from("case_settlements").insert({
    case_id: parsed.data.case_id,
    hearing_id: parsed.data.hearing_id || null,
    terms: sanitizeText(parsed.data.terms, 4000),
    student_obligations: parsed.data.student_obligations
      ? sanitizeText(parsed.data.student_obligations, 2000)
      : null,
    compliance_deadline: parsed.data.compliance_deadline || null,
    // The OSA officer drafting it is the witness to the agreement.
    osa_witnessed_by: staff.staffId,
    osa_witnessed_at: new Date().toISOString(),
  });

  if (error) return { error: "Could not save the settlement." };

  if (!["settled", "closed", "dismissed"].includes(violationCase.status)) {
    await db
      .from("violation_cases")
      .update({ status: "in_mediation" })
      .eq("id", parsed.data.case_id);
  }

  await addTimelineEntry(db, {
    caseId: parsed.data.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "settlement_drafted",
    summary: `Settlement drafted and witnessed by ${staff.fullName}. Awaiting signatures.`,
    fromStatus: violationCase.status,
    toStatus: "in_mediation",
  });

  if (violationCase.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: violationCase.students.user_id,
      p_type: "settlement",
      p_title: "A settlement is waiting for your agreement",
      p_body: `Read the terms agreed for case ${violationCase.case_number} and confirm whether you accept them.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Read the terms",
      p_entity_type: "case_settlement",
      p_entity_id: parsed.data.case_id,
    });
  }

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  return { ok: true, message: "Settlement drafted. The student has been asked to sign." };
}

/**
 * Applies one party's signature and, when the last one lands, moves the case
 * to settled. The check runs on the row as it is after this write, so the
 * order in which the three parties sign doesn't matter.
 */
export async function recordSettlementSignature(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff) return { error: "You are signed out." };

  const settlementId = String(formData.get("settlement_id") ?? "");
  const party = String(formData.get("party") ?? "");
  if (!settlementId || !["complainant", "osa"].includes(party)) {
    return { error: "Invalid signature." };
  }

  const db = loose(createAdminClient());

  const { data: settlementRow } = await db
    .from("case_settlements")
    .select(
      "id, case_id, student_signed_at, complainant_signed_at, osa_witnessed_at, violation_cases(case_number, complainant_staff_id, status)",
    )
    .eq("id", settlementId)
    .maybeSingle();

  const settlement = settlementRow as {
    id: string;
    case_id: string;
    student_signed_at: string | null;
    complainant_signed_at: string | null;
    osa_witnessed_at: string | null;
    violation_cases: {
      case_number: string;
      complainant_staff_id: string | null;
      status: CaseStatus;
    } | null;
  } | null;
  if (!settlement) return { error: "Settlement not found." };

  const isComplainant =
    settlement.violation_cases?.complainant_staff_id === staff.staffId;
  if (party === "complainant" && !isComplainant && !staff.isOsa) {
    return { error: "Only the complainant can sign on their behalf." };
  }
  if (party === "osa" && !staff.isOsa) {
    return { error: "Only OSA staff can witness a settlement." };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    party === "complainant"
      ? { complainant_signed_at: now }
      : { osa_witnessed_at: now, osa_witnessed_by: staff.staffId };

  const { error } = await db.from("case_settlements").update(patch).eq("id", settlementId);
  if (error) return { error: "Could not record the signature." };

  const signed = {
    student: Boolean(settlement.student_signed_at),
    complainant: party === "complainant" ? true : Boolean(settlement.complainant_signed_at),
    osa: party === "osa" ? true : Boolean(settlement.osa_witnessed_at),
  };

  await addTimelineEntry(db, {
    caseId: settlement.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "settlement_signed",
    summary: `${party === "osa" ? "OSA witnessed" : "Complainant signed"} the settlement.`,
  });

  if (signed.student && signed.complainant && signed.osa) {
    await db
      .from("violation_cases")
      .update({ status: "settled", resolution_path: "mediation_settlement" })
      .eq("id", settlement.case_id);

    await addTimelineEntry(db, {
      caseId: settlement.case_id,
      actorId: staff.userId,
      actorLabel: staff.fullName,
      eventType: "status_changed",
      summary: "All parties have signed. The settlement is in effect.",
      fromStatus: settlement.violation_cases?.status ?? null,
      toStatus: "settled",
    });
  }

  revalidatePath(`/staff/cases/${settlement.case_id}`);
  return { ok: true, message: "Signature recorded." };
}

/**
 * Closes the loop on what the student actually agreed to do. A settlement
 * nobody checks is a promise, not a sanction — so compliance is recorded
 * explicitly, and complying is what finally closes the case.
 */
export async function recordSettlementCompliance(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can record compliance." };

  const settlementId = String(formData.get("settlement_id") ?? "");
  const complied = String(formData.get("complied") ?? "") === "yes";
  const notes = String(formData.get("notes") ?? "").trim();
  if (!settlementId) return { error: "Invalid settlement." };

  const db = loose(createAdminClient());

  const { data: settlementRow } = await db
    .from("case_settlements")
    .select("id, case_id, violation_cases(case_number, status, students(user_id))")
    .eq("id", settlementId)
    .maybeSingle();

  const settlement = settlementRow as {
    id: string;
    case_id: string;
    violation_cases: {
      case_number: string;
      status: CaseStatus;
      students: { user_id: string } | null;
    } | null;
  } | null;
  if (!settlement) return { error: "Settlement not found." };

  const now = new Date().toISOString();
  const { error } = await db
    .from("case_settlements")
    .update({ is_complied: complied, complied_at: complied ? now : null })
    .eq("id", settlementId);

  if (error) return { error: "Could not record compliance." };

  if (complied) {
    await db
      .from("violation_cases")
      .update({
        status: "closed",
        resolution_path: "mediation_settlement",
        closed_at: now,
        resolution_notes: notes ? sanitizeText(notes, 1000) : null,
      })
      .eq("id", settlement.case_id);
  }

  await addTimelineEntry(db, {
    caseId: settlement.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: complied ? "closed" : "note_added",
    summary: complied
      ? `Settlement obligations completed. Case closed.${notes ? ` ${notes}` : ""}`
      : `Settlement obligations NOT met.${notes ? ` ${notes}` : ""}`,
    fromStatus: settlement.violation_cases?.status ?? null,
    toStatus: complied ? "closed" : null,
  });

  if (complied && settlement.violation_cases?.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: settlement.violation_cases.students.user_id,
      p_type: "case_status",
      p_title: "Your case is closed",
      p_body: `You completed what was agreed in case ${settlement.violation_cases.case_number}. Nothing further is required.`,
      p_priority: "normal",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: settlement.case_id,
    });
  }

  revalidatePath(`/staff/cases/${settlement.case_id}`);
  revalidatePath("/staff/cases");
  return { ok: true, message: complied ? "Recorded — case closed." : "Recorded." };
}

// ============================================================
// ESCALATIONS — PIC / SDB / CODI
// ============================================================

const escalationSchema = z.object({
  case_id: z.string().uuid(),
  escalated_to: z.enum(["PIC", "SDB", "CODI"]),
  reason: z
    .string()
    .trim()
    .min(20, { message: "Say why the case needs a committee." })
    .max(2000),
});

/** Case status that each committee referral puts the case into. */
const ESCALATION_STATUS: Record<"PIC" | "SDB" | "CODI", CaseStatus> = {
  PIC: "escalated_pic",
  SDB: "escalated_sdb",
  CODI: "referred_codi",
};

/**
 * Refers a case to a committee.
 *
 * A CODI referral also flips the case to confidential, which removes it from
 * the general OSA queue immediately — and from the student's own portal,
 * since RLS hides `confidentiality = 'codi'` rows from them. That is the OSA
 * process document's rule, not a UI preference, so the student is told by the
 * committee through its own channel rather than by a portal notification
 * pointing at a page they can no longer open.
 */
export async function escalateCase(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can escalate a case." };

  const parsed = escalationSchema.safeParse({
    case_id: formData.get("case_id"),
    escalated_to: formData.get("escalated_to"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the escalation." };
  }

  const db = loose(createAdminClient());

  const { data: caseRow } = await db
    .from("violation_cases")
    .select("id, case_number, status, confidentiality, students(user_id)")
    .eq("id", parsed.data.case_id)
    .maybeSingle();

  const violationCase = caseRow as {
    id: string;
    case_number: string;
    status: CaseStatus;
    students: { user_id: string } | null;
  } | null;
  if (!violationCase) return { error: "Case not found." };

  const { error } = await db.from("case_escalations").insert({
    case_id: parsed.data.case_id,
    escalated_to: parsed.data.escalated_to,
    escalated_by: staff.staffId,
    reason: sanitizeText(parsed.data.reason, 2000),
    outcome: "pending",
  });

  if (error) return { error: "Could not record the escalation." };

  const toCodi = parsed.data.escalated_to === "CODI";
  const casePatch: Record<string, unknown> = {
    status: ESCALATION_STATUS[parsed.data.escalated_to],
  };
  if (toCodi) {
    casePatch.confidentiality = "codi";
    casePatch.classification = "confidential";
    casePatch.resolution_path = "codi_referral";
  }

  await db.from("violation_cases").update(casePatch).eq("id", parsed.data.case_id);

  await addTimelineEntry(db, {
    caseId: parsed.data.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "escalated",
    summary: `Referred to ${parsed.data.escalated_to}: ${parsed.data.reason}`,
    fromStatus: violationCase.status,
    toStatus: ESCALATION_STATUS[parsed.data.escalated_to],
  });

  if (!toCodi && violationCase.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: violationCase.students.user_id,
      p_type: "case_status",
      p_title: `Your case was referred to the ${parsed.data.escalated_to}`,
      p_body: `Case ${violationCase.case_number} now goes before the ${parsed.data.escalated_to === "PIC" ? "Preliminary Investigation Committee" : "Student Disciplinary Board"}. You will be told when a hearing is scheduled.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: parsed.data.case_id,
    });
  }

  await logAuditEvent(staff.userId, "case_updated", "case_escalations", {
    case_id: parsed.data.case_id,
    escalated_to: parsed.data.escalated_to,
  });

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  revalidatePath("/staff/cases");
  return {
    ok: true,
    message: toCodi
      ? "Referred to CODI. The case is now confidential and has left the general queue."
      : `Referred to the ${parsed.data.escalated_to}.`,
  };
}

const outcomeSchema = z.object({
  escalation_id: z.string().uuid(),
  outcome: z.enum(["upheld", "dismissed", "referred_further", "sanction_recommended"]),
  outcome_notes: z.string().trim().max(2000).optional().or(z.literal("")),
  sanction_recommended: z.string().trim().max(500).optional().or(z.literal("")),
  external_reference: z.string().trim().max(80).optional().or(z.literal("")),
});

/**
 * Records what the committee decided, and moves the case accordingly.
 *
 * Committee members can file their own outcome — the RLS policy on
 * `case_escalations` already lets PIC and SDB members write — so a decision
 * doesn't have to be relayed through an OSA officer and lose detail on the way.
 */
export async function recordEscalationOutcome(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCommittee)) {
    return { error: "Only OSA staff and committee members can record an outcome." };
  }

  const parsed = outcomeSchema.safeParse({
    escalation_id: formData.get("escalation_id"),
    outcome: formData.get("outcome"),
    outcome_notes: formData.get("outcome_notes") ?? "",
    sanction_recommended: formData.get("sanction_recommended") ?? "",
    external_reference: formData.get("external_reference") ?? "",
  });
  if (!parsed.success) return { error: "Invalid outcome." };

  if (parsed.data.outcome === "sanction_recommended" && !parsed.data.sanction_recommended) {
    return { error: "Name the sanction the committee recommended." };
  }

  const db = loose(createAdminClient());

  const { data: escalationRow } = await db
    .from("case_escalations")
    .select("id, case_id, escalated_to, violation_cases(case_number, status, students(user_id))")
    .eq("id", parsed.data.escalation_id)
    .maybeSingle();

  const escalation = escalationRow as {
    id: string;
    case_id: string;
    escalated_to: string;
    violation_cases: {
      case_number: string;
      status: CaseStatus;
      students: { user_id: string } | null;
    } | null;
  } | null;
  if (!escalation) return { error: "Escalation not found." };

  const now = new Date().toISOString();
  const { error } = await db
    .from("case_escalations")
    .update({
      outcome: parsed.data.outcome,
      outcome_notes: parsed.data.outcome_notes
        ? sanitizeText(parsed.data.outcome_notes, 2000)
        : null,
      sanction_recommended: parsed.data.sanction_recommended || null,
      external_reference: parsed.data.external_reference || null,
      decided_at: now,
    })
    .eq("id", parsed.data.escalation_id);

  if (error) return { error: "Could not save the outcome." };

  // Only two outcomes move the case by themselves. "Upheld" and "referred
  // further" leave it where it is, because what happens next is another
  // committee's decision, not this one's.
  let toStatus: CaseStatus | null = null;
  const casePatch: Record<string, unknown> = {};

  if (parsed.data.outcome === "sanction_recommended") {
    toStatus = "sanctioned";
    casePatch.status = "sanctioned";
    casePatch.sanction_applied = parsed.data.sanction_recommended;
    casePatch.resolution_path = "pic_sdb";
  } else if (parsed.data.outcome === "dismissed") {
    toStatus = "dismissed";
    casePatch.status = "dismissed";
    casePatch.resolution_path = "dismissed";
    casePatch.closed_at = now;
  }

  if (toStatus) {
    await db.from("violation_cases").update(casePatch).eq("id", escalation.case_id);
  }

  await addTimelineEntry(db, {
    caseId: escalation.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType:
      parsed.data.outcome === "sanction_recommended"
        ? "sanction_applied"
        : parsed.data.outcome === "dismissed"
          ? "dismissed"
          : "escalated",
    summary: `${escalation.escalated_to} decision: ${parsed.data.outcome.replace(/_/g, " ")}.${
      parsed.data.sanction_recommended ? ` Sanction: ${parsed.data.sanction_recommended}.` : ""
    }${parsed.data.outcome_notes ? ` ${parsed.data.outcome_notes}` : ""}`,
    fromStatus: escalation.violation_cases?.status ?? null,
    toStatus,
  });

  if (toStatus && escalation.violation_cases?.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: escalation.violation_cases.students.user_id,
      p_type: "case_status",
      p_title:
        toStatus === "dismissed"
          ? "Your case was dismissed"
          : "A sanction has been recorded",
      p_body:
        toStatus === "dismissed"
          ? `The ${escalation.escalated_to} dismissed case ${escalation.violation_cases.case_number}. No sanction was applied.`
          : `The ${escalation.escalated_to} recommended: ${parsed.data.sanction_recommended}. See your violations page for the full record.`,
      p_priority: "high",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: escalation.case_id,
    });
  }

  await logAuditEvent(staff.userId, "case_updated", "case_escalations", {
    escalation_id: escalation.id,
    outcome: parsed.data.outcome,
  });

  revalidatePath(`/staff/cases/${escalation.case_id}`);
  revalidatePath("/staff/cases");
  return { ok: true, message: "Outcome recorded." };
}

const statusSchema = z.object({
  case_id: z.string().uuid(),
  status: z.enum(CASE_STATUSES),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

export async function updateCaseStatus(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can move a case." };

  const parsed = statusSchema.safeParse({
    case_id: formData.get("case_id"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Invalid status change." };

  const db = loose(createAdminClient());

  const { data: currentRow } = await db
    .from("violation_cases")
    .select("status, case_number, students(user_id)")
    .eq("id", parsed.data.case_id)
    .maybeSingle();

  const current = currentRow as {
    status: CaseStatus;
    case_number: string;
    students: { user_id: string } | null;
  } | null;
  const fromStatus = current?.status ?? null;

  const patch: Record<string, unknown> = { status: parsed.data.status };
  if (["closed", "dismissed"].includes(parsed.data.status)) {
    patch.closed_at = new Date().toISOString();
  }
  if (parsed.data.note) patch.resolution_notes = sanitizeText(parsed.data.note, 1000);

  const { error } = await db
    .from("violation_cases")
    .update(patch)
    .eq("id", parsed.data.case_id);

  if (error) return { error: "Could not update the case." };

  await addTimelineEntry(db, {
    caseId: parsed.data.case_id,
    actorId: staff.userId,
    actorLabel: staff.fullName,
    eventType: "status_changed",
    summary: parsed.data.note || `Status changed to ${parsed.data.status}.`,
    fromStatus,
    toStatus: parsed.data.status,
  });

  // Only the transitions that ask something of the student, or end the
  // matter, are worth a notification. Telling them about every internal
  // status change would train them to ignore the ones that matter.
  const STUDENT_FACING: Partial<Record<CaseStatus, { title: string; body: string }>> = {
    awaiting_apology: {
      title: "Write your apology letter",
      body: `Case ${current?.case_number ?? ""} closes once you submit a written apology and the OSA accepts it.`,
    },
    sanctioned: {
      title: "A sanction has been recorded",
      body: `A sanction was applied in case ${current?.case_number ?? ""}. Open your violations page for the details.`,
    },
    closed: {
      title: "Your case is closed",
      body: `Case ${current?.case_number ?? ""} has been closed. Nothing further is required from you.`,
    },
    dismissed: {
      title: "Your case was dismissed",
      body: `Case ${current?.case_number ?? ""} was dismissed. No sanction was applied.`,
    },
  };

  const announcement = STUDENT_FACING[parsed.data.status];
  if (announcement && current?.students?.user_id && fromStatus !== parsed.data.status) {
    await db.rpc("create_notification", {
      p_user_id: current.students.user_id,
      p_type: "case_status",
      p_title: announcement.title,
      p_body: announcement.body,
      p_priority: parsed.data.status === "awaiting_apology" ? "high" : "normal",
      p_channels: ["in_app", "email"],
      p_action_url: "/violations",
      p_action_label: "Open my violations",
      p_entity_type: "violation_case",
      p_entity_id: parsed.data.case_id,
    });
  }

  await logAuditEvent(staff.userId, "case_updated", "violation_cases", {
    case_id: parsed.data.case_id,
    to_status: parsed.data.status,
  });

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  revalidatePath("/staff/cases");
  return { ok: true, message: "Case updated." };
}
