"use client";

import { useState, useTransition } from "react";
import { FileTextIcon as FileText, CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { fileAppeal } from "@/app/(student)/violations/actions";
import { Button } from "@/components/ui/button";
import { MAX_APPEAL_GROUNDS, MIN_APPEAL_GROUNDS } from "@/lib/osa/appeal-filing";

/** The student files their appeal with the OSA, which forwards it (checklist B5). */
export function FileAppealForm({ appealId, bodyLabel }: { appealId: string; bodyLabel: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)} className="mt-2 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
        <FileText className="mr-1.5 h-3.5 w-3.5" /> File an appeal
      </Button>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await fileAppeal(formData);
          if (result.error) toast.error(result.error);
          else {
            toast.success(result.message ?? "Appeal filed.");
            setOpen(false);
          }
        })
      }
      className="mt-2 space-y-2"
    >
      <input type="hidden" name="appeal_id" value={appealId} />
      <label htmlFor={`grounds-${appealId}`} className="block text-[12px] font-medium text-amber-950 dark:text-amber-100">
        Why should the decision be changed?
      </label>
      <textarea
        id={`grounds-${appealId}`}
        name="grounds"
        required
        minLength={MIN_APPEAL_GROUNDS}
        maxLength={MAX_APPEAL_GROUNDS}
        rows={6}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="State what you believe is wrong with the decision, and any facts or evidence the committee did not consider."
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none"
      />
      <p className="text-[11px] text-muted-foreground">
        {text.trim().length < MIN_APPEAL_GROUNDS
          ? `At least ${MIN_APPEAL_GROUNDS} characters (${text.trim().length} so far).`
          : `The OSA forwards this to the ${bodyLabel}, which decides it.`}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          File with the OSA
        </Button>
      </div>
    </form>
  );
}
