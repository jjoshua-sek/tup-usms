"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  GraduationCap,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

import {
  profileStep3Schema,
  type ProfileStep3Input,
} from "@/lib/validations/profile";
import { saveProfileStep3 } from "@/app/(student)/profile/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface Step3AcademicProps {
  initialData?: Partial<ProfileStep3Input>;
  /** Admin-set fields shown as read-only */
  adminFields: {
    campus: string;
    department: string;
    program: string;
    year_level: string;
    section: string | null;
  };
  onComplete: () => void;
  onBack: () => void;
}

export function Step3Academic({
  initialData,
  adminFields,
  onComplete,
  onBack,
}: Step3AcademicProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileStep3Input>({
    resolver: zodResolver(profileStep3Schema),
    defaultValues: {
      lrn: initialData?.lrn ?? "",
      campus: adminFields.campus,
      department: adminFields.department,
      program: adminFields.program,
      year_level: adminFields.year_level as ProfileStep3Input["year_level"],
      section: adminFields.section ?? "",
    },
  });

  const onSubmit = (data: ProfileStep3Input) => {
    setServerError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("lrn", data.lrn || "");
      // Admin-set values are still re-sent so the audit trail is complete
      formData.append("campus", adminFields.campus);
      formData.append("department", adminFields.department);
      formData.append("program", adminFields.program);
      formData.append("year_level", adminFields.year_level);
      formData.append("section", adminFields.section || "");

      const result = await saveProfileStep3(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Academic info saved");
      onComplete();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          Academic Information
        </CardTitle>
        <CardDescription>
          Most academic fields are set by the Registrar&apos;s Office.
          You only need to confirm your LRN below.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {/* Read-only admin-set fields */}
          <div className="rounded-xl border-2 border-muted bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Set by the Registrar (read-only)
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ReadOnlyField label="Campus" value={adminFields.campus} />
              <ReadOnlyField label="Department" value={adminFields.department} />
              <ReadOnlyField label="Program" value={adminFields.program} />
              <ReadOnlyField label="Year Level" value={adminFields.year_level} />
              <ReadOnlyField
                label="Section"
                value={adminFields.section || "Not yet assigned"}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              If any of this is incorrect, please contact the{" "}
              <a
                href="mailto:registrar@tup.edu.ph"
                className="text-primary hover:underline"
              >
                Registrar&apos;s Office
              </a>
              .
            </p>
          </div>

          {/* Editable: LRN */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Learner Reference Number (LRN) — optional
            </Label>
            <Input
              {...register("lrn")}
              placeholder="123456789012"
              maxLength={12}
              disabled={isPending}
              className="font-mono"
            />
            {errors.lrn && (
              <p className="text-xs text-destructive">{errors.lrn.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              12-digit number issued by DepEd. Found on your high school records.
              Skip if you don&apos;t have one.
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onBack} disabled={isPending}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue to Step 4
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

interface ReadOnlyFieldProps {
  label: string;
  value: string;
}

function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <Badge variant="secondary" className="font-medium">
        {value}
      </Badge>
    </div>
  );
}
