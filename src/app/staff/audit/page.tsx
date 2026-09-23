import type { Metadata } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { formatManila } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Audit Log",
};

export const revalidate = 15;

interface AuditRow {
  id: string;
  user_id: string;
  action: string;
  resource: string;
  details: string | null;
  ip_address: string | null;
  created_at: string;
}

/** Quick filters for the actions people actually go looking for. */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "access", label: "Campus access" },
  { key: "id_validation_reviewed", label: "ID validation" },
  { key: "clearance", label: "Clearance" },
  { key: "case", label: "Cases" },
  { key: "login", label: "Sign-ins" },
] as const;

/**
 * The audit trail.
 *
 * `audit_logs` has INSERT and SELECT policies and deliberately no UPDATE or
 * DELETE — append-only in the database, not merely by convention. That is
 * what makes it worth anything in a due-process dispute: nobody, including an
 * administrator through this app, can rewrite what happened.
 */
export default async function StaffAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff || (!staff.isAdmin && staff.role !== "osa_head")) {
    return (
      <RestrictedNotice
        title="Audit Log"
        audience="The audit trail is restricted to administrators and the OSA head."
      />
    );
  }

  const { filter } = await searchParams;
  const activeFilter = FILTERS.some((f) => f.key === filter) ? filter! : "all";

  const supabase = await createClient();
  const db = loose(supabase);

  let query = db
    .from("audit_logs")
    .select("id, user_id, action, resource, details, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(150);

  if (activeFilter !== "all") {
    // `like` against the action prefix keeps the filter list short without a
    // separate category column.
    query = query.like("action", `${activeFilter}%`);
  }

  const { data: logRows } = await query;
  const logs = (logRows as AuditRow[] | null) ?? [];

  // Resolve actor names in two lookups rather than a join: audit_logs points
  // at auth.users, which application code can't select from directly.
  const userIds = [...new Set(logs.map((log) => log.user_id))];
  const [{ data: staffRows }, { data: studentRows }] = userIds.length
    ? await Promise.all([
        db.from("staff").select("user_id, full_name, role_type").in("user_id", userIds),
        db
          .from("students")
          .select("user_id, first_name, last_name, student_number")
          .in("user_id", userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const actors = new Map<string, string>();
  for (const row of (staffRows as Array<{ user_id: string; full_name: string; role_type: string }> | null) ?? []) {
    actors.set(row.user_id, `${row.full_name} (${row.role_type})`);
  }
  for (const row of (studentRows as Array<{
    user_id: string;
    first_name: string;
    last_name: string;
    student_number: string;
  }> | null) ?? []) {
    if (!actors.has(row.user_id)) {
      actors.set(row.user_id, `${row.first_name} ${row.last_name} (${row.student_number})`);
    }
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Audit Log" }]}
        title="Audit Log"
        description="Append-only record of who did what, from where, and when."
      />

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
        {FILTERS.map((option) => (
          <Link
            key={option.key}
            href={`/staff/audit?filter=${option.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              activeFilter === option.key
                ? "border-tup-maroon-600 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {logs.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No entries"
          description="Nothing matching this filter has been recorded yet."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-[12px]">
            <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Resource</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                    {formatManila(log.created_at, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-2">{actors.get(log.user_id) ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">{log.action}</td>
                  <td className="px-4 py-2 text-muted-foreground">{log.resource}</td>
                  <td className="max-w-[320px] px-4 py-2 text-muted-foreground">
                    <span className="line-clamp-2 break-words">{log.details ?? "—"}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {log.ip_address ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Showing the 150 most recent entries. Audit records are retained for the life of the
        student record and may be disclosed to the National Privacy Commission on request.
      </p>
    </div>
  );
}
