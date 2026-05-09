"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2, Send, Sparkles } from "lucide-react";

import {
  concernSchema,
  CONCERN_CATEGORIES,
  type ConcernInput,
} from "@/lib/validations/concern";
import { submitConcern } from "@/app/(student)/concerns/actions";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

interface ConcernFormProps {
  trigger: React.ReactNode;
}

export function ConcernForm({ trigger }: ConcernFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

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
      setOpen(false);

      if (result.concernId) {
        // Navigate to the detail page so they see their concern
        router.push(`/concerns/${result.concernId}`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Sparkles className="h-5 w-5 text-primary" />
            Submit a Concern
          </DialogTitle>
          <DialogDescription>
            Describe your issue and our AI will help route it to the right
            department. Be specific so we can address it faster.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 py-2">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="category">
              Category <span className="text-destructive">*</span>
            </Label>
            <Select
              value={watch("category")}
              onValueChange={(value) =>
                setValue("category", value as (typeof CONCERN_CATEGORIES)[number], {
                  shouldValidate: true,
                })
              }
              disabled={isPending}
            >
              <SelectTrigger id="category">
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
            {errors.category && (
              <p className="text-xs text-destructive">{errors.category.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Choose the area that best describes your concern.
            </p>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="subject_line">
                Subject <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {subjectLine.length} / 200
              </span>
            </div>
            <Input
              id="subject_line"
              placeholder="e.g., Schedule conflict in IT 301 and IT 302"
              maxLength={200}
              disabled={isPending}
              {...register("subject_line")}
              className={errors.subject_line ? "border-destructive" : ""}
            />
            {errors.subject_line && (
              <p className="text-xs text-destructive">
                {errors.subject_line.message}
              </p>
            )}
          </div>

          {/* Body */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="body_text">
                Describe your concern <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {bodyText.length} / 10,000
              </span>
            </div>
            <Textarea
              id="body_text"
              placeholder="Be specific. Include dates, faculty names, course codes, and what outcome you're hoping for..."
              rows={8}
              maxLength={10000}
              disabled={isPending}
              {...register("body_text")}
              className={errors.body_text ? "border-destructive" : ""}
            />
            {errors.body_text && (
              <p className="text-xs text-destructive">
                {errors.body_text.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Our AI reads this to summarize for staff and assign urgency.
              The more context you provide, the better.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit Concern
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
