"use server";

import { randomUUID } from "crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import {
  findAvailableSlots,
  formatSlot,
  type AvailabilityBlock,
} from "@/lib/scheduling/find-slots";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose, type LooseClient } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";
import { CASE_STATUSES, type CaseStatus } from "@/types/osa";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Appends to the append-only case history. Never throws into the caller. */
async function addTimelineEntry(
  db: LooseClient,
  entry: {
    caseId: string;
    actorId: string | null;
    actorLabel: string;
    eventType: string;
    summary: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.from("case_timeline").insert({
    case_id: entry.caseId,
    actor_id: entry.actorId,
    actor_label: entry.actorLabel,
    event_type: entry.eventType,
    from_status: entry.fromStatus ?? null,
    to_status: entry.toStatus ?? null,
    summary: entry.summary,
    details: entry.details ?? null,
  });
}

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
    .select("status")
    .eq("id", parsed.data.case_id)
    .maybeSingle();
  const fromStatus = (currentRow as { status: CaseStatus } | null)?.status ?? null;

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

  await logAuditEvent(staff.userId, "case_updated", "violation_cases", {
    case_id: parsed.data.case_id,
    to_status: parsed.data.status,
  });

  revalidatePath(`/staff/cases/${parsed.data.case_id}`);
  revalidatePath("/staff/cases");
  return { ok: true, message: "Case updated." };
}
