"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Send, Upload } from "lucide-react";

import {
  concernSchema,
  CONCERN_CATEGORIES,
  type ConcernInput,
} from "@/lib/validations/concern";
import { submitConcern } from "@/app/(student)/concerns/actions";

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

const VISIBILITY_OPTIONS = [
  { value: "identified", label: "Identified (with my profile)" },
  { value: "anonymous", label: "Anonymous" },
] as const;

/**
 * Inline concern form for the /concerns/new page.
 *
 * Matches Screen 03 of the mockup:
 * - Category + Visibility on the same row
 * - Subject (full width)
 * - Body textarea (200px tall) with live character counter + auto-save timestamp
 * - Attachments dropzone (UI-only stub for now)
 * - Action row: Cancel, Save as Draft, Submit
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
    },
  });

  const bodyText = watch("body_text") || "";
  const subjectLine = watch("subject_line") || "";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > 10 * 1024 * 1024) {
      toast.error("Total attachment size cannot exceed 10 MB.");
      return;
    }
    setAttachments(files);
  };

  const onSubmit = (data: ConcernInput) => {
    setServerError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("category", data.category);
      formData.append("subject_line", data.subject_line);
      formData.append("body_text", data.body_text);

      const result = await submitConcern(formData);

      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }

      toast.success("Concern submitted! AI is analyzing it now.", {
        description: "You'll see the summary appear in a few seconds.",
      });

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

      {/* Row: Category + Visibility */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Category"
          required
          error={errors.category?.message}
        >
          <Select
            value={watch("category")}
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
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Visibility">
          <Select defaultValue="identified" disabled={isPending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

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
        helper="Markdown not supported · Auto-saves while you type"
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
              (optional, max 10MB total)
            </span>
          </>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={handleFileSelect}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
          className="w-full border-[1.5px] border-dashed border-border rounded-md p-6 text-center text-muted-foreground text-xs bg-accent hover:bg-muted transition-colors"
        >
          <Upload className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
          Drop files here or{" "}
          <span className="text-tup-maroon-600 font-medium underline-offset-2 hover:underline">
            browse
          </span>
          <div className="mt-1 text-[11px]">PDF, JPG, PNG · up to 10MB total</div>
        </button>
        {attachments.length > 0 && (
          <div className="mt-2 space-y-1">
            {attachments.map((file, i) => (
              <div
                key={i}
                className="flex justify-between items-center text-xs px-2.5 py-1.5 bg-muted rounded-md"
              >
                <span className="truncate">{file.name}</span>
                <span className="text-muted-foreground font-mono shrink-0 ml-2">
                  {Math.round(file.size / 1024)} KB
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
          type="button"
          variant="outline"
          disabled={isPending}
        >
          Save as Draft
        </Button>
        <Button
          type="submit"
          className="bg-tup-maroon-600 hover:bg-tup-maroon-700 text-white"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Submitting...
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
      <Label className="text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      <div className="flex justify-between items-baseline text-[11px] text-muted-foreground">
        <span>{helper}</span>
        {rightHint && <span className="tabular-nums">{rightHint}</span>}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
