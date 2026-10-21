import "server-only";

import { aiModels } from "@/lib/ai/groq-core";
import { groqJson, type ChatContent, type GroqJsonResult } from "@/lib/ai/groq";

import { STAMPED_SCAN_JSON_SCHEMA, STAMPED_SCAN_SYSTEM_PROMPT, parseStampedScan, type StampedScan } from "./stamped-scan";

/**
 * Reads a counter photo of a stamped COR or rating slip with the vision
 * model: its rows, and whether the Registrar's and the OSA's stamps are on
 * it. The rules and the comparison are in stamped-scan.ts.
 */
export async function readStampedScan(input: {
  bytes: Uint8Array;
  mediaType: string;
  documentLabel: string;
}): Promise<{ ok: true; scan: StampedScan; model: string } | { ok: false; error: string }> {
  const model = aiModels().vision;
  const user: ChatContent = [
    { type: "image_url", image_url: { url: `data:${input.mediaType};base64,${Buffer.from(input.bytes).toString("base64")}` } },
    { type: "text", text: `This is a photo of the student's stamped ${input.documentLabel}, taken at the OSA counter. Read it and report the stamps.` },
  ];

  let result: GroqJsonResult = await groqJson({
    model,
    system: STAMPED_SCAN_SYSTEM_PROMPT,
    user,
    schema: { name: "stamped_document", schema: STAMPED_SCAN_JSON_SCHEMA },
    maxTokens: 2500,
  });
  // As with uploads: if the vision model will not take a schema alongside
  // an image, ask for plain JSON with the schema spelled out; Zod still checks it.
  if (!result.ok && result.failure.kind === "bad_request") {
    result = await groqJson({
      model,
      system: `${STAMPED_SCAN_SYSTEM_PROMPT}\n\nReply with one JSON object that matches this JSON Schema exactly:\n${JSON.stringify(STAMPED_SCAN_JSON_SCHEMA)}`,
      user,
      maxTokens: 2500,
    });
  }
  if (!result.ok) return { ok: false, error: result.failure.message.replace(/^Waiting: /, "") };

  const parsed = parseStampedScan(result.text);
  return parsed.ok ? { ok: true, scan: parsed.data, model: result.model } : { ok: false, error: parsed.error };
}
