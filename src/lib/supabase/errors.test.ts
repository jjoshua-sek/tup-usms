import { describe, expect, it } from "vitest";

import { isMissingFunction } from "@/lib/supabase/errors";

/**
 * The two payloads below were recorded from production on 2026-09-30, by
 * anon-key GETs to /rest/v1/rpc after migration 00025 revoked anon. They are
 * what a missing function and a missing grant actually look like, and both
 * messages contain "claim_concern_summaries".
 */

const NOT_FOUND = {
  code: "PGRST202",
  details:
    "Searched for the function public.claim_concern_summaries_does_not_exist with parameter p_limit, but no matches were found in the schema cache.",
  hint: "Perhaps you meant to call the function public.claim_concern_summaries",
  message: "Could not find the function public.claim_concern_summaries_does_not_exist(p_limit) in the schema cache",
};

const PERMISSION_DENIED = {
  code: "42501",
  details: null,
  hint: null,
  message: "permission denied for function claim_concern_summaries",
};

describe("isMissingFunction", () => {
  it("is true when PostgREST cannot find the function", () => {
    expect(isMissingFunction(NOT_FOUND)).toBe(true);
  });

  it("is true when Postgres itself reports the function undefined", () => {
    expect(
      isMissingFunction({ code: "42883", message: "function public.claim_concern_summaries(integer) does not exist" }),
    ).toBe(true);
  });

  it("is false for permission denied, although the message names the function", () => {
    expect(PERMISSION_DENIED.message).toMatch(/claim_concern_summaries/);
    expect(isMissingFunction(PERMISSION_DENIED)).toBe(false);
  });

  it("is false for an error without a code, and for no error", () => {
    expect(isMissingFunction(new TypeError("fetch failed"))).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
    expect(isMissingFunction(undefined)).toBe(false);
  });
});
