"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { registerAcademicDocument } from "@/app/(student)/records/actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "academic-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

interface DocumentUploadProps {
  /** Defaults for the term pickers, from the server's current term. */
  defaultSchoolYear: string;
  defaultSemester: string;
}

/**
 * Two-step upload: file to Storage, then a row through a Server Action.
 *
 * The browser client is used for the file itself so the bytes never pass
 * through the Next.js server — Supabase Storage enforces the same RLS on the
 * upload that the database enforces on the row.
 */
export function DocumentUpload({
  defaultSchoolYear,
  defaultSemester,
}: DocumentUploadProps) {
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (formData: FormData) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      toast.error("Choose a file first.");
      return;
    }
    if (!(ALLOWED as readonly string[]).includes(file.type)) {
      toast.error("Upload a photo (JPG/PNG) or a PDF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That file is larger than 10 MB. Try a photo instead of a scan.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You are signed out.");
        return;
      }

      const documentType = String(formData.get("document_type"));
      const schoolYear = String(formData.get("school_year"));
      const semester = String(formData.get("semester"));
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      // Folder = auth user id: that is exactly what the storage policy checks.
      const path = `${user.id}/${schoolYear}-${semester.replace(/\s+/g, "")}-${documentType}-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (uploadError) {
        toast.error("Upload failed. Check your connection and try again.");
        return;
      }

      startTransition(async () => {
        const result = await registerAcademicDocument({
          document_type: documentType as "certificate_of_registration" | "rating_slip" | "transcript",
          school_year: schoolYear,
          semester: semester as "1st Semester" | "2nd Semester" | "Summer",
          file_path: path,
          file_name: file.name.slice(0, 200),
          mime_type: file.type as (typeof ALLOWED)[number],
          file_size: file.size,
        });

        if (result.error) {
          toast.error(result.error);
          // Leave no orphan: the row failed, so the object shouldn't linger.
          await supabase.storage.from(BUCKET).remove([path]);
          return;
        }

        toast.success(result.message ?? "Uploaded.");
        formRef.current?.reset();
      });
    } finally {
      setBusy(false);
    }
  };

  const working = busy || isPending;

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="grid gap-3 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium">Document</span>
        <select name="document_type" defaultValue="rating_slip" className={inputClass}>
          <option value="rating_slip">Rating slip (grades)</option>
          <option value="certificate_of_registration">Certificate of Registration</option>
          <option value="transcript">Transcript of records</option>
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">School year</span>
        <input
          name="school_year"
          defaultValue={defaultSchoolYear}
          pattern="\d{4}-\d{4}"
          required
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">Semester</span>
        <select name="semester" defaultValue={defaultSemester} className={inputClass}>
          <option>1st Semester</option>
          <option>2nd Semester</option>
          <option>Summer</option>
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium">File</span>
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          required
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
        />
      </label>

      <Button
        type="submit"
        disabled={working}
        className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 sm:col-span-2 lg:col-span-4"
      >
        {working ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Upload className="mr-1.5 h-4 w-4" />
        )}
        {working ? "Uploading…" : "Upload document"}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2 lg:col-span-4">
        <FileUp className="mr-1 inline h-3 w-3" />
        A clear phone photo is fine. Your file is private — only you and the OSA officer
        verifying it can open it.
      </p>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
