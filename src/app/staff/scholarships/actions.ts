"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

const updateSchema = z.object({
  application_id: z.string().uuid(),
  status: z.enum([
    "interest_declared",
    "documents_pending",
    "documents_complete",
    "under_review",
    "endorsed",
    "forwarded",
    "awarded",
    "rejected",
    "withdrawn",
  ]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

/**
 * Moves a scholarship application along the OSA's side of the process.
 *
 * "Endorsed" and "forwarded" are the honest end of what this system does: the
 * OSA endorses a student and forwards the papers to the sponsor. The award
 * itself is the sponsor's decision, recorded here after the fact.
 */
export async function updateScholarshipApplication(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff?.isOsa) return { error: "Only OSA staff can update applications." };

  const parsed = updateSchema.safeParse({
    application_id: formData.get("application_id"),
    status: formData.get("status"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Invalid update." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: parsed.data.status };

  if (parsed.data.status === "endorsed") {
    patch.endorsed_by = staff.staffId;
    patch.endorsed_at = now;
    if (parsed.data.note) patch.endorsement_notes = sanitizeText(parsed.data.note, 500);
  } else if (parsed.data.status === "rejected") {
    patch.rejection_reason = parsed.data.note
      ? sanitizeText(parsed.data.note, 500)
      : "Not endorsed by the OSA.";
  } else if (parsed.data.note) {
    patch.endorsement_notes = sanitizeText(parsed.data.note, 500);
  }

  const db = loose(createAdminClient());
  const { error } = await db
    .from("scholarship_applications")
    .update(patch)
    .eq("id", parsed.data.application_id);

  if (error) return { error: "Could not update the application." };

  const { data: applicationRow } = await db
    .from("scholarship_applications")
    .select("students(user_id), scholarships(name)")
    .eq("id", parsed.data.application_id)
    .maybeSingle();

  const application = applicationRow as {
    students: { user_id: string } | null;
    scholarships: { name: string } | null;
  } | null;

  if (application?.students?.user_id) {
    await db.rpc("create_notification", {
      p_user_id: application.students.user_id,
      p_type: "scholarship_update",
      p_title: `Scholarship update: ${parsed.data.status.replace(/_/g, " ")}`,
      p_body: `${application.scholarships?.name ?? "Your scholarship application"} is now ${parsed.data.status.replace(/_/g, " ")}.${parsed.data.note ? ` ${parsed.data.note}` : ""}`,
      p_priority: "normal",
      p_channels: ["in_app"],
      p_action_url: "/scholarships",
      p_action_label: "View scholarships",
      p_entity_type: "scholarship_application",
      p_entity_id: parsed.data.application_id,
    });
  }

  revalidatePath("/staff/scholarships");
  return { ok: true, message: "Updated." };
}
