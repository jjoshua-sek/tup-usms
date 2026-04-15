import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Admin Supabase client that bypasses Row-Level Security.
 * Uses the service role key - ONLY use in server-side code.
 *
 * Use cases:
 * - Batch user creation (admin operations)
 * - Data migration scripts
 * - Background jobs (AI summarization, cleanup)
 *
 * ⚠️ NEVER import this in client components or expose to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
