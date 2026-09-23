"use client";

import { useState, useTransition } from "react";
import { Archive, BadgeCheck, Ban, Loader2, RotateCcw, ShieldX, X } from "lucide-react";
import { toast } from "sonner";

import { reviewIdValidation } from "@/app/staff/id-validation/actions";
import { Button } from "@/components/ui/button";

type Decision = "validate" | "reject" | "suspend" | "revoke" | "reinstate" | "surrender";

const NEEDS_REASON: Decision[] = ["reject", "suspend", "revoke"];

const DECISION_COPY: Record<Decision, { label: string; prompt: string }> = {
  validate: { label: "Validate", prompt: "" },
  reject: { label: "Reject", prompt: "Why can't this be validated? The student sees this." },
  suspend: { label: "Suspend", prompt: "Why is campus access being suspended?" },
  revoke: { label: "Revoke", prompt: "Why is this ID being revoked?" },
  reinstate: { label: "Reinstate", prompt: "" },
  surrender: { label: "Received on clearance", prompt: "" },
};

interface ReviewControlsProps {
  validationId: string;
  /** Which buttons make sense for the row's current status. */
  decisions: Decision[];
}

export function ReviewControls({ validationId, decisions }: ReviewControlsProps) {
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) =>
    startTransition(async () => {
      const result = await reviewIdValidation(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved. The student has been notified.");
      setPendingDecision(null);
    });

  // A decision that needs a reason (or a sticker number) opens a small form
  // rather than firing immediately — an irreversible status change should
  // never be one stray click away.
  if (pendingDecision) {
    const copy = DECISION_COPY[pendingDecision];
    return (
      <form action={submit} className="w-full space-y-2 rounded-lg border border-border p-3">
        <input type="hidden" name="validation_id" value={validationId} />
        <input type="hidden" name="decision" value={pendingDecision} />

        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">{copy.label}</p>
          <button
            type="button"
            onClick={() => setPendingDecision(null)}
            aria-label="Cancel"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {NEEDS_REASON.includes(pendingDecision) ? (
          <textarea
            name="reason"
            required
            rows={2}
            maxLength={500}
            placeholder={copy.prompt}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-tup-maroon-600 focus:outline-none"
          />
        ) : (
          <input
            name="sticker_number"
            maxLength={40}
            placeholder="Sticker number (optional)"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-tup-maroon-600 focus:outline-none"
          />
        )}

        <Button
          type="submit"
          size="sm"
          disabled={isPending}
          className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        >
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Confirm {copy.label.toLowerCase()}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {decisions.map((decision) => (
        <button
          key={decision}
          type="button"
          onClick={() => setPendingDecision(decision)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
            decision === "validate" || decision === "reinstate"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              : "border-border hover:bg-muted"
          }`}
        >
          <DecisionIcon decision={decision} />
          {DECISION_COPY[decision].label}
        </button>
      ))}
    </div>
  );
}

function DecisionIcon({ decision }: { decision: Decision }) {
  const className = "h-3 w-3";
  switch (decision) {
    case "validate":
      return <BadgeCheck className={className} />;
    case "reinstate":
      return <RotateCcw className={className} />;
    case "reject":
      return <X className={className} />;
    case "suspend":
      return <Ban className={className} />;
    case "revoke":
      return <ShieldX className={className} />;
    case "surrender":
      return <Archive className={className} />;
  }
}
