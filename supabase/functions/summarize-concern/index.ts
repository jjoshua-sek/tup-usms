/**
 * Supabase Edge Function: AI Concern Summarizer
 *
 * Triggered by a Database Webhook on INSERT into the `concerns` table.
 * Uses Anthropic Claude API to generate:
 *   - A concise 2-3 sentence summary
 *   - Urgency level (low | medium | high | critical)
 *   - Suggested department for routing
 *   - Key issues array
 *
 * Security:
 *   - Rate limited: 10 summarizations per hour per student
 *   - Input sanitized: null bytes stripped, max 10,000 chars
 *   - Already-summarized records are skipped
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Rate limit: 10 summarizations per hour per student
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_HOURS = 1;

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: {
    id: string;
    student_id: string;
    category: string;
    subject_line: string;
    body_text: string;
    ai_summary: string | null;
  };
  old_record: null;
}

interface AISummaryResponse {
  summary: string;
  urgency: "low" | "medium" | "high" | "critical";
  suggested_department: string;
  key_issues: string[];
}

/**
 * Sanitize input text: remove null bytes, trim, enforce max length.
 */
function sanitizeInput(text: string, maxLength = 10000): string {
  return text.replace(/\0/g, "").trim().slice(0, maxLength);
}

Deno.serve(async (req) => {
  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload: WebhookPayload = await req.json();

    // Validate this is an INSERT on concerns
    if (payload.type !== "INSERT" || payload.table !== "concerns") {
      return new Response(
        JSON.stringify({ error: "Invalid webhook payload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const concern = payload.record;

    // Skip if already summarized
    if (concern.ai_summary) {
      return new Response(
        JSON.stringify({ message: "Already summarized, skipping" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Rate Limiting ──
    const windowStart = new Date();
    windowStart.setHours(windowStart.getHours() - RATE_LIMIT_WINDOW_HOURS);

    const { count } = await supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("student_id", concern.student_id)
      .gte("created_at", windowStart.toISOString());

    if (count && count > RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Max 10 concerns per hour.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Sanitize Input ──
    const sanitizedSubject = sanitizeInput(concern.subject_line, 200);
    const sanitizedBody = sanitizeInput(concern.body_text, 10000);

    // ── Call Anthropic API ──
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: `You are a student affairs AI assistant for the Technological University of the Philippines - Manila. Your job is to analyze student concerns and produce structured summaries for staff review.

Analyze the student concern and respond with a JSON object containing:
- "summary": A concise 2-3 sentence summary of the concern for faculty/staff to quickly understand the issue.
- "urgency": One of "low", "medium", "high", or "critical" based on severity and time-sensitivity.
  - "low": General inquiries, non-urgent requests
  - "medium": Academic issues, facility problems, financial questions
  - "high": Personal safety concerns, harassment, accessibility issues
  - "critical": Immediate safety threats, discrimination, urgent mental health
- "suggested_department": The most appropriate TUP-Manila department to handle this (e.g., "Registrar", "Student Affairs", "Guidance Office", "IT Department", "Finance", "College Dean", "Facilities Management")
- "key_issues": An array of 2-4 key issues/themes extracted from the concern.

Respond ONLY with the JSON object, no additional text.`,
          messages: [
            {
              role: "user",
              content: `Category: ${concern.category}\nSubject: ${sanitizedSubject}\n\nConcern:\n${sanitizedBody}`,
            },
          ],
        }),
      }
    );

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", errorText);
      return new Response(
        JSON.stringify({ error: "AI service unavailable" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const aiResult = await anthropicResponse.json();
    const aiText =
      aiResult.content?.[0]?.text || aiResult.content?.[0]?.value || "";

    // Parse the JSON response
    let parsed: AISummaryResponse;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse AI response:", aiText, parseError);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Update Concern Record ──
    const { error: updateError } = await supabase
      .from("concerns")
      .update({
        ai_summary: parsed.summary,
        urgency_level: parsed.urgency,
        suggested_dept: parsed.suggested_department,
      })
      .eq("id", concern.id);

    if (updateError) {
      console.error("Failed to update concern:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to save summary" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Audit Log ──
    await supabase.from("audit_logs").insert({
      user_id: concern.student_id, // The student who submitted
      action: "ai_summarize",
      resource: `concerns/${concern.id}`,
      details: JSON.stringify({
        urgency: parsed.urgency,
        suggested_dept: parsed.suggested_department,
        key_issues: parsed.key_issues,
      }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        summary: parsed.summary,
        urgency: parsed.urgency,
        suggested_department: parsed.suggested_department,
        key_issues: parsed.key_issues,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
