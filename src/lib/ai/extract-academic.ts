import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ExtractedAcademicData } from "@/types/osa";

/**
 * Reads a Certificate of Registration or rating slip with Claude and returns
 * the figures as structured data.
 *
 * Design notes:
 *
 * - **Extraction proposes; a human disposes.** Nothing this module returns
 *   reaches `academic_snapshots` on its own. It pre-fills the OSA
 *   verification form so an officer confirms figures instead of typing them
 *   — which is the difference between "AI read the grades" and "AI decided
 *   the grades".
 * - **Structured output, not prose parsing.** `output_config.format` with a
 *   JSON Schema constrains the model's output server-side, so there is no
 *   regex-scraping of a chatty reply. The result is validated again locally
 *   with Zod, because a schema-valid document can still be semantically
 *   wrong (a GWA of 6.5, a negative unit count).
 * - **Confidence is reported, not assumed.** The model returns per-field
 *   confidence and an overall figure; low confidence surfaces as a warning
 *   on the review screen rather than being silently accepted.
 */

/** Philippine grading scale runs 1.00 (best) to 5.00 (failed). */
const subjectSchema = z.object({
  subject_code: z.string().max(40).optional(),
  description: z.string().max(200).optional(),
  units: z.number().min(0).max(30).optional(),
  grade: z.union([z.number(), z.string().max(20)]).optional(),
  schedule: z
    .array(
      z.object({
        day_of_week: z.string().max(20).optional(),
        start_time: z.string().max(10).optional(),
        end_time: z.string().max(10).optional(),
        room: z.string().max(40).optional(),
      }),
    )
    .optional(),
});

const extractionSchema = z.object({
  student_number: z.string().max(30).nullable().optional(),
  student_name: z.string().max(120).nullable().optional(),
  school_year: z.string().max(20).nullable().optional(),
  semester: z.string().max(30).nullable().optional(),
  program: z.string().max(120).nullable().optional(),
  year_level: z.string().max(30).nullable().optional(),
  gwa: z.number().min(1).max(5).nullable().optional(),
  units_enrolled: z.number().min(0).max(60).nullable().optional(),
  units_passed: z.number().min(0).max(60).nullable().optional(),
  units_failed: z.number().min(0).max(60).nullable().optional(),
  scholastic_status: z.string().max(60).nullable().optional(),
  subjects: z.array(subjectSchema).max(40).optional(),
  field_confidence: z.record(z.string(), z.number().min(0).max(1)).optional(),
  overall_confidence: z.number().min(0).max(1),
  /** The model's own account of anything it could not read. */
  notes: z.string().max(500).nullable().optional(),
});

/**
 * JSON Schema sent to the API. Written by hand rather than generated from the
 * Zod schema: the SDK's zod helper tracks a specific Zod major version, and
 * this project is on Zod 4 for form validation. Keeping the wire schema
 * explicit means an upgrade on either side can't silently change what the
 * model is asked to produce.
 */
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    student_number: { type: ["string", "null"] },
    student_name: { type: ["string", "null"] },
    school_year: {
      type: ["string", "null"],
      description: "Formatted as 2026-2027.",
    },
    semester: {
      type: ["string", "null"],
      description: "One of: 1st Semester, 2nd Semester, Summer.",
    },
    program: { type: ["string", "null"] },
    year_level: { type: ["string", "null"] },
    gwa: {
      type: ["number", "null"],
      description:
        "General weighted average on the Philippine scale where 1.00 is highest and 5.00 is failed. Null on a Certificate of Registration, which has no grades.",
    },
    units_enrolled: { type: ["number", "null"] },
    units_passed: { type: ["number", "null"] },
    units_failed: { type: ["number", "null"] },
    scholastic_status: {
      type: ["string", "null"],
      description: "e.g. Regular, Probationary, Warning — only if printed.",
    },
    subjects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject_code: { type: "string" },
          description: { type: "string" },
          units: { type: "number" },
          grade: { type: ["number", "string"] },
          schedule: {
            type: "array",
            description:
              "Class meeting times, present on a Certificate of Registration.",
            items: {
              type: "object",
              properties: {
                day_of_week: {
                  type: "string",
                  description:
                    "A single day spelled in full: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. Split codes like TTh or MWF into separate entries.",
                },
                start_time: { type: "string", description: "24-hour HH:MM." },
                end_time: { type: "string", description: "24-hour HH:MM." },
                room: { type: "string" },
              },
              required: ["day_of_week", "start_time", "end_time"],
              additionalProperties: false,
            },
          },
        },
        required: ["subject_code"],
        additionalProperties: false,
      },
    },
    field_confidence: {
      type: "object",
      description:
        "Per-field confidence between 0 and 1, keyed by the field names above.",
      additionalProperties: { type: "number" },
    },
    overall_confidence: {
      type: "number",
      description:
        "0 to 1. Be honest: a blurry photo or a form you don't recognise should score low.",
    },
    notes: {
      type: ["string", "null"],
      description: "Anything unreadable or ambiguous, in one short sentence.",
    },
  },
  required: ["overall_confidence"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You read Philippine university academic documents from the Technological University of the Philippines and return their figures as data.

Two document types:
- Certificate of Registration (COR): issued at enrolment. Lists enrolled subjects, units, and class schedules. It has NO grades — leave gwa, units_passed and units_failed null.
- Rating slip: issued after a term. Lists subjects with final grades and usually a general weighted average.

Rules:
- Transcribe only what is printed. Never infer, average, or reconstruct a figure that is not on the page.
- Philippine grades run 1.00 (highest) to 5.00 (failed). 4.00 is conditional, 5.00 is failed. INC and DRP are strings, not numbers.
- Leave a field null when you cannot read it. A null is useful; a guess is not.
- Split combined day codes (MWF, TTh, MW) into one schedule entry per day.
- Report honest confidence. A photo at an angle, a crease through a row, or a form you do not recognise should lower it.`;

export type AcademicExtraction = z.infer<typeof extractionSchema>;

export interface ExtractionResult {
  data: ExtractedAcademicData;
  confidence: number;
  model: string;
  notes: string | null;
}

export type ExtractionOutcome =
  | ({ ok: true } & ExtractionResult)
  | { ok: false; error: string };

/** Image types the bucket accepts, and the only ones the API takes here. */
type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

export async function extractAcademicDocument(input: {
  base64: string;
  mediaType: string;
  documentType: "certificate_of_registration" | "rating_slip" | "transcript";
}): Promise<ExtractionOutcome> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "AI extraction is not configured on this server." };
  }

  const client = new Anthropic();
  const model = "claude-opus-5";

  const documentBlock: Anthropic.ContentBlockParam =
    input.mediaType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: input.base64 },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: input.mediaType as SupportedImageType,
            data: input.base64,
          },
        };

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      // Transcription, not analysis: medium effort reads the page carefully
      // without spending Opus-level reasoning on a table of numbers.
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: OUTPUT_JSON_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            documentBlock,
            {
              type: "text",
              text: `This is a ${input.documentType.replace(/_/g, " ")}. Read it and return the figures.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to read this document." };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text.trim()) {
      return { ok: false, error: "The model returned nothing for this document." };
    }

    // Schema-valid JSON can still be nonsense (a GWA of 6, 90 units), so the
    // local validation is a second, independent gate.
    const parsed = extractionSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return {
        ok: false,
        error: `The extracted figures failed validation: ${parsed.error.issues[0]?.message ?? "unknown field"}.`,
      };
    }

    return {
      ok: true,
      data: toExtractedAcademicData(parsed.data),
      confidence: parsed.data.overall_confidence,
      model,
      notes: parsed.data.notes ?? null,
    };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "The AI service is busy. Try again in a moment." };
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The AI service rejected this server's credentials." };
    }
    if (error instanceof Anthropic.APIError) {
      console.error("[extract-academic] API error", error.status, error.message);
      return { ok: false, error: "The AI service could not read this document." };
    }
    console.error("[extract-academic] failed", error);
    return { ok: false, error: "Extraction failed. The document can still be verified by hand." };
  }
}

/** Drops nulls so the stored JSON matches the ExtractedAcademicData shape. */
function toExtractedAcademicData(raw: AcademicExtraction): ExtractedAcademicData {
  const clean = <T>(value: T | null | undefined): T | undefined =>
    value === null ? undefined : value;

  return {
    student_number: clean(raw.student_number),
    student_name: clean(raw.student_name),
    school_year: clean(raw.school_year),
    semester: clean(raw.semester),
    program: clean(raw.program),
    year_level: clean(raw.year_level),
    gwa: clean(raw.gwa),
    units_enrolled: clean(raw.units_enrolled),
    units_passed: clean(raw.units_passed),
    units_failed: clean(raw.units_failed),
    scholastic_status: clean(raw.scholastic_status),
    subjects: raw.subjects,
    field_confidence: raw.field_confidence,
  };
}
