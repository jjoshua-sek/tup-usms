"use client";

import { useState, useTransition } from "react";
import { Check, Handshake, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  draftSettlement,
  recordSettlementCompliance,
  recordSettlementSignature,
} from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";

export function DraftSettlementForm({
  caseId,
  hearings,
}: {
  caseId: string;
  hearings: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Handshake className="mr-1.5 h-3.5 w-3.5" />
        Draft a settlement
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await draftSettlement(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Drafted.");
          setOpen(false);
        })
      }
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <input type="hidden" name="case_id" value={caseId} />

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Settlement terms</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {hearings.length > 0 && (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium">Reached at (optional)</span>
          <select name="hearing_id" defaultValue="" className={inputClass}>
            <option value="">Not tied to a specific meeting</option>
            {hearings.map((hearing) => (
              <option key={hearing.id} value={hearing.id}>
                {hearing.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">What both sides agreed to</span>
        <textarea
          name="terms"
          required
          rows={4}
          minLength={20}
          maxLength={4000}
          placeholder="Write it as both parties would read it back: what was acknowledged, and what each side agreed to do."
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">What the student must do</span>
        <textarea
          name="student_obligations"
          rows={2}
          maxLength={2000}
          placeholder="e.g. 8 hours community service at the library; written apology to the class"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Complete by</span>
        <input type="date" name="compliance_deadline" className={inputClass} />
      </label>

      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        className="w-full bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Save and ask the student to sign
      </Button>
    </form>
  );
}

export function SettlementSignature({
  settlementId,
  party,
  label,
}: {
  settlementId: string;
  party: "complainant" | "osa";
  label: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordSettlementSignature(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Recorded.");
        })
      }
      className="inline"
    >
      <input type="hidden" name="settlement_id" value={settlementId} />
      <input type="hidden" name="party" value={party} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Check className="h-3 w-3" />
        )}
        {label}
      </button>
    </form>
  );
}

export function ComplianceForm({ settlementId }: { settlementId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await recordSettlementCompliance(formData);
          if (result.error) toast.error(result.error);
          else toast.success(result.message ?? "Recorded.");
        })
      }
      className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-2"
    >
      <input type="hidden" name="settlement_id" value={settlementId} />

      <label className="block space-y-1">
        <span className="text-[11px] font-medium">Obligations met?</span>
        <select name="complied" defaultValue="yes" className={inputClass}>
          <option value="yes">Yes — close the case</option>
          <option value="no">Not yet</option>
        </select>
      </label>

      <input
        name="notes"
        maxLength={1000}
        placeholder="Note for the case file (optional)"
        className={`${inputClass} min-w-[160px] flex-1`}
      />

      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Record
      </Button>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:border-tup-maroon-600 focus:outline-none";
