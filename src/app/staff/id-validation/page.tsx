import type { Metadata } from "next";
import { BadgeCheck, Clock, IdCard, ShieldX } from "lucide-react";

import { ReviewControls } from "@/components/id-validation/review-controls";
import { EmptyState } from "@/components/osa/empty-state";
import { RestrictedNotice } from "@/components/osa/restricted-notice";
import { ToneBadge } from "@/components/osa/tone-badge";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { getCurrentTerm } from "@/lib/access/term";
import { getStaffContext } from "@/lib/osa/staff-context";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { ID_STATUS_META, type IdValidationStatus } from "@/types/osa";

export const metadata: Metadata = {
  title: "ID Validation",
};

export const revalidate = 15;

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
  students: {
    first_name: string;
    last_name: string;
    student_number: string;
    program: string | null;
    year_level: string | null;
    photo_url: string | null;
  } | null;
}

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * ID validation queue (requirement #5, and the switch behind the turnstiles).
 *
 * Validating a row here is what lets a card open a gate; suspending one stops
 * it at the next scan. That direct line to a physical door is why the actions
 * ask for a reason and notify the student rather than changing state quietly.
 */
export default async function StaffIdValidationPage() {
  const staff = await getStaffContext();
  if (!staff?.isOsa) {
    return (
      <RestrictedNotice
        title="ID Validation"
        audience="ID validation is handled by OSA officers and the OSA head. Ask an administrator if you need this queue."
      />
    );
  }

  const supabase = await createClient();
  const db = loose(supabase);
  const term = getCurrentTerm();

  const { data: rows } = await db
    .from("id_validations")
    .select(
      "id, status, school_year, semester, submitted_at, validated_at, expires_at, rejection_reason, validation_sticker_number, students(first_name, last_name, student_number, program, year_level, photo_url)",
    )
    .order("submitted_at", { ascending: true })
    .limit(200);

  const all = (rows as ValidationRow[] | null) ?? [];
  const currentTerm = all.filter(
    (row) => row.school_year === term.schoolYear && row.semester === term.semester,
  );

  const queue = currentTerm.filter((row) =>
    ["pending", "under_review", "rejected"].includes(row.status),
  );
  const flagged = all.filter((row) => ["suspended", "revoked"].includes(row.status));
  const validated = currentTerm.filter((row) => row.status === "validated");

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "ID Validation" }]}
        title="ID Validation"
        description={`Validated IDs open the campus turnstiles. ${term.label}.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatsCard
          label="Waiting for review"
          value={queue.length}
          icon={Clock}
          iconTone={queue.length > 0 ? "warn" : "neutral"}
        />
        <StatsCard
          label="Validated this term"
          value={validated.length}
          icon={BadgeCheck}
          iconTone="success"
        />
        <StatsCard
          label="Suspended / revoked"
          value={flagged.length}
          icon={ShieldX}
          iconTone={flagged.length > 0 ? "danger" : "neutral"}
        />
      </div>

      <Section title="Review queue" count={queue.length}>
        {queue.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="Nothing waiting"
            description="Requests students submit from their Digital ID page land here."
          />
        ) : (
          <ul className="space-y-2">
            {queue.map((row) => (
              <ValidationCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Section>

      {flagged.length > 0 && (
        <Section title="Suspended & revoked" count={flagged.length}>
          <ul className="space-y-2">
            {flagged.map((row) => (
              <ValidationCard key={row.id} row={row} />
            ))}
          </ul>
        </Section>
      )}

      <Section title="Validated this term" count={validated.length}>
        {validated.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title="No IDs validated yet this term"
            description="Until an ID is validated here, that student's card is denied at every enforcing gate."
          />
        ) : (
          <ul className="space-y-2">
            {validated.map((row) => (
              <ValidationCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">
        {title}
        <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function ValidationCard({ row }: { row: ValidationRow }) {
  const meta = ID_STATUS_META[row.status];
  const student = row.students;

  return (
    <li className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-4">
      {student?.photo_url ? (
        /* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */
        <img
          src={student.photo_url}
          alt=""
          className="h-16 w-[52px] shrink-0 rounded object-cover ring-1 ring-border"
        />
      ) : (
        <div className="grid h-16 w-[52px] shrink-0 place-items-center rounded bg-muted text-muted-foreground">
          <IdCard className="h-5 w-5" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-[15px] font-semibold">
            {student ? `${student.first_name} ${student.last_name}` : "Unknown student"}
          </p>
          <ToneBadge label={meta.label} tone={meta.tone} />
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          {student?.student_number ?? "—"}
          {student?.program ? ` · ${student.program}` : ""}
          {student?.year_level ? ` · ${student.year_level}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Requested {formatDate(row.submitted_at)}
          {row.validated_at ? ` · validated ${formatDate(row.validated_at)}` : ""}
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
