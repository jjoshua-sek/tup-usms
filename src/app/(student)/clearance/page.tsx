import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, ClipboardCheck, FileCheck2, Receipt } from "lucide-react";

import { RequestClearanceForm } from "@/components/clearance/request-clearance-form";
import { EmptyState } from "@/components/osa/empty-state";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import {
  CLEARANCE_STATUS_META,
  type ClearanceHold,
  type ClearanceRequest,
} from "@/types/osa";

export const metadata: Metadata = {
  title: "Clearance",
};

const TYPE_LABELS: Record<string, string> = {
  good_moral: "Certificate of Good Moral Character",
  graduation_clearance: "Graduation clearance",
  transfer_clearance: "Transfer clearance",
  general_clearance: "General clearance",
};

const HOLD_LABELS: Record<string, string> = {
  pending_violation_case: "Open disciplinary case",
  unresolved_sanction: "Sanction not yet served",
  unsubmitted_apology_letter: "Apology letter not submitted",
  unsigned_settlement: "Settlement not signed",
  unserved_community_service: "Community service not completed",
  unpaid_fee: "Unpaid fee",
  unreturned_item: "Unreturned item",
  missing_document: "Missing document",
  incomplete_requirements: "Incomplete requirements",
  other: "Other hold",
};

/** Plain-language read of where a request stands. */
const STATUS_GUIDANCE: Record<string, string> = {
  submitted: "Filed. The OSA will check your record against open cases and sanctions.",
  verifying: "The OSA is verifying your record right now.",
  on_hold: "Something is blocking your clearance. Clear the items below, then tell the OSA.",
  cleared: "Your record is clear. Settle the certificate fee at the Cashier if one applies.",
  fee_pending: "Pay the fee at the Cashier and bring the official receipt to the OSA.",
  ready: "Ready for pickup at the OSA window. Bring your validated TUP ID.",
  issued: "Released. Keep the certificate — reprints take another request.",
  rejected: "This request was rejected. See the reason below.",
  cancelled: "This request was cancelled.",
};

interface RequestWithHolds extends ClearanceRequest {
  clearance_holds: ClearanceHold[] | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Clearance and Good Moral status (requirement #5).
 *
 * The important half of this page is the hold list: a student who is blocked
 * needs to read exactly what to do next, from whom, and in what order —
 * which is why `clearance_holds.resolution_instructions` is a required column
 * rather than a free-form note.
 */
export default async function ClearancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = loose(supabase);

  const { data: studentRow } = await db
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRow as { id: string } | null;
  if (!student) redirect("/profile");

  const { data: rows } = await db
    .from("clearance_requests")
    .select("*, clearance_holds(*)")
    .eq("student_id", student.id)
    .order("created_at", { ascending: false });

  const requests = (rows as RequestWithHolds[] | null) ?? [];
  const active = requests.filter(
    (request) => !["issued", "rejected", "cancelled"].includes(request.status),
  );
  const history = requests.filter((request) => !active.includes(request));

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Clearance" }]}
        title="Clearance & Good Moral"
        description="Track your certificate requests and see exactly what to do if something is on hold."
      />

      <div className="mb-6">
        <RequestClearanceForm />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No clearance requests yet"
          description="File a request when you need a Certificate of Good Moral Character or graduation clearance. The OSA checks your disciplinary record, then releases it."
        />
      ) : (
        <div className="space-y-8">
          {active.length > 0 && (
            <section className="space-y-4">
              {active.map((request) => {
                const meta = CLEARANCE_STATUS_META[request.status];
                const openHolds = (request.clearance_holds ?? []).filter(
                  (hold) => !hold.resolved_at,
                );
                const resolvedHolds = (request.clearance_holds ?? []).filter(
                  (hold) => hold.resolved_at,
                );

                return (
                  <article
                    key={request.id}
                    className="overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-display text-base font-semibold">
                            {TYPE_LABELS[request.request_type] ?? request.request_type}
                          </h2>
                          <ToneBadge label={meta.label} tone={meta.tone} />
                        </div>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {request.request_number} · filed {formatDate(request.created_at)}
                        </p>
                        <p className="mt-2 text-[13px] leading-relaxed">
                          {STATUS_GUIDANCE[request.status]}
                        </p>
                      </div>

                      {request.fee_amount != null && (
                        <div className="text-right">
                          <p className="font-mono text-lg font-semibold tabular-nums">
                            ₱{Number(request.fee_amount).toFixed(2)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {request.fee_paid_at
                              ? `Paid · OR ${request.or_number ?? "—"}`
                              : "Unpaid"}
                          </p>
                        </div>
                      )}
                    </div>

                    {openHolds.length > 0 && (
                      <div className="border-b border-border bg-red-50/50 p-5">
                        <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-red-900">
                          <AlertTriangle className="h-4 w-4" />
                          {openHolds.length} item{openHolds.length === 1 ? "" : "s"} blocking
                          this clearance
                        </p>
                        <ol className="space-y-3">
                          {openHolds.map((hold, index) => (
                            <li key={hold.id} className="flex gap-3">
                              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-200 text-[11px] font-semibold text-red-900">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-red-900">
                                  {HOLD_LABELS[hold.hold_reason] ?? hold.hold_reason}
                                </p>
                                <p className="text-[12px] text-red-900/80">
                                  {hold.description}
                                </p>
                                <p className="mt-1 rounded-md bg-white/70 p-2 text-[12px] leading-relaxed">
                                  <strong>What to do:</strong> {hold.resolution_instructions}
                                  {hold.responsible_office && (
                                    <span className="block text-[11px] text-muted-foreground">
                                      Office: {hold.responsible_office}
                                    </span>
                                  )}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {resolvedHolds.length > 0 && (
                      <div className="border-b border-border p-5">
                        <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                          <FileCheck2 className="h-4 w-4" />
                          {resolvedHolds.length} already cleared
                        </p>
                        <ul className="space-y-1 text-[12px] text-muted-foreground">
                          {resolvedHolds.map((hold) => (
                            <li key={hold.id}>
                              {HOLD_LABELS[hold.hold_reason] ?? hold.hold_reason} — resolved{" "}
                              {hold.resolved_at ? formatDate(hold.resolved_at) : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {request.rejection_reason && (
                      <p className="border-b border-border p-5 text-[13px]">
                        <strong>Reason:</strong> {request.rejection_reason}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-[11px] text-muted-foreground">
                      <span>Purpose: {request.purpose ?? "—"}</span>
                      {request.verified_at && (
                        <span>Verified {formatDate(request.verified_at)}</span>
                      )}
                      {request.valid_until && (
                        <span>Valid until {formatDate(request.valid_until)}</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}

          {history.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
                Past requests
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {history.map((request) => {
                  const meta = CLEARANCE_STATUS_META[request.status];
                  return (
                    <li key={request.id} className="flex items-center gap-3 px-4 py-3">
                      <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">
                          {TYPE_LABELS[request.request_type] ?? request.request_type}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {request.request_number} ·{" "}
                          {request.issued_at
                            ? `released ${formatDate(request.issued_at)}`
                            : formatDate(request.created_at)}
                        </p>
                      </div>
                      <ToneBadge label={meta.label} tone={meta.tone} />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
