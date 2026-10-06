import { ACCOUNT_ACTIVITY_ACTIONS, describeActivity, describeUserAgent, type AccountActivityRow } from "@/lib/accounts/activity";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaDateTime } from "@/lib/utils/time";

/**
 * The signed-in user's last account events: sign-ins, password changes and
 * reset requests. Read through the user's own session, so the policy from
 * migration 00028 decides what comes back; before that migration runs, a
 * student sees nothing here rather than anyone else's activity.
 */
export async function AccountActivity({ userId }: { userId: string }) {
  const supabase = await createClient();
  const { data, error } = await loose(supabase)
    .from("audit_logs")
    .select("action, details, ip_address, user_agent, created_at")
    .eq("user_id", userId)
    .in("action", [...ACCOUNT_ACTIVITY_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) console.error("[settings] account activity not loaded", error);
  const rows = (data as AccountActivityRow[] | null) ?? [];

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No account activity recorded yet. Your next sign-in will appear here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 font-medium">When</th>
            <th className="py-2 pr-4 font-medium">What happened</th>
            <th className="py-2 pr-4 font-medium">Device</th>
            <th className="py-2 font-medium">IP address</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const { label, note } = describeActivity(row);
            return (
              <tr key={`${row.created_at}-${row.action}`} className="align-top">
                <td className="whitespace-nowrap py-2 pr-4">{formatManilaDateTime(row.created_at)}</td>
                <td className="py-2 pr-4">
                  <span className="font-medium">{label}</span>
                  {note && <span className="block text-[12px] text-muted-foreground">{note}</span>}
                </td>
                <td className="py-2 pr-4">{describeUserAgent(row.user_agent)}</td>
                <td className="py-2 font-mono text-[12px]">{row.ip_address ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Don&apos;t recognise something? Change your password now, then tell the Office of Student Affairs.
      </p>
    </div>
  );
}
