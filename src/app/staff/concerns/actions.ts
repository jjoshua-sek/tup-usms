"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";
import { CONCERN_STATUSES } from "@/lib/validations/concern";
import { sanitizeText } from "@/lib/utils/sanitize";

interface ActionResult {
  success?: boolean;
  error?: string;
}

/**
 * Update the status of a concern (staff only).
 *
 * RLS already restricts UPDATE on concerns to staff/admin roles, so
 * the client-side staff layout gate + this RLS policy form a defense-in-depth pair.
 *
 * Audit logged for accountability — every status change is traceable to a user.
 */
export async function updateConcernStatus(
  concernId: string,
  newStatus: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  // Validate status against the allowed enum
  if (!(CONCERN_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "Invalid status value." };
  }

  // Look up which staff member is doing the update
  const { data: staffRaw } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const staff = staffRaw as { id: string } | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
  const updatePayload: Record<string, any> = { status: newStatus };
  // Auto-assign on transition to in_review if no one is assigned yet
  if (newStatus === "in_review" && staff) {
    updatePayload.assigned_to = staff.id;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("concerns")
    .update(updatePayload)
    .eq("id", concernId);

  if (error) {
    console.error("Status update failed:", error);
    return { error: "Failed to update status." };
  }

  await logAuditEvent(
    user.id,
    "concern_respond",
    `concerns/${concernId}`,
    { newStatus, byStaffId: staff?.id }
  );

  // Revalidate both staff and student views
  revalidatePath(`/staff/concerns/${concernId}`);
  revalidatePath("/staff/concerns");
  revalidatePath(`/concerns/${concernId}`);
  revalidatePath("/concerns");

  return { success: true };
}

/**
 * Manually trigger AI re-summarization. Useful if the database webhook missed
 * the original event, or if staff wants the AI to re-evaluate after edits.
 *
 * Calls Anthropic Claude directly server-side — no API route round-trip.
 */
export async function resummarizeConcern(
  concernId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not authenticated." };
  }

  // Fetch the concern (RLS allows staff to read all concerns)
  const { data: concernRaw, error: fetchErr } = await supabase
    .from("concerns")
    .select("id, category, subject_line, body_text")
    .eq("id", concernId)
    .maybeSingle();

  const concern = concernRaw as {
    id: string;
    category: string;
    subject_line: string;
    body_text: string;
  } | null;

  if (fetchErr || !concern) {
    return { error: "Concern not found." };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Anthropic API key not configured." };
  }

  try {
    const sanitizedSubject = sanitizeText(concern.subject_line, 200);
    const sanitizedBody = sanitizeText(concern.body_text, 10000);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: `You are a student affairs AI assistant for TUP-Manila. Analyze the student concern and respond with a JSON object containing:
- "summary": 2-3 sentence summary for staff
- "urgency": "low" | "medium" | "high" | "critical"
- "suggested_department": appropriate TUP department
- "key_issues": array of 2-4 key themes
Respond ONLY with the JSON object, no other text.`,
        messages: [
          {
            role: "user",
            content: `Category: ${concern.category}\nSubject: ${sanitizedSubject}\n\nConcern:\n${sanitizedBody}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("Anthropic API error:", await response.text());
      return { error: "AI service unavailable." };
    }

    const aiResult = await response.json();
    const aiText = aiResult.content?.[0]?.text || "";
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return { error: "Could not parse AI response." };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase types regenerated separately
    const { error: updateErr } = await (supabase as any)
      .from("concerns")
      .update({
        ai_summary: parsed.summary,
        urgency_level: parsed.urgency,
        suggested_dept: parsed.suggested_department,
      })
      .eq("id", concernId);

    if (updateErr) {
      console.error("Update after re-summarize failed:", updateErr);
      return { error: "Failed to save AI summary." };
    }

    await logAuditEvent(user.id, "concern_respond", `concerns/${concernId}`, {
      action: "manual_resummarize",
      urgency: parsed.urgency,
    });

    revalidatePath(`/staff/concerns/${concernId}`);
    revalidatePath(`/concerns/${concernId}`);
    return { success: true };
  } catch (e) {
    console.error("Resummarize error:", e);
    return { error: "Failed to call AI service." };
  }
}
