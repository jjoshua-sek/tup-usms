/* eslint-disable @typescript-eslint/no-explicit-any -- see the note below */

/**
 * Escape hatch for tables that aren't in the hand-maintained `Database` type.
 *
 * `src/types/database.ts` is written by hand, so every table added by a newer
 * migration (the whole OSA and access-control surface) is unknown to the
 * generic client — and `supabase.from("access_events")` narrows to `never`,
 * which makes even a correct query fail to compile.
 *
 * Casting at each call site scattered `any` through a dozen files. Keeping the
 * cast here means exactly one place is untyped, and the moment the generated
 * types are refreshed —
 *
 *   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
 *
 * — these call sites can drop `loose()` and get real type checking back.
 */

export interface LooseClient {
  from: (table: string) => any;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: any; error: unknown }>;
}

export function loose(client: unknown): LooseClient {
  return client as LooseClient;
}
