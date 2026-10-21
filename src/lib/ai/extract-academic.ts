import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import type { ExtractedAcademicData } from "@/types/osa";

import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  buildPdfTextPrompt,
  documentLabel,
  hasUsableText,
  parseExtraction,
  toExtractedAcademicData,
  unitsAddUp,
  unitsRecheckHint,
  type AcademicDocumentType,
} from "./academic-extraction";
import { aiModels } from "./groq-core";
import { groqJson, type ChatContent, type GroqJsonResult } from "./groq";

/**
 * Reads a Certificate of Registration or rating slip with Groq.
 *
 * Groq's models cannot open a PDF, so the two kinds of upload take
 * different roads:
 *
 *   photo (JPG, PNG, WebP)  the vision model looks at the image
 *   PDF                     its text layer is pulled out here (unpdf) and
 *                           the text model reads that. A scanned PDF has no
 *                           text layer; the student is asked for a photo,
 *                           and staff can still verify it by hand.
 *
 * The rules, schema and checks are in academic-extraction.ts.
 */

export interface ExtractionResult {
  data: ExtractedAcademicData;
  confidence: number;
  model: string;
  notes: string | null;
}

export type ExtractionOutcome = ({ ok: true } & ExtractionResult) | { ok: false; error: string };

/** Groq takes base64 images up to about 4 MB; larger photos go by signed link. */
const MAX_INLINE_IMAGE_BYTES = 3.5 * 1024 * 1024;
/** Keeps a PDF's text inside the free plan's per-minute token budget. */
const MAX_PDF_TEXT_CHARS = 9000;

export async function extractAcademicDocument(input: {
  bytes: Uint8Array;
  mediaType: string;
  documentType: AcademicDocumentType;
  /** A short-lived link to the same file, used when it is too big to send inline. */
  signedUrl?: () => Promise<string | null>;
}): Promise<ExtractionOutcome> {
  const models = aiModels();
  /** One reading; `hint` is added to the request when asking again. */
  let ask: (hint?: string) => Promise<GroqJsonResult>;

  if (input.mediaType === "application/pdf") {
    const text = await pdfText(input.bytes);
    if (text === null) return { ok: false, error: "The PDF could not be opened. Staff can still verify it by hand." };
    if (!hasUsableText(text)) {
      return {
        ok: false,
        error: "This PDF is a scan with no readable text. Upload a photo (JPG or PNG) instead, or staff can verify it by hand.",
      };
    }
    const prompt = buildPdfTextPrompt(input.documentType, text.slice(0, MAX_PDF_TEXT_CHARS));
    ask = (hint) =>
      groqJson({
        model: models.text,
        system: EXTRACTION_SYSTEM_PROMPT,
        user: hint ? `${prompt}\n\n${hint}` : prompt,
        schema: { name: "academic_document", schema: EXTRACTION_JSON_SCHEMA },
        maxTokens: 3000,
      });
  } else {
    let imageUrl: string | null = null;
    if (input.bytes.byteLength <= MAX_INLINE_IMAGE_BYTES) {
      imageUrl = `data:${input.mediaType};base64,${Buffer.from(input.bytes).toString("base64")}`;
    } else {
      imageUrl = (await input.signedUrl?.()) ?? null;
    }
    if (!imageUrl) return { ok: false, error: "The photo is too large for the AI to read. Staff can verify it by hand." };

    const url = imageUrl;
    ask = async (hint) => {
      const user: ChatContent = [
        { type: "image_url", image_url: { url } },
        { type: "text", text: `This is a photo of a ${documentLabel(input.documentType)}. Read it and return the figures.${hint ? ` ${hint}` : ""}` },
      ];
      const first = await groqJson({
        model: models.vision,
        system: EXTRACTION_SYSTEM_PROMPT,
        user,
        schema: { name: "academic_document", schema: EXTRACTION_JSON_SCHEMA },
        maxTokens: 3000,
      });
      // If the vision model will not take a schema alongside an image, ask
      // for plain JSON with the schema spelled out; Zod still checks it.
      if (first.ok || first.failure.kind !== "bad_request") return first;
      return groqJson({
        model: models.vision,
        system: `${EXTRACTION_SYSTEM_PROMPT}\n\nReply with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(EXTRACTION_JSON_SCHEMA)}`,
        user,
        maxTokens: 3000,
      });
    };
  }

  let result = await ask();
  if (!result.ok) {
    return { ok: false, error: `${result.failure.message.replace(/^Waiting: /, "")} Staff can still verify it by hand.` };
  }

  let parsed = parseExtraction(result.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  // Units that do not add up are nearly always a misread row, so ask once
  // more, saying what is wrong. The second reading is kept only if it adds up.
  if (unitsAddUp(parsed.data) === false) {
    const again = await ask(unitsRecheckHint(parsed.data));
    const reparsed = again.ok ? parseExtraction(again.text) : null;
    if (again.ok && reparsed?.ok && unitsAddUp(reparsed.data) !== false) {
      result = again;
      parsed = reparsed;
    }
  }

  return {
    ok: true,
    data: toExtractedAcademicData(parsed.data),
    confidence: parsed.data.overall_confidence,
    model: result.model,
    notes: parsed.data.notes,
  };
}

/** Every page's text, or null when the file is not a readable PDF. */
async function pdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    // pdf.js takes ownership of the buffer it is given; hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    console.error("[extract-academic] could not read PDF text", error);
    return null;
  }
}
