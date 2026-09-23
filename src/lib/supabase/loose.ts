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

import type { NotificationType } from "@/lib/notifications/policy";

type RpcResult = Promise<{ data: any; error: unknown }>;

/**
 * Arguments to `create_notification` (migration 00012).
 *
 * Typed explicitly because loosening `rpc` once cost real money: thirteen of
 * fourteen call sites passed a `notification_type` the CHECK constraint
 * rejects, the discarded error hid it, and no student was ever notified of a
 * summons. `p_type` is the union rather than `string` so the next typo is a
 * compile error instead of a silent one.
 */
export interface CreateNotificationArgs {
  p_user_id: string;
  p_type: NotificationType;
  p_title: string;
  p_body: string;
  p_priority?: "low" | "normal" | "high" | "urgent";
  p_channels?: Array<"in_app" | "email">;
  p_action_url?: string;
  p_action_label?: string;
  p_entity_type?: string;
  p_entity_id?: string;
}

export interface LooseClient {
  from: (table: string) => any;
  /**
   * Overloaded so the notification helper keeps real type checking even
   * though everything else here is deliberately untyped.
   */
  rpc: {
    (fn: "create_notification", args: CreateNotificationArgs): RpcResult;
    (fn: string, args?: Record<string, unknown>): RpcResult;
  };
}

export function loose(client: unknown): LooseClient {
  return client as LooseClient;
}
