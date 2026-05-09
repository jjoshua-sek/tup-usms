"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, ArrowLeft, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  profileStep2Schema,
  type ProfileStep2Input,
} from "@/lib/validations/profile";

type Step2FormInput = z.input<typeof profileStep2Schema>;
import { saveProfileStep2 } from "@/app/(student)/profile/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Step2FamilyProps {
  initialData?: Partial<ProfileStep2Input>;
  onComplete: () => void;
  onBack: () => void;
}

const FINANCIAL_SUPPORT = [
  "Self-supporting",
  "Parent/Guardian",
  "Scholarship",
  "Working Student",
  "Other",
] as const;

export function Step2Family({ initialData, onComplete, onBack }: Step2FamilyProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<Step2FormInput, unknown, ProfileStep2Input>({
    resolver: zodResolver(profileStep2Schema),
    defaultValues: {
      financial_support: initialData?.financial_support,
      sponsor_name: initialData?.sponsor_name ?? "",
      is_indigenous: initialData?.is_indigenous ?? false,
      is_pwd: initialData?.is_pwd ?? false,
      is_listahan: initialData?.is_listahan ?? false,
    },
  });

  const onSubmit = (data: ProfileStep2Input) => {
    setServerError(null);
    startTransition(async () => {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });

      const result = await saveProfileStep2(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Family info saved");
      onComplete();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Family Background
        </CardTitle>
        <CardDescription>
          Optional fields for scholarship eligibility, accessibility
          accommodations, and government program matching.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {/* Financial support */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Source of Financial Support</Label>
              <Select
                value={watch("financial_support")}
                onValueChange={(v) =>
                  v &&
                  setValue("financial_support", v as (typeof FINANCIAL_SUPPORT)[number])
                }
                disabled={isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {FINANCIAL_SUPPORT.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.financial_support && (
                <p className="text-xs text-destructive">
                  {errors.financial_support.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Sponsor / Guardian Name</Label>
              <Input
                {...register("sponsor_name")}
                disabled={isPending}
                placeholder="If applicable"
              />
              {errors.sponsor_name && (
                <p className="text-xs text-destructive">
                  {errors.sponsor_name.message}
                </p>
              )}
            </div>
          </div>

          {/* Beneficiary statuses */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Beneficiary Status
            </p>
            <p className="text-xs text-muted-foreground">
              Check any that apply. These help us match you with eligible
              scholarships and accessibility accommodations.
            </p>

            <BeneficiaryCheckbox
              id="is_indigenous"
              label="Indigenous Peoples (IP) member"
              description="Recognized by NCIP"
              checked={!!watch("is_indigenous")}
              onChange={(v) => setValue("is_indigenous", v)}
              disabled={isPending}
            />
            <BeneficiaryCheckbox
              id="is_pwd"
              label="Person with Disability (PWD)"
              description="Eligible for accessibility accommodations and PWD scholarships"
              checked={!!watch("is_pwd")}
              onChange={(v) => setValue("is_pwd", v)}
              disabled={isPending}
            />
            <BeneficiaryCheckbox
              id="is_listahan"
              label="Listahanan (DSWD low-income beneficiary)"
              description="Eligible for tuition assistance programs"
              checked={!!watch("is_listahan")}
              onChange={(v) => setValue("is_listahan", v)}
              disabled={isPending}
            />
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
                  Continue to Step 3
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

interface BeneficiaryCheckboxProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

function BeneficiaryCheckbox({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: BeneficiaryCheckboxProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        disabled={disabled}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex-1 cursor-pointer select-none space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </label>
    </div>
  );
}
