import type { Metadata } from "next";
import Link from "next/link";
import { CaretDownIcon as ChevronDown, ClipboardTextIcon as ClipboardCheck } from "@phosphor-icons/react/ssr";

import {
  AdvanceClearanceForm,
  ResolveHoldButton,
  RunCheckButton,
} from "@/components/clearance/clearance-controls";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { getStaffContext } from "@/lib/osa/staff-context";
import { WAITING } from "@/lib/osa/today";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaDate } from "@/lib/utils/time";
import { CLEARANCE_STATUS_META, type ClearanceHold, type ClearanceStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "Clearance requests",
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

/** What the record check found, in words (auto_check_result, 00010 and 00018). */
const CHECK_RESULT_LABELS: Record<string, string> = {
  clear: "nothing blocking",
  has_pending_cases: "an open case",
  has_unresolved_sanctions: "a sanction not settled",
  has_unserved_sanctions: "a sanction not served",
  error: "the check failed",
};

/** Requests that are finished: folded at the bottom. */
const FINISHED = ["issued", "rejected", "cancelled"];
const FINISHED_SHOWN = 30;

const COLUMNS =
  "id, request_number, request_type, purpose, status, auto_check_result, auto_checked_at, fee_amount, or_number, certificate_number, created_at, students(id, first_name, last_name, student_number, program, year_level), clearance_holds(*)";

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
        title="Clearance requests"
        audience="Clearance processing is for OSA officers, with read access for the Registrar and Cashier."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);

  // Two reads, so the open requests never lose rows to a cap filled by old
  // ones: every request still in progress, then the most recent finished.
  const [{ data: openRows }, { data: finishedRows }] = await Promise.all([
    db
      .from("clearance_requests")
      .select(COLUMNS)
      .not("status", "in", `(${FINISHED.join(",")})`)
      .order("created_at", { ascending: true })
      .limit(300),
    db
      .from("clearance_requests")
      .select(COLUMNS)
      .in("status", FINISHED)
      .order("created_at", { ascending: false })
      .limit(FINISHED_SHOWN),
  ]);

  const requests = (openRows as RequestRow[] | null) ?? [];
  const closed = (finishedRows as RequestRow[] | null) ?? [];

  // Shared with the home page's "Today" list.
  const incoming = requests.filter((request) =>
    (WAITING.clearanceRequests as readonly string[]).includes(request.status),
  );
  const held = requests.filter((request) => request.status === "on_hold");
  const ready = requests.filter((request) =>
    ["cleared", "fee_pending", "ready"].includes(request.status),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "Clearance requests" }]}
        title="Clearance requests"
        description="Requests for clearance or a Good Moral certificate. Run the record check, clear whatever is blocking the student, then release the certificate."
      />

      {requests.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No requests waiting"
          description="Students file these from their Clearance page. They arrive here for the record check."
        />
      ) : (
        <>
          <Queue
            title="Waiting for the record check"
            note="Press Run the record check. It looks for open cases and unsettled sanctions."
            requests={incoming}
            canAct={staff.isOsa}
            stage="check"
          />
          <Queue
            title="On hold"
            note="Something is blocking the student. Clear each hold once it is settled, then run the check again."
            requests={held}
            canAct={staff.isOsa}
            stage="hold"
          />
          <Queue
            title="Cleared: fee and release"
            note="Record the OR number if there is a fee, then mark it ready and issued."
            requests={ready}
            canAct={staff.isOsa}
            stage="release"
          />
        </>
      )}

      {closed.length > 0 && (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-5 text-base font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            Finished requests
            <span className="font-normal text-muted-foreground">
              ({closed.length === FINISHED_SHOWN ? `the last ${FINISHED_SHOWN}` : closed.length})
            </span>
          </summary>
          <ul className="space-y-3 border-t border-border p-4">
            {closed.map((request) => (
              <RequestItem key={request.id} request={request} canAct={false} stage="finished" />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type Stage = "check" | "hold" | "release" | "finished";

function Queue({
  title,
  note,
  requests,
  canAct,
  stage,
}: {
  title: string;
  note: string;
  requests: RequestRow[];
  canAct: boolean;
  stage: Stage;
}) {
  if (requests.length === 0) return null;

  return (
    <section>
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 rounded-full bg-muted px-2 text-base font-normal tabular-nums text-muted-foreground">
          {requests.length}
        </span>
      </h2>
      {canAct && <p className="mb-3 mt-0.5 text-base text-muted-foreground">{note}</p>}
      <ul className={canAct ? "space-y-3" : "mt-3 space-y-3"}>
        {requests.map((request) => (
          <RequestItem key={request.id} request={request} canAct={canAct} stage={stage} />
        ))}
      </ul>
    </section>
  );
}

function RequestItem({ request, canAct, stage }: { request: RequestRow; canAct: boolean; stage: Stage }) {
  const meta = CLEARANCE_STATUS_META[request.status];
  const openHolds = (request.clearance_holds ?? []).filter((hold) => !hold.resolved_at);

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-base">
            {request.students ? (
              <Link
                href={`/staff/students/${request.students.id}`}
                className="text-lg font-semibold text-tup-maroon-700 underline-offset-2 hover:underline"
              >
                {request.students.first_name} {request.students.last_name}
              </Link>
            ) : (
              <span className="text-lg font-semibold">Unknown student</span>
            )}
            {request.students?.student_number && (
              <span className="ml-2 whitespace-nowrap font-mono text-sm text-muted-foreground">
                {request.students.student_number}
              </span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">{TYPE_LABELS[request.request_type] ?? request.request_type}</span>
            <ToneBadge label={meta.label} tone={meta.tone} />
          </p>
          <p className="text-base text-muted-foreground">
            {[request.students?.program, request.students?.year_level].filter(Boolean).join(", ")}
            {request.purpose ? ` · For ${request.purpose}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="whitespace-nowrap font-mono">{request.request_number}</span>
            {" · "}Filed {formatManilaDate(request.created_at)}
            {request.auto_checked_at
              ? ` · Checked ${formatManilaDate(request.auto_checked_at)}: ${CHECK_RESULT_LABELS[request.auto_check_result ?? ""] ?? request.auto_check_result}`
              : ""}
            {request.or_number ? ` · OR ${request.or_number}` : ""}
            {request.certificate_number ? ` · Certificate ${request.certificate_number}` : ""}
          </p>
        </div>

        {canAct && <RunCheckButton requestId={request.id} again={stage !== "check"} />}
      </div>

      {openHolds.length > 0 && (
        <ul className="mt-3 space-y-3 rounded-lg bg-red-50/60 p-3">
          {openHolds.map((hold) => (
            <li key={hold.id} className="space-y-1.5">
              <p className="text-base font-medium text-red-900">
                <span className="mr-2 rounded bg-red-200 px-1.5 py-0.5 text-sm font-semibold">
                  {HOLD_LABELS[hold.hold_reason] ?? hold.hold_reason}
                </span>
                {hold.description}
              </p>
              <p className="text-base text-red-900/80">The student is told: {hold.resolution_instructions}</p>
              {canAct && <ResolveHoldButton holdId={hold.id} />}
            </li>
          ))}
        </ul>
      )}

      {/* Changing the status by hand is the main step once cleared; before
          that the record check decides it, so the form is folded away. */}
      {canAct &&
        (stage === "release" ? (
          <div className="mt-3 border-t border-border pt-3">
            <AdvanceClearanceForm requestId={request.id} requestType={request.request_type} />
          </div>
        ) : (
          <details className="group mt-3 border-t border-border pt-2">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-base font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
              Change the status by hand
            </summary>
            <div className="pt-2">
              <AdvanceClearanceForm requestId={request.id} requestType={request.request_type} />
            </div>
          </details>
        ))}
    </li>
  );
}
