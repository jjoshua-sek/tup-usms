import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_VISION_MODEL,
  aiConfigured,
  aiModels,
  classifyGroqError,
  readGroqReply,
  strictSchemaProblems,
} from "./groq-core";

const groqError = (message: string, code?: string) =>
  JSON.stringify({ error: { message, type: "invalid_request_error", ...(code ? { code } : {}) } });

describe("aiModels", () => {
  it("uses the defaults unless the environment overrides them", () => {
    expect(aiModels({})).toEqual({ text: DEFAULT_TEXT_MODEL, vision: DEFAULT_VISION_MODEL });
    expect(aiModels({ GROQ_TEXT_MODEL: " openai/gpt-oss-20b ", GROQ_VISION_MODEL: "" })).toEqual({
      text: "openai/gpt-oss-20b",
      vision: DEFAULT_VISION_MODEL,
    });
  });

  it("is configured only with a non-blank key", () => {
    expect(aiConfigured({})).toBe(false);
    expect(aiConfigured({ GROQ_API_KEY: "  " })).toBe(false);
    expect(aiConfigured({ GROQ_API_KEY: "gsk_test" })).toBe(true);
  });
});

describe("classifyGroqError", () => {
  // A hold stops the whole queue and gives back the attempt: right for
  // problems every concern shares, wrong for a problem with one concern.
  it("holds the queue for account-wide problems", () => {
    expect(classifyGroqError(401, groqError("Invalid API Key"))).toMatchObject({ kind: "auth", hold: true });
    expect(classifyGroqError(429, groqError("Rate limit reached for tokens per day"))).toMatchObject({
      kind: "rate_limited",
      hold: true,
    });
    expect(
      classifyGroqError(404, groqError("The model `llama-x` does not exist or you do not have access to it.")),
    ).toMatchObject({ kind: "model_unavailable", hold: true });
    expect(
      classifyGroqError(400, groqError("The model `llama-x` has been decommissioned.", "model_decommissioned")),
    ).toMatchObject({ kind: "model_unavailable", hold: true });
  });

  it("retries a malformed answer but not an input that can never fit", () => {
    expect(
      classifyGroqError(400, groqError("Failed to generate JSON. Please adjust your prompt.", "json_validate_failed")),
    ).toMatchObject({ kind: "invalid_output", hold: false, retryable: true });
    expect(classifyGroqError(413, groqError("Request too large"))).toMatchObject({ kind: "too_large", retryable: false });
    expect(
      classifyGroqError(400, groqError("Please reduce the length of the messages or completion.")),
    ).toMatchObject({ kind: "too_large", retryable: false });
  });

  it("treats a model without structured output as a request problem", () => {
    expect(
      classifyGroqError(400, groqError("response_format `json_schema` is not supported with this model")),
    ).toMatchObject({ kind: "bad_request", retryable: false });
  });

  it("retries the service's own outages", () => {
    for (const status of [498, 500, 502, 503]) {
      expect(classifyGroqError(status, "")).toMatchObject({ kind: "unavailable", retryable: true, hold: false });
    }
  });
});

describe("readGroqReply", () => {
  it("returns the message text and the model that answered", () => {
    expect(
      readGroqReply({ model: "openai/gpt-oss-120b", choices: [{ finish_reason: "stop", message: { content: ' {"a":1} ' } }] }),
    ).toEqual({ ok: true, text: '{"a":1}', model: "openai/gpt-oss-120b" });
  });

  it("reports a cut-off or empty reply", () => {
    expect(readGroqReply({ choices: [{ finish_reason: "length", message: { content: '{"a":' } }] })).toMatchObject({
      ok: false,
      failure: { kind: "truncated" },
    });
    expect(readGroqReply({ choices: [] })).toMatchObject({ ok: false, failure: { kind: "invalid_output" } });
    expect(readGroqReply(null)).toMatchObject({ ok: false });
  });
});

describe("strictSchemaProblems", () => {
  it("finds optional properties and open objects, however deep", () => {
    expect(
      strictSchemaProblems({
        type: "object",
        additionalProperties: false,
        required: ["a"],
        properties: {
          a: { type: "string" },
          b: { type: "array", items: { type: "object", properties: { c: { type: "number" } } } },
        },
      }),
    ).toEqual(["$.b: not in required", "$.b[]: additionalProperties must be false", "$.b[].c: not in required"]);
  });
});
