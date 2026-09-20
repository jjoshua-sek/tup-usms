"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, PenLine, Send, Upload } from "lucide-react";
import { toast } from "sonner";

import { submitApologyLetter } from "@/app/(student)/violations/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "case-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

interface ApologyLetterPanelProps {
  caseId: string;
  caseNumber: string;
}

/**
 * The student's side of the MINOR-offense close-out.
 *
 * Most students have never written one of these, so the prompts do real work:
 * the three bullets below are what OSA officers say they look for, spelled
 * out rather than left as "write an apology letter" and a blank box.
 *
 * The scan (if any) goes browser → Storage directly; only its path travels
 * through the Server Action.
 */
export function ApologyLetterPanel({ caseId, caseNumber }: ApologyLetterPanelProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (formData: FormData) => {
    const file = formData.get("file");
    let filePath = "";

    setBusy(true);
    try {
      if (file instanceof File && file.size > 0) {
        if (!(ALLOWED as readonly string[]).includes(file.type)) {
          toast.error("Attach a photo (JPG/PNG) or a PDF.");
          return;
        }
        if (file.size > MAX_BYTES) {
          toast.error("That file is larger than 10 MB. A phone photo is fine.");
          return;
        }

        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          toast.error("You are signed out.");
          return;
        }

        const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        // Folder = auth user id, which is what the storage policy checks.
        const path = `${user.id}/${caseId}-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { cacheControl: "3600", upsert: false });

        if (uploadError) {
          toast.error("Could not upload that file. Check your connection.");
          return;
        }
        filePath = path;
      }

      const payload = new FormData();
      payload.set("case_id", caseId);
      payload.set("letter_text", String(formData.get("letter_text") ?? ""));
      payload.set("file_path", filePath);

      startTransition(async () => {
        const result = await submitApologyLetter(payload);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(result.message ?? "Submitted.");
        formRef.current?.reset();
        setOpen(false);
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
      >
        <PenLine className="mr-1.5 h-3.5 w-3.5" />
        Write my apology letter
      </Button>
    );
  }

  const working = busy || isPending;

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="mt-3 space-y-3 rounded-lg border border-border p-4"
    >
      <div>
        <p className="text-[13px] font-semibold">Apology letter for {caseNumber}</p>
        <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-[12px] text-muted-foreground">
          <li>Say what happened, in your own words — no need for formal language.</li>
          <li>Acknowledge who was affected and how.</li>
          <li>Say what you will do differently. This is the part that matters most.</li>
        </ul>
      </div>

      <textarea
        name="letter_text"
        rows={8}
        maxLength={5000}
        placeholder={`Dear Office of Student Affairs,\n\nI am writing regarding…`}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:border-tup-maroon-600 focus:outline-none"
      />

      <label className="block space-y-1">
        <span className="text-xs font-medium">
          Signed copy <span className="text-muted-foreground">(optional)</span>
        </span>
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
        />
        <span className="block text-[11px] text-muted-foreground">
          <Upload className="mr-1 inline h-3 w-3" />
          If the OSA asked for a signed hard copy, photograph it and attach it here. You can
          still type the text above as well.
        </span>
      </label>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={working}
          className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        >
          {working ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Submit letter
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Once submitted you can&apos;t edit it — the OSA reads the version you send. If they
        ask for changes, you&apos;ll be able to submit a revised letter here.
      </p>
    </form>
  );
}
