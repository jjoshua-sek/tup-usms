"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { defaultTermExpiry, getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import type { IdValidationStatus } from "@/types/osa";

interface Result {
  ok?: boolean;
  error?: string;
}

const reviewSchema = z.object({
  validation_id: z.string().uuid(),
  decision: z.enum(["validate", "reject", "suspend", "revoke", "reinstate", "surrender"]),
  sticker_number: z.string().trim().max(40).optional().or(z.literal("")),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Status the decision moves the row to, and what the student is told. */
const DECISION_MAP: Record<
  string,
  { status: IdValidationStatus; title: string; body: string; needsReason: boolean }
> = {
  validate: {
    status: "validated",
    title: "Your ID is validated",
    body: "Your TUP ID is now valid for this term and will open the campus turnstiles.",
    needsReason: false,
  },
  reject: {
    status: "rejected",
    title: "ID validation needs attention",
    body: "The OSA could not validate your ID. Open your Digital ID page for the reason and next step.",
    needsReason: true,
  },
  suspend: {
    status: "suspended",
    title: "Campus access suspended",
    body: "Your ID has been suspended. Please report to the Office of Student Affairs.",
    needsReason: true,
  },
  revoke: {
    status: "revoked",
    title: "ID revoked",
    body: "Your ID has been revoked. Request a replacement card at the OSA.",
    needsReason: true,
  },
  reinstate: {
    status: "validated",
    title: "Campus access restored",
    body: "Your ID is valid again and will open the campus turnstiles.",
    needsReason: false,
  },
  // Handbook, Application for Clearance: the ID is handed in to the OSA before
  // credentials are released. It stops opening gates from that moment.
  surrender: {
    status: "surrendered",
    title: "Your ID has been received",
    body: "The OSA has received your university ID for clearance. It no longer opens the campus turnstiles.",
    needsReason: false,
  },
};

/**
 * OSA decision on an ID validation request.
 *
 * This is the switch the turnstiles read: `verifyScan` looks for a row with
 * status 'validated' for the current term, so validating here is what makes a
 * card open a gate, and suspending here is what stops it — within seconds,
 * with no kiosk to visit.
 *
 * Runs on the service-role client after an explicit role check because it
 * also writes a notification to the student's own user id.
 */
export async function reviewIdValidation(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can review ID validations." };

  const parsed = reviewSchema.safeParse({
    validation_id: formData.get("validation_id"),
    decision: formData.get("decision"),
    sticker_number: formData.get("sticker_number") ?? "",
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: "Invalid review." };

  const decision = DECISION_MAP[parsed.data.decision];
  if (decision.needsReason && !parsed.data.reason) {
    return { error: "Give the student a reason — they see this on their ID page." };
  }

  const db = loose(createAdminClient());
  const term = getCurrentTerm();
  const now = new Date();

  const { data: rowData } = await db
    .from("id_validations")
    .select("id, student_id, students(user_id, student_number)")
    .eq("id", parsed.data.validation_id)
    .maybeSingle();

  const row = rowData as {
    id: string;
    student_id: string;
    students: { user_id: string; student_number: string } | null;
  } | null;
  if (!row) return { error: "That validation record no longer exists." };

  const patch: Record<string, unknown> = {
    status: decision.status,
    rejection_reason: decision.needsReason ? parsed.data.reason : null,
  };

  if (decision.status === "validated") {
    patch.validated_by = staff.staffId;
    patch.validated_at = now.toISOString();
    patch.expires_at = defaultTermExpiry(term).toISOString();
    if (parsed.data.sticker_number) {
      patch.validation_sticker_number = parsed.data.sticker_number;
    }
  }

  const { error } = await db
    .from("id_validations")
    .update(patch)
    .eq("id", parsed.data.validation_id);

  if (error) return { error: "Could not save that decision." };

  if (row.students?.user_id) {
    await notifyStudent(db, row.students.user_id, decision, parsed.data.reason, parsed.data.validation_id);
  }

  await logAuditEvent(staff.userId, "id_validation_reviewed", "id_validations", {
    validation_id: parsed.data.validation_id,
    decision: parsed.data.decision,
    student_number: row.students?.student_number,
  });

  revalidateValidationPages();
  return { ok: true };
}

const counterSchema = z.object({
  student_id: z.string().uuid(),
  sticker_number: z.string().trim().max(40).optional().or(z.literal("")),
});

/**
 * Validates a student's ID for the current term at the OSA window, whether
 * or not they asked online first.
 *
 * The counter is where validation actually happens — the student is there
 * with the card, the officer checks the face against the photo on file and
 * applies the term sticker — so it must not depend on the student having
 * clicked "Request ID validation" beforehand. A request already open for
 * the term is completed; otherwise the term's record is created validated.
 *
 * A suspended, revoked or surrendered ID is refused here: lifting those is a
 * separate decision (Reinstate on the record), not a side effect of a
 * sticker.
 */
export async function validateAtCounter(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can validate IDs." };

  const parsed = counterSchema.safeParse({
    student_id: formData.get("student_id"),
    sticker_number: formData.get("sticker_number") ?? "",
  });
  if (!parsed.success) return { error: "Choose a student first." };

  const db = loose(createAdminClient());
  const term = getCurrentTerm();
  const now = new Date();

  const { data: studentData } = await db
    .from("students")
    .select("id, user_id, student_number, photo_url")
    .eq("id", parsed.data.student_id)
    .maybeSingle();
  const student = studentData as
    | { id: string; user_id: string; student_number: string; photo_url: string | null }
    | null;
  if (!student) return { error: "That student record no longer exists." };

  // The gate shows the guard this photo to match against the face; without
  // one, a validated card would open turnstiles for whoever holds it.
  if (!student.photo_url) {
    return { error: "This student has no profile photo yet. They need to add one before the ID can be validated." };
  }

  const validated = {
    status: "validated" as const,
    rejection_reason: null,
    validated_by: staff.staffId,
    validated_at: now.toISOString(),
    expires_at: defaultTermExpiry(term).toISOString(),
    ...(parsed.data.sticker_number ? { validation_sticker_number: parsed.data.sticker_number } : {}),
  };

  const { data: existingData } = await db
    .from("id_validations")
    .select("id, status")
    .eq("student_id", student.id)
    .eq("school_year", term.schoolYear)
    .eq("semester", term.semester)
    .maybeSingle();
  const existing = existingData as { id: string; status: IdValidationStatus } | null;

  let validationId: string;
  if (existing) {
    if (existing.status === "validated") return { error: "This ID is already validated for this term." };
    if (!COUNTER_CAN_VALIDATE.has(existing.status)) {
      return {
        error: "This ID is suspended, revoked or surrendered. Lift that first with Reinstate on the record below.",
      };
    }
    const { data: updated, error } = await db
      .from("id_validations")
      .update(validated)
      .eq("id", existing.id)
      .eq("status", existing.status)
      .select("id");
    if (error) return { error: "Could not save the validation." };
    if (((updated as unknown[] | null) ?? []).length === 0) {
      return { error: "This record changed a moment ago. Reload the page and try again." };
    }
    validationId = existing.id;
  } else {
    const { data: inserted, error } = await db
      .from("id_validations")
      .insert({
        student_id: student.id,
        school_year: term.schoolYear,
        semester: term.semester,
        submitted_at: now.toISOString(),
        ...validated,
      })
      .select("id")
      .single();
    if (error) {
      // 23505: the student's own request for this term arrived meanwhile.
      return {
        error:
          (error as { code?: string }).code === "23505"
            ? "A request for this term was just created. Reload the page and validate it from the record."
            : "Could not save the validation.",
      };
    }
    validationId = (inserted as { id: string }).id;
  }

  await notifyStudent(db, student.user_id, DECISION_MAP.validate, "", validationId);

  await logAuditEvent(staff.userId, "id_validation_reviewed", "id_validations", {
    validation_id: validationId,
    decision: "validate_at_counter",
    student_number: student.student_number,
    had_request: Boolean(existing),
  });

  revalidateValidationPages();
  return { ok: true };
}

/** A request open for the term, or one that lapsed or was turned down, can be completed at the counter. */
const COUNTER_CAN_VALIDATE = new Set<IdValidationStatus>(["pending", "under_review", "rejected", "expired"]);

/**
 * Requirement #4: tell the student through the portal and by email.
 * id_validation_status is optional mail, so the student's email settings
 * decide whether the copy is sent.
 */
async function notifyStudent(
  db: ReturnType<typeof loose>,
  userId: string,
  decision: (typeof DECISION_MAP)[string],
  reason: string | undefined,
  validationId: string,
) {
  const { error } = await db.rpc("create_notification", {
    p_user_id: userId,
    p_type: "id_validation_status",
    p_title: decision.title,
    p_body: reason ? `${decision.body} Reason: ${reason}` : decision.body,
    p_priority: decision.status === "validated" ? "normal" : "high",
    p_channels: ["in_app", "email"],
    p_action_url: "/id",
    p_action_label: "Open my Digital ID",
    p_entity_type: "id_validation",
    p_entity_id: validationId,
  });
  if (error) console.error("[id-validation] notification not created", validationId, error);
}

function revalidateValidationPages() {
  revalidatePath("/staff/id-validation");
  revalidatePath("/staff/gates");
  revalidatePath("/id");
}
