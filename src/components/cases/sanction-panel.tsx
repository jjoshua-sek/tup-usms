"use client";

import { useState, useTransition } from "react";
import {
  CalendarPlus,
  Gavel,
  HardHat,
  Loader2,
  Scale,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  assignCommunityService,
  getMinorOffenseCounts,
  openAppealWindow,
  recordAppealOutcome,
  recordNonAppearance,
  recordServiceProgress,
  scheduleHearingManually,
  type OffenseCounts,
} from "@/app/staff/cases/sanction-actions";
import { Button } from "@/components/ui/button";
import {
  COUNT_BASIS_LABELS,
  PENALTY_BASES,
  prescribeMinorSanction,
  resolveAppealRoute,
  type CountBasis,
  type PenaltyBasis,
} from "@/lib/osa/sanctions";

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none";

function Header({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold">{title}</p>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Assigns community service for a repeat minor offense.
 *
 * Opening the form loads the student's prior-offense count four ways, because
 * the handbook prescribes sanctions by offense number but never says over what
 * period to count. The officer picks the reading, and it is stored with the
 * assignment — so a later reviewer sees which rule was applied, not just the
 * hours.
 */
export function CommunityServiceForm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<OffenseCounts | null>(null);
  const [basis, setBasis] = useState<CountBasis>("cumulative");
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const openForm = () => {
    setOpen(true);
    setLoading(true);
    void getMinorOffenseCounts(caseId).then((result) => {
      setLoading(false);
      if (result.counts) setCounts(result.counts);
      else if (result.error) toast.error(result.error);
    });
  };

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={openForm}>
        <HardHat className="mr-1.5 h-3.5 w-3.5" />
        Assign community service
      </Button>
    );
  }

  const sequence = counts?.suggested[basisKey(basis)] ?? 2;
  const prescribed = prescribeMinorSanction(sequence);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await assignCommunityService(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Assigned.");
          setOpen(false);
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="case_id" value={caseId} />
      <input type="hidden" name="count_basis" value={basis} />
      <input type="hidden" name="offense_sequence" value={sequence} />
      <Header title="Community service" onCancel={() => setOpen(false)} />

      {loading ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Counting prior offenses…
        </p>
      ) : (
        <>
          <div>
            <p className="mb-1 text-[11px] font-medium">
              Count prior minor offenses as
            </p>
            <div className="space-y-1">
              {(Object.keys(COUNT_BASIS_LABELS) as CountBasis[]).map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <input
                    type="radio"
                    name="basis_choice"
                    checked={basis === option}
                    onChange={() => setBasis(option)}
                    className="h-3 w-3"
                  />
                  <span>
                    {COUNT_BASIS_LABELS[option]} —{" "}
                    <span className="font-mono">
                      {counts ? counts[basisKey(option)] : 0} prior
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              The handbook doesn&apos;t say which period applies. Whichever you pick is
              recorded with the assignment.
            </p>
          </div>

          <p className="rounded-md bg-muted p-2 text-[11px]">
            <strong>Offense no. {sequence}</strong> → {prescribed.label}
            <span className="block text-[10px] text-muted-foreground">
              {prescribed.handbookReference}
              {prescribed.note ? ` · ${prescribed.note}` : ""}
            </span>
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium">
                Hours{" "}
                {prescribed.bandMin != null && (
                  <span className="text-muted-foreground">
                    ({prescribed.bandMin}–{prescribed.bandMax})
                  </span>
                )}
              </span>
              <input
                name="hours_required"
                type="number"
                min={1}
                max={200}
                required
                defaultValue={prescribed.suggestedHours ?? 15}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium">Complete by</span>
              <input type="date" name="deadline" className={inputClass} />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium">What and where</span>
            <input
              name="service_detail"
              maxLength={500}
              placeholder="e.g. library shelving, weekday afternoons, report to Ms. Reyes"
              className={inputClass}
            />
          </label>

          <Button
            type="submit"
            size="sm"
            disabled={isPending}
            className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Assign and notify the student
          </Button>
        </>
      )}
    </form>
  );
}

function basisKey(basis: CountBasis): keyof Omit<OffenseCounts, "suggested"> {
  switch (basis) {
    case "school_year":
      return "schoolYear";
    case "term":
      return "term";
    case "same_offense":
      return "sameOffense";
    default:
      return "cumulative";
  }
}

export function ServiceProgressForm({
  assignmentId,
  hoursRequired,
  hoursCompleted,
}: {
  assignmentId: string;
  hoursRequired: number;
  hoursCompleted: number;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordServiceProgress(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Recorded.");
        })
      }
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2"
    >
      <input type="hidden" name="assignment_id" value={assignmentId} />

      <label className="block space-y-1">
        <span className="text-[10px] font-medium">Hours served of {hoursRequired}</span>
        <input
          name="hours_completed"
          type="number"
          step="0.5"
          min={0}
          max={500}
          defaultValue={hoursCompleted}
          className={`${inputClass} w-24`}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-medium">Verified by</span>
        <input
          name="verifier_role"
          maxLength={120}
          placeholder="Office or person signing off"
          className={`${inputClass} min-w-[150px]`}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-medium">Mark as</span>
        <select name="mark" defaultValue="progress" className={inputClass}>
          <option value="progress">Progress only</option>
          <option value="completed">Completed</option>
          <option value="not_served">Not served</option>
          <option value="waived">Waived</option>
        </select>
      </label>

      <input
        name="notes"
        maxLength={500}
        placeholder="Note (optional)"
        className={`${inputClass} min-w-[140px] flex-1`}
      />

      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Record
      </Button>
    </form>
  );
}

/** Sec. 7.7 — noted, and the proceeding continues ex-parte. */
export function NonAppearanceForm({ hearingId }: { hearingId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
      >
        <UserX className="h-3 w-3" />
        Did not appear
      </button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordNonAppearance(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Recorded.");
          setOpen(false);
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="hearing_id" value={hearingId} />
      <Header title="Non-appearance" onCancel={() => setOpen(false)} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Who did not appear</span>
          <select name="party" defaultValue="student" className={inputClass}>
            <option value="student">The student</option>
            <option value="complainant">The complainant</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Then</span>
          <select name="proceeded" defaultValue="ex_parte" className={inputClass}>
            <option value="ex_parte">Proceeded ex-parte (Sec. 7.7)</option>
            <option value="reset">Reset — justifiable cause shown</option>
          </select>
        </label>
      </div>

      <input
        name="notes"
        maxLength={500}
        placeholder="What was noted (optional)"
        className={inputClass}
      />

      <p className="text-[10px] text-muted-foreground">
        Where a party fails to appear after due notice and without justifiable cause, the
        handbook has the fact noted and the proceeding continue ex-parte.
      </p>

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-full">
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Record
      </Button>
    </form>
  );
}

/** Used when the slot finder returns nothing inside its horizon. */
export function ManualHearingForm({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />
        Book by hand
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await scheduleHearingManually(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Booked.");
          setOpen(false);
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="case_id" value={caseId} />
      <Header title="Book a meeting by hand" onCancel={() => setOpen(false)} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Date and time</span>
          <input type="datetime-local" name="scheduled_start" required className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Minutes</span>
          <input
            name="duration_minutes"
            type="number"
            min={15}
            max={480}
            defaultValue={45}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Type</span>
          <select name="hearing_type" defaultValue="conference" className={inputClass}>
            <option value="counselling">Counselling</option>
            <option value="conference">Conference</option>
            <option value="mediation">Mediation</option>
            <option value="pic_hearing">Preliminary inquiry</option>
            <option value="sdb_hearing">Tribunal hearing</option>
            <option value="follow_up">Follow-up</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Venue</span>
          <input name="venue" defaultValue="OSA Office" maxLength={120} className={inputClass} />
        </label>
      </div>

      <input
        name="reason"
        maxLength={300}
        placeholder="Why by hand? e.g. no mutually free slot in the horizon"
        className={inputClass}
      />

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Book — complainant still approves
      </Button>
    </form>
  );
}

// ============================================================
// Appeals
// ============================================================

const PENALTY_LABELS: Record<PenaltyBasis, string> = {
  suspension_up_to_30_days: "Suspension of up to 30 days",
  suspension_one_semester: "Suspension for one semester",
  dismissal_or_expulsion: "Dismissal or expulsion",
  other: "Other penalty",
};

export function AppealWindowForm({
  caseId,
  escalationId,
  suggestedBasis,
}: {
  caseId: string;
  escalationId?: string | null;
  suggestedBasis: PenaltyBasis;
}) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<PenaltyBasis>(suggestedBasis);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Scale className="mr-1.5 h-3.5 w-3.5" />
        Record the appeal window
      </Button>
    );
  }

  const route = resolveAppealRoute(basis);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await openAppealWindow(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Recorded.");
          setOpen(false);
        })
      }
      className="w-full space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="case_id" value={caseId} />
      {escalationId && <input type="hidden" name="escalation_id" value={escalationId} />}
      <Header title="Appeal window" onCancel={() => setOpen(false)} />

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Penalty imposed</span>
        <select
          name="penalty_basis"
          value={basis}
          onChange={(event) => setBasis(event.target.value as PenaltyBasis)}
          className={inputClass}
        >
          {PENALTY_BASES.map((option) => (
            <option key={option} value={option}>
              {PENALTY_LABELS[option]}
            </option>
          ))}
        </select>
      </label>

      <p className="rounded-md bg-muted p-2 text-[11px]">
        Appealable to the <strong>{route.bodyLabel}</strong> within {route.days} days of the
        student&apos;s receipt of the Notice of Decision.
        <span className="block text-[10px] text-muted-foreground">
          {route.handbookReference}
          {route.furtherRecourse ? ` · ${route.furtherRecourse}` : ""}
        </span>
      </p>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Notice of Decision received on</span>
        <input type="date" name="notice_received_on" required className={inputClass} />
        <span className="block text-[10px] text-muted-foreground">
          The clock runs from receipt, not from the date of the decision.
        </span>
      </label>

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Record and tell the student
      </Button>
    </form>
  );
}

export function AppealOutcomeForm({ appealId }: { appealId: string }) {
  const [status, setStatus] = useState("filed");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordAppealOutcome(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Saved.");
        })
      }
      className="mt-2 space-y-2 border-t border-border pt-2"
    >
      <input type="hidden" name="appeal_id" value={appealId} />

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium">Status</span>
          <select
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={inputClass}
          >
            <option value="filed">Appeal filed</option>
            <option value="decided">Decided</option>
            <option value="lapsed">Window lapsed, no appeal</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </label>

        {status === "filed" && (
          <label className="block space-y-1">
            <span className="text-[10px] font-medium">Filed on</span>
            <input type="date" name="filed_on" className={inputClass} />
          </label>
        )}

        {status === "decided" && (
          <>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium">Decision</span>
              <select name="outcome" defaultValue="upheld" className={inputClass}>
                <option value="upheld">Upheld</option>
                <option value="modified">Modified</option>
                <option value="reversed">Reversed</option>
                <option value="remanded">Remanded</option>
                <option value="dismissed">Appeal dismissed</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium">Decided on</span>
              <input type="date" name="decided_on" className={inputClass} />
            </label>
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          name="outcome_notes"
          maxLength={1000}
          placeholder="Notes from the appellate office (optional)"
          className={inputClass}
        />
        <input
          name="external_reference"
          maxLength={80}
          placeholder="Their reference no."
          className={inputClass}
        />
      </div>

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-full">
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        <Gavel className="mr-1.5 h-3.5 w-3.5" />
        Save appeal record
      </Button>
    </form>
  );
}
