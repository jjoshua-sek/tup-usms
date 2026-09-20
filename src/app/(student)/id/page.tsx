import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  DoorOpen,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";

import { IdCardQr, IdQrPanel } from "@/components/id/id-qr-panel";
import { RequestValidationButton } from "@/components/id/request-validation-button";
import { PageHeader } from "@/components/shared/page-header";
import { formatInstitutionalQrPayload } from "@/lib/access/payload";
import { getCurrentTerm, hasExpired } from "@/lib/access/term";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { ID_STATUS_META, type IdValidationStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "Digital ID",
};

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string;
  year_level: string;
  department: string;
  campus: string;
  photo_url: string | null;
}

interface ValidationRow {
  id: string;
  status: IdValidationStatus;
  school_year: string;
  semester: string;
  expires_at: string | null;
  rejection_reason: string | null;
  validation_sticker_number: string | null;
}

interface AccessEventRow {
  id: string;
  gate_label: string;
  direction: "entry" | "exit";
  decision: "allow" | "deny";
  reason: string;
  occurred_at: string;
}

const VALID_FOR = [
  "Campus Access",
  "OSA Transactions",
  "Library Borrowing",
  "Exam Verification",
  "Lab Reservation",
];

const NOT_VALID_FOR = ["Financial Transactions", "Grade Retrieval"];

/** What the student should actually do, per validation state. */
const STATUS_GUIDANCE: Record<IdValidationStatus | "none", string> = {
  none: "Your ID has not been validated for this term yet. Request validation here, then bring your physical ID to the OSA for the term sticker.",
  pending:
    "Your request is queued with the OSA. Bring your physical ID to the OSA window to have the term sticker applied.",
  under_review: "The OSA is verifying your photo and records. No action needed right now.",
  validated: "Your ID opens the campus turnstiles. Keep it with you — gates scan the printed QR.",
  rejected:
    "The OSA could not validate your ID. Fix the issue noted below, then request validation again.",
  expired:
    "Last term's validation has lapsed. Request validation for the current term to keep using the gates.",
  suspended:
    "Campus access is on hold. This cannot be lifted online — please report to the OSA in person.",
  revoked:
    "This ID has been reported lost or revoked. Request a replacement card at the OSA before using the gates.",
};

const TONE_CLASSES: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  neutral: "border-border bg-muted text-foreground",
};

function formatManilaTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default async function DigitalIdPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, department, campus, photo_url"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRaw as StudentRow | null;
  if (!student) redirect("/profile");

  // New OSA tables aren't in the hand-maintained Database generic yet.
  const db = loose(supabase);
  const term = getCurrentTerm();

  const [{ data: validationRaw }, { data: eventsRaw }] = await Promise.all([
    db
      .from("id_validations")
      .select(
        "id, status, school_year, semester, expires_at, rejection_reason, validation_sticker_number"
      )
      .eq("student_id", student.id)
      .eq("school_year", term.schoolYear)
      .eq("semester", term.semester)
      .maybeSingle(),
    db
      .from("access_events")
      .select("id, gate_label, direction, decision, reason, occurred_at")
      .eq("student_id", student.id)
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  const validation = (validationRaw as ValidationRow | null) ?? null;
  const events = (eventsRaw as AccessEventRow[] | null) ?? [];

  const status = validation?.status ?? null;
  const scannable = status === "validated" && !hasExpired(validation?.expires_at);

  const statusMeta = status ? ID_STATUS_META[status] : { label: "Not validated", tone: "warning" as const };
  const guidance = STATUS_GUIDANCE[status ?? "none"];
  const canRequest =
    status === null || status === "rejected" || status === "expired";

  const qrPayload = formatInstitutionalQrPayload(student.student_number);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Digital ID" }]}
        title="Your TUP Digital ID"
        description={`Shows the same institutional QR as your physical card. ${term.label}.`}
      />

      <div className="grid items-start gap-10 lg:grid-cols-2">
        {/* DIGITAL ID CARD */}
        <div
          className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-tup-gradient p-7 text-white shadow-[0_4px_12px_rgba(122,31,43,0.2),0_20px_40px_rgba(0,0,0,0.15)]"
          style={{ aspectRatio: "1.586 / 1" }}
        >
          <div
            className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(212,160,23,0.2), transparent 70%)",
            }}
            aria-hidden="true"
          />

          {/* TOP: brand */}
          <div className="relative z-10 flex items-start justify-between">
            <div className="text-[11px] leading-snug tracking-wider opacity-85">
              <strong className="mb-1 block text-sm font-semibold tracking-wide text-tup-gold-500">
                TUP MANILA
              </strong>
              Technological University
              <br />
              of the Philippines
            </div>
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-tup-gold-500 text-sm font-bold text-tup-maroon-600"
              aria-label="TUP seal"
            >
              TUP
            </div>
          </div>

          {/* MIDDLE: photo + identity */}
          <div className="relative z-10 grid grid-cols-[auto_1fr] items-center gap-5">
            <div
              className="flex h-[100px] w-20 items-center justify-center overflow-hidden rounded border-2 border-tup-gold-500 bg-white/10"
              aria-label="Student photo"
            >
              {student.photo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */
                <img
                  src={student.photo_url}
                  alt={`${student.first_name} ${student.last_name}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="h-8 w-8 text-white/40" />
              )}
            </div>

            <div>
              <div className="mb-1.5 text-[20px] font-semibold leading-tight tracking-tight">
                {student.first_name}
                <br />
                {student.last_name}
              </div>
              <div className="space-y-0.5 text-[10px] leading-[1.6] opacity-85">
                <IdMetaRow label="ID" value={student.student_number} />
                <IdMetaRow label="Course" value={student.program} />
                <IdMetaRow label="Year" value={student.year_level} />
                <IdMetaRow label="College" value={student.department} />
              </div>
            </div>
          </div>

          {/* BOTTOM: validity + QR */}
          <div className="relative z-10 flex items-end justify-between border-t border-white/20 pt-3.5">
            <div className="text-[9px] uppercase tracking-widest opacity-70">
              Valid
              <br />
              <strong className="mt-0.5 block tracking-wide text-tup-gold-500">
                {term.schoolYearLabel}
              </strong>
              <span className="mt-1 block normal-case tracking-normal opacity-80">
                {statusMeta.label}
              </span>
            </div>

            <IdCardQr payload={qrPayload} />
          </div>
        </div>

        {/* RIGHT: QR + status */}
        <div className="space-y-5">
          <IdQrPanel payload={qrPayload} scannable={scannable} />

          {/* Validation status */}
          <div className={`rounded-xl border p-5 ${TONE_CLASSES[statusMeta.tone] ?? TONE_CLASSES.neutral}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {scannable ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : statusMeta.tone === "danger" ? (
                  <ShieldAlert className="h-4 w-4" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                <p className="text-sm font-semibold">ID validation — {statusMeta.label}</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-70">
                {term.semester}
              </span>
            </div>

            <p className="mt-2 text-[13px] leading-relaxed">{guidance}</p>

            {validation?.rejection_reason && (
              <p className="mt-2 rounded-md bg-white/60 p-2.5 text-[12px]">
                <strong>OSA note:</strong> {validation.rejection_reason}
              </p>
            )}

            {validation?.validation_sticker_number && (
              <p className="mt-2 text-[12px] opacity-80">
                Sticker no. <span className="font-mono">{validation.validation_sticker_number}</span>
              </p>
            )}

            {validation?.expires_at && scannable && (
              <p className="mt-2 text-[12px] opacity-80">
                Expires {formatManilaTime(validation.expires_at)}
              </p>
            )}

            {canRequest && (
              <div className="mt-4">
                <RequestValidationButton
                  label={status === null ? "Request ID validation" : "Request validation again"}
                />
              </div>
            )}
          </div>

          {/* Uses */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h5 className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Valid For
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {VALID_FOR.map((label) => (
                <UseTag key={label} label={label} />
              ))}
            </div>

            <h5 className="mb-2.5 mt-4 font-mono text-[10px] font-semibold uppercase tracking-wider text-destructive">
              Not Valid For
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {NOT_VALID_FOR.map((label) => (
                <UseTag key={label} label={label} variant="danger" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Access history */}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            Recent campus access
          </h3>
          <span className="text-[11px] text-muted-foreground">Last 8 scans</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {events.length === 0 ? (
            <div className="grid place-items-center gap-2 p-10 text-center">
              <DoorOpen className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No gate scans recorded yet for your ID.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="flex items-center gap-3 px-4 py-3">
                  {event.decision === "allow" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{event.gate_label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatManilaTime(event.occurred_at)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    <ArrowRightLeft className="h-3 w-3" />
                    {event.direction === "entry" ? "Entry" : "Exit"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Data minimization:</strong> a gate scan reveals
          only your first name, initial, masked student number and photo — never your contact
          details, grades, or disciplinary record. Access logs are kept for 180 days and are
          visible to you here, in line with RA 10173 §11 and your right to be informed.
        </p>
      </section>
    </div>
  );
}

function IdMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <strong className="min-w-[56px] text-[9px] font-semibold uppercase tracking-widest text-tup-gold-500">
        {label}
      </strong>
      <span>{value}</span>
    </div>
  );
}

function UseTag({ label, variant }: { label: string; variant?: "danger" }) {
  if (variant === "danger") {
    return (
      <span className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-2.5 py-1 text-[11px] text-[#991b1b]">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] text-foreground">
      {label}
    </span>
  );
}
