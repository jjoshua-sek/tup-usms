"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { recordConcern } from "@/app/staff/concerns/actions";
import { RECEIVED_VIA_LABEL, STAFF_RECEIVED_VIA, type ReceivedVia } from "@/lib/concerns/intake";
import { CONCERN_CATEGORIES } from "@/lib/validations/concern";
import { Button } from "@/components/ui/button";

/**
 * The OSA's side of the concern form (checklist D2, E1): for a student who
 * raised a concern at the counter, by letter or email, or through a faculty
 * member. It lands in the same queue, with the same AI summary, and the
 * student sees it in their portal.
 */
export function StaffConcernForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [via, setVia] = useState<ReceivedVia>("walk_in");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await recordConcern(formData);
      if (result.error || !result.concernId) {
        setError(result.error ?? "The concern was not saved.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success("Concern recorded.", {
        description: result.flagged
          ? "The student was also added to the At-Risk follow-up list as a guidance referral."
          : "It is in the queue, and the AI summary will appear in a few seconds.",
      });
      router.push(`/staff/concerns/${result.concernId}`);
    });
  };

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-md border border-border bg-card p-5 sm:p-6">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student number" error={fieldError("student_number")}>
          <input
            name="student_number"
            required
            placeholder="TUPM-23-0000"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>

        <Field label="How it reached the OSA" error={fieldError("received_via")}>
          <select
            name="received_via"
            value={via}
            onChange={(event) => setVia(event.target.value as ReceivedVia)}
            className={inputClass}
          >
            {STAFF_RECEIVED_VIA.map((value) => (
              <option key={value} value={value}>
                {RECEIVED_VIA_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {via === "faculty" && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
          <Field label="Referred by" error={fieldError("referred_by")}>
            <input name="referred_by" required maxLength={120} placeholder="e.g. Prof. Maria Santos, CIT" className={inputClass} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="follow_up" defaultChecked className="mt-0.5 accent-tup-maroon-600" />
            <span>
              Add the student to the At-Risk follow-up list
              <span className="block text-xs text-muted-foreground">
                Opens a recommended guidance referral on the Interventions page.
              </span>
            </span>
          </label>
        </div>
      )}

      <Field label="Category" error={fieldError("category")}>
        <select name="category" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select a category
          </option>
          {CONCERN_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Subject" error={fieldError("subject_line")}>
        <input name="subject_line" required minLength={5} maxLength={200} placeholder="One line the queue can show" className={inputClass} />
      </Field>

      <Field label="What the student told you (at least 20 characters)" error={fieldError("body_text")}>
        <textarea
          name="body_text"
          required
          minLength={20}
          maxLength={10000}
          rows={8}
          placeholder="In the student's own words where you can. For a letter or email, paste or summarize it."
          className={`${inputClass} min-h-[180px] resize-y`}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        <Button type="button" variant="ghost" onClick={() => router.push("/staff/concerns")} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          {pending ? "Saving…" : "Record concern"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
