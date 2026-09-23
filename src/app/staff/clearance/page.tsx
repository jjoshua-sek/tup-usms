import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, FileCheck2, Hourglass } from "lucide-react";

import {
  AdvanceClearanceForm,
  ResolveHoldButton,
  RunCheckButton,
} from "@/components/clearance/clearance-controls";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { CLEARANCE_STATUS_META, type ClearanceHold, type ClearanceStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "Clearance",
};

export const revalidate = 20;

const HOLD_LABELS: Record<string, string> = {
  pending_violation_case: "Open case",
  unresolved_sanction: "Sanction not served",
  unsubmitted_apology_letter: "Apology letter",
  unsigned_settlement: "Settlement unsigned",
  unserved_community_service: "Community service",
  unpaid_fee: "Unpaid fee",
  unreturned_item: "Unreturned item",
  missing_document: "Missing document",
  incomplete_requirements: "Incomplete requirements",
  other: "Other",
};

const TYPE_LABELS: Record<string, string> = {
  good_moral: "Good Moral",
  graduation_clearance: "Graduation",
  transfer_clearance: "Transfer",
  general_clearance: "General",
};

interface RequestRow {
  id: string;
  request_number: string;
  request_type: string;
  purpose: string | null;
  status: ClearanceStatus;
  auto_check_result: string | null;
  auto_checked_at: string | null;
  fee_amount: number | null;
  or_number: string | null;
  certificate_number: string | null;
  created_at: string;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
    year_level: string | null;
  } | null;
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
 * Clearance / Good Moral processing queue.
 *
 * The record check is one button, but the holds it produces are the real
 * output: each one names the blocking case and tells the student exactly what
 * to do. Graduating students are the ones who feel this most — a vague hold
 * in March is a missed graduation in May.
 */
export default async function StaffClearancePage() {
  const staff = await getStaffContext();
  if (!staff || (!staff.isOsa && staff.role !== "registrar" && staff.role !== "cashier")) {
    return (
      <RestrictedNotice
        title="Clearance"
        audience="Clearance processing is for OSA officers, with read access for the Registrar and Cashier."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  const { data: rows } = await db
    .from("clearance_requests")
    .select(
      "id, request_number, request_type, purpose, status, auto_check_result, auto_checked_at, fee_amount, or_number, certificate_number, created_at, students(id, first_name, last_name, student_number, program, year_level), clearance_holds(*)",
    )
    .order("created_at", { ascending: true })
    .limit(200);

  const requests = (rows as RequestRow[] | null) ?? [];

  const incoming = requests.filter((request) =>
    ["submitted", "verifying"].includes(request.status),
  );
  const held = requests.filter((request) => request.status === "on_hold");
  const ready = requests.filter((request) =>
    ["cleared", "fee_pending", "ready"].includes(request.status),
  );
  const closed = requests.filter((request) =>
    ["issued", "rejected", "cancelled"].includes(request.status),
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Clearance" }]}
        title="Clearance & Good Moral"
        description="Verify records, record what is blocking a student, and release certificates."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Awaiting check" value={incoming.length} icon={Hourglass} />
        <StatsCard
          label="On hold"
          value={held.length}
          icon={AlertTriangle}
          iconTone={held.length > 0 ? "danger" : "neutral"}
        />
        <StatsCard label="Cleared / ready" value={ready.length} icon={FileCheck2} iconTone="success" />
        <StatsCard label="Closed" value={closed.length} icon={ClipboardCheck} />
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No clearance requests"
          description="Students file these from their Clearance page. They arrive here for the record check."
        />
      ) : (
        <div className="space-y-8">
          <Queue title="Awaiting record check" requests={incoming} canAct={staff.isOsa} />
          <Queue title="On hold" requests={held} canAct={staff.isOsa} />
          <Queue title="Cleared, fee & release" requests={ready} canAct={staff.isOsa} />
          <Queue title="Closed" requests={closed} canAct={false} />
        </div>
      )}
    </div>
  );
}

function Queue({
  title,
  requests,
  canAct,
}: {
  title: string;
  requests: RequestRow[];
  canAct: boolean;
}) {
  if (requests.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {requests.length}
        </span>
      </h2>

      <ul className="space-y-3">
        {requests.map((request) => {
          const meta = CLEARANCE_STATUS_META[request.status];
          const openHolds = (request.clearance_holds ?? []).filter((hold) => !hold.resolved_at);

          return (
            <li key={request.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] font-medium">
                      {request.request_number}
                    </span>
                    <ToneBadge label={meta.label} tone={meta.tone} />
                    <ToneBadge
                      label={TYPE_LABELS[request.request_type] ?? request.request_type}
                      tone="neutral"
                    />
                  </div>

                  <p className="mt-1 text-[13px]">
                    {request.students ? (
                      <Link
                        href={`/staff/students/${request.students.id}`}
                        className="text-tup-maroon-600 underline-offset-2 hover:underline"
                      >
                        {request.students.first_name} {request.students.last_name}
                      </Link>
                    ) : (
                      "Unknown student"
                    )}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {request.students?.student_number}
                    </span>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {request.students?.program} · {request.students?.year_level}
                    </span>
                  </p>

                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Purpose: {request.purpose ?? "—"} · filed {formatDate(request.created_at)}
                    {request.auto_checked_at
                      ? ` · checked ${formatDate(request.auto_checked_at)} (${request.auto_check_result})`
                      : ""}
                  </p>
                </div>

                {canAct && <RunCheckButton requestId={request.id} />}
              </div>

              {openHolds.length > 0 && (
                <ul className="mt-3 space-y-2 rounded-lg bg-red-50/60 p-3">
                  {openHolds.map((hold) => (
                    <li key={hold.id} className="space-y-1.5">
                      <p className="text-[12px] font-medium text-red-900">
                        <span className="mr-1.5 rounded bg-red-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                          {HOLD_LABELS[hold.hold_reason] ?? hold.hold_reason}
                        </span>
                        {hold.description}
                      </p>
                      <p className="text-[11px] text-red-900/80">
                        Student is told: {hold.resolution_instructions}
                      </p>
                      {canAct && <ResolveHoldButton holdId={hold.id} />}
                    </li>
                  ))}
                </ul>
              )}

              {canAct && (
                <div className="mt-3 border-t border-border pt-3">
                  <AdvanceClearanceForm requestId={request.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
