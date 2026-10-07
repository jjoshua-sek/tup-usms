import type { Metadata } from "next";
import { BadgeCheck, Clock, IdCard, Search, ShieldX } from "lucide-react";

import { CounterValidateForm } from "@/components/id-validation/counter-validate-form";
import { ReviewControls } from "@/components/id-validation/review-controls";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { searchTokens, tokenFilter } from "@/lib/students/search";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { formatManilaMonthDayTime } from "@/lib/utils/time";
import { ID_STATUS_META, type IdValidationStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "ID Validation",
};

export const dynamic = "force-dynamic";

interface StudentSummary {
  id?: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string | null;
  year_level: string | null;
  photo_url: string | null;
}

interface ValidationRow {
  id: string;
  status: IdValidationStatus;
  school_year: string;
  semester: string;
  submitted_at: string;
  validated_at: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  validation_sticker_number: string | null;
  students: StudentSummary | null;
}

const VALIDATION_COLUMNS =
  "id, status, school_year, semester, submitted_at, validated_at, expires_at, rejection_reason, validation_sticker_number, students(first_name, last_name, student_number, program, year_level, photo_url)";

/** How many rows each list shows; the counts above them are exact. */
const LIST_LIMIT = 50;

/** Which actions make sense from each state. */
type Decision = "validate" | "reject" | "suspend" | "revoke" | "reinstate" | "surrender";

const DECISIONS: Record<IdValidationStatus, Decision[]> = {
  pending: ["validate", "reject"],
  under_review: ["validate", "reject"],
  validated: ["suspend", "revoke", "surrender"],
  rejected: ["validate"],
  expired: ["validate"],
  suspended: ["reinstate", "revoke"],
  revoked: ["reinstate"],
  // Handed in on clearance. Nothing to do unless the student re-enrolls, which
  // starts a fresh validation for the new term.
  surrendered: [],
};

/**
 * ID validation (requirement #5, and the switch behind the turnstiles).
 *
 * Two ways in. A student can ask from their Digital ID page, which puts a
 * request in the queue below; or they come to the OSA window with the card,
 * and the officer finds them under "Validate at the counter" and validates
 * on the spot. Either way, validating is what lets a card open a gate, and
 * suspending stops it at the next scan — which is why those actions notify
 * the student rather than changing state quietly.
 *
 * Each list is queried for what it shows — this term's requests, this
 * term's validated IDs, holds from any term — rather than reading every
 * record and filtering here, which stopped showing the current term once
 * the table passed a few hundred rows.
 */
export default async function StaffIdValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const staff = await getStaffContext();
  if (!staff?.isOsa) {
    return (
      <RestrictedNotice
        title="ID Validation"
        audience="ID validation is handled by OSA officers and the OSA head. Ask an administrator if you need this queue."
      />
    );
  }

  const { q } = await searchParams;
  const tokens = searchTokens(q);

  const db = loose(await createClient());
  const term = getCurrentTerm();

  const [queueResult, flaggedResult, validatedResult] = await Promise.all([
    db
      .from("id_validations")
      .select(VALIDATION_COLUMNS, { count: "exact" })
      .eq("school_year", term.schoolYear)
      .eq("semester", term.semester)
      .in("status", ["pending", "under_review", "rejected"])
      .order("submitted_at", { ascending: true })
      .limit(LIST_LIMIT),
    db
      .from("id_validations")
      .select(VALIDATION_COLUMNS, { count: "exact" })
      .in("status", ["suspended", "revoked"])
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT),
    db
      .from("id_validations")
      .select(VALIDATION_COLUMNS, { count: "exact" })
      .eq("school_year", term.schoolYear)
      .eq("semester", term.semester)
      .eq("status", "validated")
      .order("validated_at", { ascending: false })
      .limit(LIST_LIMIT),
  ]);

  const queue = (queueResult.data as ValidationRow[] | null) ?? [];
  const flagged = (flaggedResult.data as ValidationRow[] | null) ?? [];
  const validated = (validatedResult.data as ValidationRow[] | null) ?? [];
  const queueCount = queueResult.count ?? queue.length;
  const flaggedCount = flaggedResult.count ?? flagged.length;
  const validatedCount = validatedResult.count ?? validated.length;

  // Counter search: students matching every word typed, with this term's record if any.
  let matches: Array<{ student: StudentSummary & { id: string }; record: { id: string; status: IdValidationStatus } | null }> = [];
  if (tokens.length > 0) {
    let query = db
      .from("students")
      .select("id, first_name, last_name, student_number, program, year_level, photo_url")
      .order("last_name", { ascending: true })
      .limit(8);
    for (const token of tokens) query = query.or(tokenFilter(token));
    const { data: studentRows } = await query;
    const students = (studentRows as Array<StudentSummary & { id: string }> | null) ?? [];

    const records = new Map<string, { id: string; status: IdValidationStatus }>();
    if (students.length > 0) {
      const { data: recordRows } = await db
        .from("id_validations")
        .select("id, student_id, status")
        .eq("school_year", term.schoolYear)
        .eq("semester", term.semester)
        .in(
          "student_id",
          students.map((student) => student.id),
        );
      for (const row of (recordRows as Array<{ id: string; student_id: string; status: IdValidationStatus }> | null) ?? []) {
        records.set(row.student_id, { id: row.id, status: row.status });
      }
    }
    matches = students.map((student) => ({ student, record: records.get(student.id) ?? null }));
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "ID Validation" }]}
        title="ID Validation"
        description={`Validated IDs open the campus turnstiles. ${term.label}.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard
          label="Requests waiting"
          value={queueCount}
          icon={Clock}
          iconTone={queueCount > 0 ? "warn" : "neutral"}
        />
        <StatsCard label="Validated this term" value={validatedCount} icon={BadgeCheck} iconTone="success" />
        <StatsCard
          label="Suspended / revoked"
          value={flaggedCount}
          icon={ShieldX}
          iconTone={flaggedCount > 0 ? "danger" : "neutral"}
        />
      </div>

      <Section
        title="Validate at the counter"
        note="For a student at the OSA window with their ID. Check their face against the photo, apply the term sticker, then validate. No online request is needed."
      >
        <form method="get" className="mb-3 flex max-w-xl gap-2">
          <label htmlFor="counter-search" className="sr-only">
            Student number or name
          </label>
          <input
            id="counter-search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Student number or name, e.g. TUPM-22-0148"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm focus:border-tup-maroon-600 focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <Search className="h-4 w-4" />
            Find
          </button>
        </form>

        {tokens.length > 0 &&
          (matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No student matches &ldquo;{q}&rdquo;.</p>
          ) : (
            <ul className="space-y-2">
              {matches.map(({ student, record }) => (
                <li key={student.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4">
                  <StudentPhoto student={student} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-[15px] font-semibold">
                        {student.first_name} {student.last_name}
                      </p>
                      {record ? (
                        <ToneBadge label={ID_STATUS_META[record.status].label} tone={ID_STATUS_META[record.status].tone} />
                      ) : (
                        <ToneBadge label="Not validated this term" tone="warning" />
                      )}
                    </div>
                    <StudentLine student={student} />
                  </div>
                  <div className="w-full sm:w-auto">
                    {!student.photo_url ? (
                      <p className="max-w-[260px] text-[12px] text-muted-foreground">
                        No profile photo on file. The student must add one before the ID can be validated.
                      </p>
                    ) : record ? (
                      DECISIONS[record.status].length > 0 ? (
                        <ReviewControls validationId={record.id} decisions={DECISIONS[record.status]} />
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Handed in on clearance.</p>
                      )
                    ) : (
                      <CounterValidateForm studentId={student.id} termLabel={term.label} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ))}
      </Section>

      <Section
        title="Requests from students"
        count={queueCount}
        note="Sent from the Digital ID page. The student still brings the card to the OSA for the sticker."
      >
        {queue.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="No requests waiting"
            description="Requests students send from their Digital ID page land here."
          />
        ) : (
          <ValidationList rows={queue} total={queueCount} />
        )}
      </Section>

      {flagged.length > 0 && (
        <Section title="Suspended & revoked" count={flaggedCount}>
          <ValidationList rows={flagged} total={flaggedCount} />
        </Section>
      )}

      <Section title="Validated this term" count={validatedCount}>
        {validated.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title="No IDs validated yet this term"
            description="Until an ID is validated here, that student's card is denied at every enforcing gate."
          />
        ) : (
          <ValidationList rows={validated} total={validatedCount} newestFirst />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {title}
        {count !== undefined && <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>}
      </h2>
      {note && <p className="mt-0.5 text-[13px] text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ValidationList({ rows, total, newestFirst }: { rows: ValidationRow[]; total: number; newestFirst?: boolean }) {
  return (
    <>
      <ul className="space-y-2">
        {rows.map((row) => (
          <ValidationCard key={row.id} row={row} />
        ))}
      </ul>
      {total > rows.length && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Showing the {newestFirst ? "most recent" : "first"} {rows.length} of {total}. Use the counter search above to
          find a particular student.
        </p>
      )}
    </>
  );
}

function StudentPhoto({ student }: { student: StudentSummary | null }) {
  return student?.photo_url ? (
    /* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */
    <img src={student.photo_url} alt="" className="h-16 w-[52px] shrink-0 rounded object-cover ring-1 ring-border" />
  ) : (
    <div className="grid h-16 w-[52px] shrink-0 place-items-center rounded bg-muted text-muted-foreground">
      <IdCard className="h-5 w-5" />
    </div>
  );
}

function StudentLine({ student }: { student: StudentSummary | null }) {
  return (
    <p className="font-mono text-[11px] text-muted-foreground">
      {student?.student_number ?? "—"}
      {student?.program ? ` · ${student.program}` : ""}
      {student?.year_level ? ` · ${student.year_level}` : ""}
    </p>
  );
}

function ValidationCard({ row }: { row: ValidationRow }) {
  const meta = ID_STATUS_META[row.status];
  const student = row.students;

  return (
    <li className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-4">
      <StudentPhoto student={student} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-[15px] font-semibold">
            {student ? `${student.first_name} ${student.last_name}` : "Unknown student"}
          </p>
          <ToneBadge label={meta.label} tone={meta.tone} />
        </div>
        <StudentLine student={student} />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Requested {formatManilaMonthDayTime(row.submitted_at)}
          {row.validated_at ? ` · validated ${formatManilaMonthDayTime(row.validated_at)}` : ""}
          {row.validation_sticker_number ? ` · sticker ${row.validation_sticker_number}` : ""}
        </p>
        {row.rejection_reason && (
          <p className="mt-1.5 rounded-md bg-muted p-2 text-[12px]">
            <strong>Noted:</strong> {row.rejection_reason}
          </p>
        )}
      </div>

      <div className="w-full sm:w-auto sm:max-w-[260px]">
        <ReviewControls validationId={row.id} decisions={DECISIONS[row.status]} />
      </div>
    </li>
  );
}
