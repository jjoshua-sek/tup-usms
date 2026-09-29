/**
 * Whether a failed RPC means the function does not exist — the migration
 * that creates it has not been run — rather than any other failure.
 *
 * Decided by code, never by message: "permission denied for function
 * claim_concern_summaries" names the function just as a missing one does.
 * Matching the name would read a revoked grant as "migration 00023 has not
 * been run", send staff to re-run a migration already in place, and keep the
 * real error out of the log.
 */
export function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  // PGRST202: PostgREST has no such function in its schema cache.
  // 42883:    undefined_function — a stale cache let the call reach Postgres.
  return code === "PGRST202" || code === "42883";
}
