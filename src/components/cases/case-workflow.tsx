"use client";

import { useState, useTransition } from "react";
import { CalendarSearch, Check, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  approveHearing,
  notifyStudentOfHearing,
  proposeHearingSlots,
  scheduleHearingFromProposal,
  updateCaseStatus,
} from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";
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
        const start = new Date(proposal.proposed_start);
        const end = new Date(proposal.proposed_end);
        const isSelected = selected === proposal.id;

        return (
          <li key={proposal.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">
                  {start.toLocaleDateString("en-PH", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                  {" · "}
                  {start.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                  {" – "}
                  {end.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                </p>
                {proposal.rationale && (
                  <p className="mt-0.5 flex items-start gap-1 text-[11px] text-ai-accent">
                    <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                    {proposal.rationale}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  score {proposal.score.toFixed(2)}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? "secondary" : "outline"}
                  onClick={() => setSelected(isSelected ? null : proposal.id)}
                >
                  {isSelected ? "Cancel" : "Use this slot"}
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
                  <span className="text-[11px] font-medium">Meeting type</span>
                  <select name="hearing_type" defaultValue="conference" className={inputClass}>
                    {HEARING_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium">Venue</span>
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
                  Reserve
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
        size="sm"
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
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="mr-1.5 h-3.5 w-3.5" />
        )}
        Approve this date
      </Button>
    );
  }

  if (status === "complainant_approved" && canNotify) {
    return (
      <Button
        type="button"
        size="sm"
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
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="mr-1.5 h-3.5 w-3.5" />
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
      className="space-y-2"
    >
      <input type="hidden" name="case_id" value={caseId} />

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Move case to</span>
        <select name="status" defaultValue={currentStatus} className={inputClass}>
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CASE_STATUS_META[status].label}
            </option>
          ))}
        </select>
      </label>

      <textarea
        name="note"
        rows={2}
        maxLength={1000}
        placeholder="Note for the case file (optional)"
        className={inputClass}
      />

      <Button type="submit" size="sm" variant="outline" disabled={isPending} className="w-full">
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Save
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
