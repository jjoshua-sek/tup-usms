import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { sanitizeText } from "@/lib/utils/sanitize";
import type { Concern } from "@/types/database";

/**
 * Manual AI summarization endpoint.
 * Alternative to the Supabase webhook — can be called manually
 * if the webhook fails or for re-summarization.
 *
 * POST /api/concerns/summarize
 * Body: { concern_id: string }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { concern_id } = await request.json();

    if (!concern_id) {
      return NextResponse.json(
        { error: "concern_id is required" },
        { status: 400 }
      );
    }

    // Rate limit: 10 summarizations per hour
    const limit = checkRateLimit({
      identifier: `summarize:${user.id}`,
      maxRequests: 10,
      windowSeconds: 3600,
    });

    if (!limit.success) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    // Fetch the concern (RLS will enforce access)
    const { data, error: fetchError } = await supabase
      .from("concerns")
      .select("*")
      .eq("id", concern_id)
      .single();

    if (fetchError || !data) {
      return NextResponse.json(
        { error: "Concern not found" },
        { status: 404 }
      );
    }

    const concern = data as unknown as Concern;

    // Call the Anthropic API
    const sanitizedBody = sanitizeText(concern.body_text);
    const sanitizedSubject = sanitizeText(concern.subject_line, 200);

    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: `You are a student affairs AI assistant for TUP-Manila. Analyze the student concern and respond with a JSON object:
- "summary": 2-3 sentence summary for staff
- "urgency": "low" | "medium" | "high" | "critical"
- "suggested_department": appropriate TUP department
- "key_issues": array of 2-4 key themes
Respond ONLY with JSON.`,
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
      return NextResponse.json(
        { error: "AI service unavailable" },
        { status: 502 }
      );
    }

    const aiResult = await anthropicResponse.json();
    const aiText = aiResult.content?.[0]?.text || "";
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Update the concern
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Types will be auto-generated from Supabase
    const { error: updateError } = await (supabase as any)
      .from("concerns")
      .update({
        ai_summary: parsed.summary,
        urgency_level: parsed.urgency,
        suggested_dept: parsed.suggested_department,
      })
      .eq("id", concern_id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save summary" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      summary: parsed.summary,
      urgency: parsed.urgency,
      suggested_department: parsed.suggested_department,
      key_issues: parsed.key_issues,
    });
  } catch (error) {
    console.error("Summarize error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
