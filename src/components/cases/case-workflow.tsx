"use client";

import { useState, useTransition } from "react";
import { CalendarDotIcon as CalendarSearch, CheckIcon as Check, CircleNotchIcon as Loader2, PaperPlaneRightIcon as Send, SparkleIcon as Sparkles } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import {
  approveHearing,
  notifyStudentOfHearing,
  proposeHearingSlots,
  scheduleHearingFromProposal,
  updateCaseStatus,
} from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";
import { formatManila, formatManilaTime } from "@/lib/utils/time";
import { CASE_STATUSES, CASE_STATUS_META } from "@/types/osa";

export interface ProposalView {
  id: string;
  proposed_start: string;
  proposed_end: string;
  score: number;
  rationale: string | null;
  rank: number;
}

/** Runs the schedule cross-check (requirement #1). */
export function ProposeSlotsButton({ caseId }: { caseId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await proposeHearingSlots(caseId);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Slots proposed.");
        })
      }
    >
      {isPending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <CalendarSearch className="mr-1.5 h-4 w-4" />
      )}
      Find meeting times
    </Button>
  );
}

const HEARING_TYPES = [
  { value: "counselling", label: "Counselling (minor offense)" },
  { value: "conference", label: "Conference (major offense)" },
  { value: "mediation", label: "Mediation" },
  { value: "pic_hearing", label: "PIC hearing" },
  { value: "sdb_hearing", label: "SDB hearing" },
  { value: "follow_up", label: "Follow-up" },
] as const;

export function ProposalPicker({ proposals }: { proposals: ProposalView[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <ul className="space-y-2">
      {proposals.map((proposal) => {
        const isSelected = selected === proposal.id;

        return (
          <li key={proposal.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Campus time, not the viewer's: the meeting happens in Manila,
                    and the server prerender has to print the same thing. */}
                <p className="text-base font-medium">
                  {formatManila(proposal.proposed_start, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  {" · "}
                  {formatManilaTime(proposal.proposed_start)}
                  {" – "}
                  {formatManilaTime(proposal.proposed_end)}
                </p>
                {proposal.rationale && (
                  <p className="mt-0.5 flex items-start gap-1 text-sm text-ai-accent">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                    {proposal.rationale}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Fit {Math.round(proposal.score * 100)}%
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? "secondary" : "outline"}
                  onClick={() => setSelected(isSelected ? null : proposal.id)}
                >
                  {isSelected ? "Cancel" : "Use this time"}
                </Button>
              </div>
            </div>

            {isSelected && (
              <form
                action={(formData) =>
                  startTransition(async () => {
                    const result = await scheduleHearingFromProposal(formData);
                    if (result.error) toast.error(result.error);
                    else {
                      toast.success(result.message ?? "Scheduled.");
                      setSelected(null);
                    }
                  })
                }
                className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1.3fr_1fr_auto] sm:items-end"
              >
                <input type="hidden" name="proposal_id" value={proposal.id} />

                <label className="block space-y-1">
                  <span className="text-base font-medium">Meeting type</span>
                  <select name="hearing_type" defaultValue="conference" className={inputClass}>
                    {HEARING_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-base font-medium">Venue</span>
                  <input
                    name="venue"
                    defaultValue="OSA Office"
                    maxLength={120}
                    className={inputClass}
                  />
                </label>

                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Set this date
                </Button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The approval chain, one button at a time. The student can only be notified
 * after the complainant approves — so the notify button simply doesn't exist
 * until then, rather than failing when pressed.
 */
export function HearingActions({
  hearingId,
  status,
  canApprove,
  canNotify,
}: {
  hearingId: string;
  status: string;
  canApprove: boolean;
  canNotify: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (status === "awaiting_complainant" && canApprove) {
    return (
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await approveHearing(hearingId);
            if (result.error) toast.error(result.error);
            else toast.success(result.message ?? "Approved.");
          })
        }
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Check className="mr-1.5 h-4 w-4" />
        )}
        Approve this date
      </Button>
    );
  }

  if (status === "complainant_approved" && canNotify) {
    return (
      <Button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await notifyStudentOfHearing(hearingId);
            if (result.error) toast.error(result.error);
            else toast.success(result.message ?? "Summons sent.");
          })
        }
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-1.5 h-4 w-4" />
        )}
        Notify the student
      </Button>
    );
  }

  return null;
}

export function CaseStatusForm({
  caseId,
  currentStatus,
}: {
  caseId: string;
  currentStatus: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await updateCaseStatus(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Updated.");
        })
      }
      className="grid gap-3 sm:grid-cols-[minmax(12rem,16rem)_1fr] sm:items-end"
    >
      <input type="hidden" name="case_id" value={caseId} />

      <label className="block space-y-1">
        <span className="text-base font-medium">Move the case to</span>
        <select name="status" defaultValue={currentStatus} className={inputClass}>
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CASE_STATUS_META[status].label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-base font-medium">Note for the case file <span className="font-normal text-muted-foreground">(optional)</span></span>
        <textarea name="note" rows={1} maxLength={1000} className={inputClass} />
      </label>

      <Button
        type="submit"
        disabled={isPending}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 sm:col-span-2 sm:justify-self-start"
      >
        {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        Save the change
      </Button>
    </form>
  );
}

const inputClass =
  "w-full min-h-10 rounded-md border border-border bg-background px-3 py-2 text-base focus:border-tup-maroon-600 focus:outline-none focus:ring-3 focus:ring-tup-maroon-600/20";
