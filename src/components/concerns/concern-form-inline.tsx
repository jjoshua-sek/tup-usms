"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CircleNotchIcon as Loader2, PaperPlaneRightIcon as Send, UploadSimpleIcon as Upload, XIcon as X } from "@phosphor-icons/react/ssr";

import {
  concernCategoryLabel,
  concernSchema,
  CONCERN_CATEGORIES,
  type ConcernInput,
} from "@/lib/validations/concern";
import { attachConcernFiles, submitConcern } from "@/app/(student)/concerns/actions";
import {
  CONCERN_ATTACHMENT_BUCKET,
  CONCERN_ATTACHMENT_HINT,
  CONCERN_ATTACHMENT_TYPES,
  attachmentFileProblem,
  attachmentSetProblem,
  isConcernAttachmentType,
} from "@/lib/concerns/attachments";
import { DOCUMENT_TARGET, compressImage, formatBytes } from "@/lib/images/compress";
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Inline concern form for the /concerns/new page.
 *
 * Matches Screen 03 of the mockup:
 * - Category, beside a note on who sees the concern (always identified)
 * - Subject (full width)
 * - Body textarea (200px tall) with live character counter
 * - Attachments dropzone: photos are shrunk when picked, then uploaded into
 *   the concern's own folder once it has been filed (see uploadAttachments)
 * - Action row: Cancel, Submit
 *
 * The mockup's "Save as Draft" button and "Auto-saves while you type" note
 * were dropped: nothing stored a draft. A browser-side draft was not added
 * in their place because concerns can be personal (guidance, discipline)
 * and students often file from shared campus computers, where the text
 * would sit in storage for the next person to find.
 *
 * Differs from the dialog version by being page-embedded
 * (no Dialog wrapper, no trigger prop).
 */
export function ConcernFormInline() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ConcernInput>({
    resolver: zodResolver(concernSchema),
    defaultValues: {
      category: undefined,
      subject_line: "",
      body_text: "",
      respondent_name: "",
      respondent_details: "",
      incident_date: "",
      incident_location: "",
    },
  });

  const bodyText = watch("body_text") || "";
  const subjectLine = watch("subject_line") || "";
  // Checklist A3: a student may complain about another student.
  const isComplaint = watch("category") === "Complaint";

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Cleared so picking the same file again still fires onChange.
    e.target.value = "";
    if (picked.length === 0) return;

    setPreparing(true);
    try {
      const ready: File[] = [];
      for (const original of picked) {
        // Shrunk now rather than at submit, so the sizes listed and the limits
        // checked are those of what will actually be uploaded.
        const file = isConcernAttachmentType(original.type)
          ? await compressImage(original, DOCUMENT_TARGET)
          : original;
        const problem = attachmentFileProblem(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        ready.push(file);
      }
      const problem = attachmentSetProblem(ready);
      if (problem) {
        toast.error(problem);
        return;
      }
      setAttachments(ready);
    } finally {
      setPreparing(false);
    }
  };

  const onSubmit = (data: ConcernInput) => {
    setServerError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("category", data.category);
      formData.append("subject_line", data.subject_line);
      formData.append("body_text", data.body_text);
      if (data.category === "Complaint") {
        formData.append("respondent_name", data.respondent_name ?? "");
        formData.append("respondent_details", data.respondent_details ?? "");
        formData.append("incident_date", data.incident_date ?? "");
        formData.append("incident_location", data.incident_location ?? "");
      }

      const result = await submitConcern(formData);

      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }

      let attachProblem: string | null = null;
      if (result.concernId && attachments.length > 0) {
        setUploading(true);
        try {
          attachProblem = await uploadAttachments(result.concernId, attachments);
        } catch {
          attachProblem = "The connection dropped while your files were uploading.";
        } finally {
          setUploading(false);
        }
      }

      if (attachProblem) {
        // The concern itself is filed; say plainly that the files may not be.
        toast.warning("Concern submitted, but not every attachment made it.", {
          description: `${attachProblem} You can describe them in a reply on your concern.`,
          duration: 12000,
        });
      } else {
        toast.success("Concern submitted! AI is analyzing it now.", {
          description: "You'll see the summary appear in a few seconds.",
        });
      }

      reset();
      setAttachments([]);
      if (result.concernId) {
        router.push(`/concerns/${result.concernId}`);
      } else {
        router.push("/concerns");
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="bg-card border border-border rounded-md p-5 sm:p-6 space-y-5"
    >
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {/* Row: Category + who sees it */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Category"
          required
          error={errors.category?.message}
        >
          <Select
            value={watch("category") ?? ""}
            onValueChange={(v) =>
              v &&
              setValue("category", v as (typeof CONCERN_CATEGORIES)[number], {
                shouldValidate: true,
              })
            }
            disabled={isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {CONCERN_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {concernCategoryLabel(cat)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* There used to be an "Anonymous" choice here. Nothing ever sent it,
            so a student who picked it was still shown to staff by name. A
            concern is always identified: OSA follows up with the student,
            and staff can read student records regardless. Say so plainly
            rather than offer a promise the system cannot keep. */}
        <Field label="Who sees this">
          <p className="flex min-h-9 items-center rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground">
            OSA staff see your name and student details, so they can follow up with you.
          </p>
        </Field>
      </div>

      {isComplaint && (
        <div className="space-y-4 rounded-md border border-border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">
            A complaint against another student. The OSA reviews it and decides whether to file a case. If it does,
            the case names you only as &ldquo;a student&rdquo;, and you can follow it here in your concern.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Who is it against?" required error={errors.respondent_name?.message}>
              <Input
                placeholder="Their full name"
                maxLength={120}
                disabled={isPending}
                {...register("respondent_name")}
              />
            </Field>
            <Field label="Student number, program or section" helper="If you know it" error={errors.respondent_details?.message}>
              <Input
                placeholder="e.g. BSIT 3-A"
                maxLength={200}
                disabled={isPending}
                {...register("respondent_details")}
              />
            </Field>
            <Field label="When did it happen?" required error={errors.incident_date?.message}>
              <Input type="date" disabled={isPending} {...register("incident_date")} />
            </Field>
            <Field label="Where?" helper="Optional" error={errors.incident_location?.message}>
              <Input
                placeholder="e.g. IT building, 3rd floor"
                maxLength={120}
                disabled={isPending}
                {...register("incident_location")}
              />
            </Field>
          </div>
        </div>
      )}

      {/* Subject */}
      <Field
        label="Subject"
        required
        rightHint={`${subjectLine.length} / 200`}
        error={errors.subject_line?.message}
      >
        <Input
          placeholder="One-line summary of your concern"
          maxLength={200}
          disabled={isPending}
          {...register("subject_line")}
          className={errors.subject_line ? "border-destructive" : ""}
        />
      </Field>

      {/* Body */}
      <Field
        label={
          <>
            Describe your concern{" "}
            <span className="text-muted-foreground font-normal">
              (min. 20 characters)
            </span>
          </>
        }
        required
        rightHint={`${bodyText.length} / 10,000`}
        helper="Markdown not supported"
        error={errors.body_text?.message}
      >
        <Textarea
          placeholder={`Please describe your concern in detail. The more context you provide, the better staff can help you. You may write in English, Filipino, or Taglish.

Examples: schedule conflicts, guidance consultations, document requests, account issues, etc.`}
          rows={9}
          maxLength={10000}
          disabled={isPending}
          {...register("body_text")}
          className={`min-h-[200px] resize-y ${errors.body_text ? "border-destructive" : ""}`}
        />
      </Field>

      {/* Attachments */}
      <Field
        label={
          <>
            Attach files{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={CONCERN_ATTACHMENT_TYPES.join(",")}
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending || preparing}
          className="w-full border-[1.5px] border-dashed border-border rounded-md p-6 text-center text-muted-foreground text-sm bg-accent hover:bg-muted transition-colors"
        >
          {preparing ? (
            <>
              <Loader2 className="h-6 w-6 mx-auto mb-1.5 opacity-50 animate-spin" />
              Preparing files…
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
              Drop files here or{" "}
              <span className="text-tup-maroon-600 font-medium underline-offset-2 hover:underline">
                browse
              </span>
            </>
          )}
          <div className="mt-1 text-sm">{CONCERN_ATTACHMENT_HINT}</div>
          <div className="text-sm">
            Photos are shrunk before upload. Only you and OSA staff can open them.
          </div>
        </button>
        {attachments.length > 0 && (
          <div className="mt-2 space-y-1">
            {attachments.map((file, i) => (
              <div
                key={i}
                className="flex justify-between items-center text-sm px-2.5 py-1.5 bg-muted rounded-md"
              >
                <span className="truncate">{file.name}</span>
                <span className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-muted-foreground font-mono">
                    {formatBytes(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}
                    disabled={isPending}
                    aria-label={`Remove ${file.name}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Field>

      {/* Action row */}
      <div className="flex flex-wrap justify-end gap-2 pt-5 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/concerns")}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="bg-tup-maroon-600 hover:bg-tup-maroon-700 text-white"
          disabled={isPending || preparing}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              {uploading ? "Uploading files..." : "Submitting..."}
            </>
          ) : (
            <>
              <Send className="mr-1.5 h-4 w-4" />
              Submit Concern
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Uploads the files for a concern that has just been filed, then has the
 * server record them. Runs after the concern exists so the files can live in
 * its own folder (<auth uid>/<concern id>/) and be tied to it.
 *
 * Returns null when every file is attached, or what went wrong. Anything the
 * limits would refuse was already refused when the files were picked, so a
 * problem here is a dropped connection or a signed-out session.
 */
async function uploadAttachments(concernId: string, files: File[]): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "You were signed out before your files could upload.";

  const stamp = Date.now();
  const results = await Promise.all(
    files.map(async (file, index) => {
      // The extension comes from the type, not the name, which may have none.
      const path = `${user.id}/${concernId}/${index + 1}-${stamp}.${EXTENSIONS[file.type] ?? "bin"}`;
      const { error } = await supabase.storage
        .from(CONCERN_ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      return { path, name: file.name, ok: !error };
    }),
  );

  const uploaded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  if (uploaded.length > 0) {
    const attached = await attachConcernFiles(
      concernId,
      uploaded.map(({ path, name }) => ({ path, name })),
    );
    if (attached.error) return attached.error;
  }
  if (failed.length > 0) {
    return `${failed.map((result) => result.name).join(", ")} could not be uploaded.`;
  }
  return null;
}

interface FieldProps {
  label: React.ReactNode;
  required?: boolean;
  helper?: string;
  rightHint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, helper, rightHint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      <div className="flex justify-between items-baseline text-sm text-muted-foreground">
        <span>{helper}</span>
        {rightHint && <span className="tabular-nums">{rightHint}</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
