"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaffContext } from "@/lib/osa/staff-context";
import { featuresToInputs, loadActiveRiskModel, loadRiskFeatures } from "@/lib/risk/load";
import { scoreStudent } from "@/lib/risk/score";
import { createAdminClient } from "@/lib/supabase/admin";
import { loose } from "@/lib/supabase/loose";
import { logAuditEvent } from "@/lib/utils/audit";
import { sanitizeText } from "@/lib/utils/sanitize";

interface Result {
  ok?: boolean;
  message?: string;
  error?: string;
}

const interventionSchema = z.object({
  student_id: z.string().uuid(),
  intervention_type: z.string().trim().min(2).max(80),
  rationale: z.string().trim().max(1000).optional().or(z.literal("")),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

/**
 * Turns a risk signal into an actual piece of outreach.
 *
 * The score is recomputed here rather than trusted from the form, and the
 * assessment that justified the intervention is written alongside it. That
 * pairing is the point: an intervention record that says "flagged high risk"
 * without the feature values behind it is not reviewable, and a model that
 * nobody can audit has no business touching a student's file.
 */
export async function createInterventionFromRisk(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCounselor)) {
    return { error: "Only OSA staff and guidance counselors can open an intervention." };
  }

  const parsed = interventionSchema.safeParse({
    student_id: formData.get("student_id"),
    intervention_type: formData.get("intervention_type"),
    rationale: formData.get("rationale") ?? "",
    priority: formData.get("priority") ?? "normal",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the intervention details." };
  }

  const db = loose(createAdminClient());

  const model = await loadActiveRiskModel(db);
  const [features] = await loadRiskFeatures(db, { studentId: parsed.data.student_id, limit: 1 });

  let assessmentId: string | null = null;

  if (model && features) {
    const assessment = scoreStudent(featuresToInputs(features), model);

    // The demote trigger from 00011 flips any previous row to is_current = false.
    const { data: inserted } = await db
      .from("risk_assessments")
      .insert({
        student_id: parsed.data.student_id,
        model_version_id: model.id,
        risk_score: assessment.risk_score,
        risk_tier: assessment.risk_tier,
        feature_values: assessment.normalizedFeatures,
        feature_contributions: Object.fromEntries(
          assessment.contributions.map((contribution) => [
            contribution.feature,
            contribution.contribution,
          ]),
        ),
        top_risk_factors: assessment.topRiskFactors.map((factor) => ({
          feature: factor.feature,
          label: factor.label,
          raw_value: factor.rawValue,
          contribution: factor.contribution,
          explanation: factor.explanation,
        })),
        protective_factors: assessment.protectiveFactors.map((factor) => ({
          feature: factor.feature,
          label: factor.label,
          contribution: factor.contribution,
        })),
        data_completeness: assessment.dataCompleteness,
        is_current: true,
        trigger_reason: "staff_intervention",
      })
      .select("id")
      .maybeSingle();

    assessmentId = (inserted as { id: string } | null)?.id ?? null;
  }

  const { error } = await db.from("risk_interventions").insert({
    student_id: parsed.data.student_id,
    risk_assessment_id: assessmentId,
    intervention_type: parsed.data.intervention_type,
    rationale: parsed.data.rationale ? sanitizeText(parsed.data.rationale, 1000) : null,
    status: "recommended",
    priority: parsed.data.priority,
    created_by: staff.staffId,
  });

  if (error) return { error: "Could not create the intervention." };

  await logAuditEvent(staff.userId, "intervention_created", "risk_interventions", {
    student_id: parsed.data.student_id,
    intervention_type: parsed.data.intervention_type,
  });

  revalidatePath("/staff/risk");
  revalidatePath("/staff/interventions");
  return { ok: true, message: "Intervention opened." };
}

const updateSchema = z.object({
  intervention_id: z.string().uuid(),
  status: z.enum([
    "recommended",
    "approved",
    "scheduled",
    "in_progress",
    "completed",
    "declined",
    "cancelled",
  ]),
  outcome: z.string().trim().max(1000).optional().or(z.literal("")),
  outcome_rating: z
    .enum(["improved", "no_change", "worsened", "inconclusive"])
    .optional()
    .or(z.literal("")),
});

export async function updateIntervention(formData: FormData): Promise<Result> {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && !staff.isCounselor)) {
    return { error: "You don't have permission to update interventions." };
  }

  const parsed = updateSchema.safeParse({
    intervention_id: formData.get("intervention_id"),
    status: formData.get("status"),
    outcome: formData.get("outcome") ?? "",
    outcome_rating: formData.get("outcome_rating") ?? "",
  });
  if (!parsed.success) return { error: "Invalid update." };

  const patch: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.outcome) patch.outcome = sanitizeText(parsed.data.outcome, 1000);
  if (parsed.data.outcome_rating) patch.outcome_rating = parsed.data.outcome_rating;
  if (parsed.data.status === "completed") patch.completed_at = new Date().toISOString();

  const { error } = await loose(createAdminClient())
    .from("risk_interventions")
    .update(patch)
    .eq("id", parsed.data.intervention_id);

  if (error) return { error: "Could not update the intervention." };

  revalidatePath("/staff/interventions");
  return { ok: true, message: "Updated." };
}
