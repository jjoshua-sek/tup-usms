import type { Metadata } from "next";
import { FileSpreadsheet, MailCheck, UserPlus } from "lucide-react";

import { CreateAccountForm } from "@/components/accounts/create-account-form";
import { EnrollmentImport } from "@/components/accounts/enrollment-import";
import { ResendInvitationButton } from "@/components/accounts/resend-invitation-button";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge, type Tone } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaDateTime } from "@/lib/utils/time";

export const metadata: Metadata = {
  title: "Accounts",
};

interface InvitationRow {
  id: string;
  student_number: string;
  first_name: string;
  last_name: string;
  program: string | null;
  delivery_email: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  activated_at: string | null;
  created_at: string;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting to send", tone: "info" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Link sent", tone: "info" },
  failed: { label: "Retrying", tone: "warning" },
  undeliverable: { label: "Could not send", tone: "danger" },
  activated: { label: "Set up", tone: "success" },
  password_issued: { label: "Password given in person", tone: "neutral" },
};

/** A link can be sent again until the student has used one. */
const RESENDABLE = new Set(["queued", "sent", "failed", "undeliverable"]);

/**
 * Account administration: bulk enrollment import, one-off account creation,
 * and the delivery record for every sign-in link sent.
 *
 * Administrators only. Creating logins is the most powerful thing the
 * system does — a staff account decides what its holder can read about
 * every student — so it sits behind the narrowest role there is.
 */
export default async function AccountsPage() {
  const staff = await getStaffContext();
  if (!staff?.isAdmin) {
    return (
      <RestrictedNotice
        title="Accounts"
        audience="Creating and importing accounts is limited to system administrators."
      />
    );
  }

  const { data, error } = await loose(await createClient())
    .from("account_invitations")
    .select(
      "id, student_number, first_name, last_name, program, delivery_email, status, attempts, last_error, sent_at, activated_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) console.error("[accounts] invitations query failed", error);

  const invitations = (data as InvitationRow[] | null) ?? [];
  const counts = invitations.reduce<Record<string, number>>((tally, row) => {
    tally[row.status] = (tally[row.status] ?? 0) + 1;
    return tally;
  }, {});
  const waiting = (counts.queued ?? 0) + (counts.sending ?? 0) + (counts.failed ?? 0);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Accounts" }]}
        title="Accounts"
        description="Enroll students from a list, create a single account, and follow every sign-in link sent."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card">
          <header className="flex items-center gap-2 border-b border-border px-5 py-3">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-display text-[15px] font-semibold tracking-tight">Import an enrollment list</h2>
          </header>
          <div className="space-y-3 px-5 py-4">
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              One account per student. Each is emailed a one-time link, at the personal address on
              the list, to choose their own password; their profile then opens with the program and
              year already filled in from the list.
            </p>
            <EnrollmentImport />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="flex items-center gap-2 border-b border-border px-5 py-3">
            <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-display text-[15px] font-semibold tracking-tight">Create one account</h2>
          </header>
          <div className="px-5 py-4">
            <CreateAccountForm />
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
            <MailCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Invitations
            <span className="text-[12px] font-normal tabular-nums text-muted-foreground">{invitations.length}</span>
          </h2>
          <p className="text-[12px] text-muted-foreground">
            <span className="tabular-nums">{counts.activated ?? 0}</span> set up ·{" "}
            <span className="tabular-nums">{counts.sent ?? 0}</span> waiting on the student ·{" "}
            <span className="tabular-nums">{waiting}</span> still sending
            {(counts.undeliverable ?? 0) > 0 && (
              <span className="text-red-700">
                {" "}
                · <span className="tabular-nums">{counts.undeliverable}</span> could not send
              </span>
            )}
          </p>
        </header>

        {invitations.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-muted-foreground">
            No accounts created here yet. Import a list or create one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Student</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Link sent to</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitations.map((row) => {
                  const status = STATUS[row.status] ?? { label: row.status, tone: "neutral" as Tone };
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[12px]">{row.student_number}</span>
                        <span className="block">
                          {row.last_name}, {row.first_name}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px]">{row.delivery_email}</td>
                      <td className="px-4 py-2.5">
                        <ToneBadge label={status.label} tone={status.tone} />
                        {row.last_error && row.status !== "activated" && (
                          <span className="mt-1 block max-w-xs text-[11px] text-muted-foreground">
                            {row.last_error}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {row.activated_at
                          ? `Set up ${formatManilaDateTime(row.activated_at)}`
                          : row.sent_at
                            ? `Sent ${formatManilaDateTime(row.sent_at)}`
                            : `Created ${formatManilaDateTime(row.created_at)}`}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {RESENDABLE.has(row.status) && <ResendInvitationButton invitationId={row.id} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
