"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  extractMyDocument,
  registerAcademicDocument,
} from "@/app/(student)/records/actions";
import { Button } from "@/components/ui/button";
import { isPdfBytes } from "@/lib/documents/integrity";
import { DOCUMENT_TARGET, MAX_UPLOAD_BYTES, compressImage, formatBytes } from "@/lib/images/compress";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "academic-documents";
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
  const [reading, setReading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (formData: FormData) => {
    const chosen = formData.get("file");
    if (!(chosen instanceof File) || chosen.size === 0) {
      toast.error("Choose a file first.");
      return;
    }
    const picked = await asPdfIfItIsOne(chosen);
    if (!(ALLOWED as readonly string[]).includes(picked.type)) {
      toast.error("Upload a photo (JPG/PNG) or a PDF.");
      return;
    }

    setBusy(true);
    try {
      // Photos are shrunk to about 1.5 MB with every figure still legible;
      // PDFs go up as they are.
      const file = await compressImage(picked, DOCUMENT_TARGET);
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`That file is ${formatBytes(file.size)}; the limit is 5 MB. Upload a photo of it instead.`);
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

        // The upload is already safe at this point. Reading it is a bonus
        // step: if it fails or the student closes the tab, the document is
        // still in the queue for an officer to read by hand.
        if (result.documentId) {
          setReading(true);
          const extraction = await extractMyDocument(result.documentId);
          setReading(false);
          if (extraction.error) toast.message("Saved — the OSA will read it.", {
            description: extraction.error,
          });
          else toast.success(extraction.message ?? "Read.");
        }
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
          // .php: ERS hands out the rating slip as rating_slip_main.php, a PDF.
          accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.php"
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
        {reading ? "Reading your document…" : working ? "Uploading…" : "Upload document"}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2 lg:col-span-4">
        <FileUp className="mr-1 inline h-3 w-3" />
        Best: the file from ERS. For the COR, use Enrollment → Certificate of Registration. For the
        rating slip, open Grades → Student&apos;s Rating Slip, then Print → Save as PDF (its download
        button saves an empty file). A clear phone photo also works. Bring the Registrar-stamped
        copies when you validate your ID: the OSA checks them against this upload. Your file is
        private; only you and the OSA can open it.
      </p>
    </form>
  );
}

/**
 * ERS serves the rating slip from rating_slip_main.php, and a browser may
 * keep that name and give the file no PDF type. What makes it a PDF is its
 * first bytes, so those decide; the name and type are fixed to match.
 */
async function asPdfIfItIsOne(file: File): Promise<File> {
  if (file.type === "application/pdf" || file.type.startsWith("image/")) return file;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (!isPdfBytes(head)) return file;
  const name = `${file.name.replace(/\.[^.]*$/, "") || "document"}.pdf`;
  return new File([file], name, { type: "application/pdf", lastModified: file.lastModified });
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
