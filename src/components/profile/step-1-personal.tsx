"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  profileStep1Schema,
  type ProfileStep1Input,
} from "@/lib/validations/profile";

// react-hook-form needs the INPUT type (pre-default) for form state,
// but we cast to OUTPUT type (post-default) on submit.
type Step1FormInput = z.input<typeof profileStep1Schema>;
import { saveProfileStep1 } from "@/app/(student)/profile/actions";

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
import { Separator } from "@/components/ui/separator";

import { DpaConsentDialog } from "./dpa-consent-dialog";

interface Step1PersonalProps {
  initialData?: Partial<ProfileStep1Input>;
  defaultEmail?: string;
  onComplete: () => void;
}

const GENDERS = ["Male", "Female", "Other", "Prefer not to say"] as const;
const CIVIL_STATUSES = ["Single", "Married", "Widowed", "Separated"] as const;

export function Step1Personal({
  initialData,
  defaultEmail,
  onComplete,
}: Step1PersonalProps) {
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<Step1FormInput, unknown, ProfileStep1Input>({
    resolver: zodResolver(profileStep1Schema),
    defaultValues: {
      last_name: initialData?.last_name ?? "",
      first_name: initialData?.first_name ?? "",
      middle_name: initialData?.middle_name ?? "",
      name_extension: initialData?.name_extension ?? "",
      birth_date: initialData?.birth_date ?? "",
      birth_place: initialData?.birth_place ?? "",
      gender: initialData?.gender,
      citizenship: initialData?.citizenship ?? "FILIPINO",
      religion: initialData?.religion ?? "",
      civil_status: initialData?.civil_status ?? "",
      cellphone: initialData?.cellphone ?? "",
      email_address: initialData?.email_address ?? defaultEmail ?? "",
      address_unit: initialData?.address_unit ?? "",
      address_street: initialData?.address_street ?? "",
      address_barangay: initialData?.address_barangay ?? "",
      address_city: initialData?.address_city ?? "",
      address_province: initialData?.address_province ?? "",
      address_zip: initialData?.address_zip ?? "",
      congressional_district: initialData?.congressional_district ?? "",
      dpa_consent: initialData?.dpa_consent ?? (false as unknown as true),
    },
  });

  const dpaConsent = watch("dpa_consent");

  const onSubmit = (data: ProfileStep1Input) => {
    setServerError(null);
    startTransition(async () => {
      const formData = new FormData();
      // Serialize all fields
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      });

      const result = await saveProfileStep1(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Personal info saved");
      onComplete();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Personal Information</CardTitle>
        <CardDescription>
          Tell us about yourself. This information appears on your student ID
          and academic records.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {/* Name */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Full Name
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Last Name" required error={errors.last_name?.message}>
                <Input {...register("last_name")} disabled={isPending} />
              </Field>
              <Field label="First Name" required error={errors.first_name?.message}>
                <Input {...register("first_name")} disabled={isPending} />
              </Field>
              <Field label="Middle Name" error={errors.middle_name?.message}>
                <Input {...register("middle_name")} disabled={isPending} />
              </Field>
              <Field label="Extension (Jr., III, etc.)" error={errors.name_extension?.message}>
                <Input {...register("name_extension")} disabled={isPending} />
              </Field>
            </div>
          </div>

          <Separator />

          {/* Personal details */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Personal Details
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Birth Date" required error={errors.birth_date?.message}>
                <Input type="date" {...register("birth_date")} disabled={isPending} />
              </Field>
              <Field label="Birth Place" error={errors.birth_place?.message}>
                <Input {...register("birth_place")} disabled={isPending} placeholder="City, Province" />
              </Field>
              <Field label="Gender" required error={errors.gender?.message}>
                <Select
                  value={watch("gender")}
                  onValueChange={(v) =>
                    v && setValue("gender", v as (typeof GENDERS)[number], { shouldValidate: true })
                  }
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Civil Status" error={errors.civil_status?.message}>
                <Select
                  value={watch("civil_status") || ""}
                  onValueChange={(v) => setValue("civil_status", (v ?? "") as never)}
                  disabled={isPending}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    {CIVIL_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Citizenship" error={errors.citizenship?.message}>
                <Input {...register("citizenship")} disabled={isPending} />
              </Field>
              <Field label="Religion" error={errors.religion?.message}>
                <Input {...register("religion")} disabled={isPending} />
              </Field>
            </div>
          </div>

          <Separator />

          {/* Contact */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email Address" required error={errors.email_address?.message}>
                <Input type="email" {...register("email_address")} disabled={isPending} />
              </Field>
              <Field
                label="Cellphone (+63XXXXXXXXXX)"
                error={errors.cellphone?.message}
                hint="Format: +639171234567"
              >
                <Input {...register("cellphone")} disabled={isPending} placeholder="+63" />
              </Field>
            </div>
          </div>

          <Separator />

          {/* Address */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Address
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Unit / House No." error={errors.address_unit?.message}>
                <Input {...register("address_unit")} disabled={isPending} />
              </Field>
              <Field label="Street" error={errors.address_street?.message}>
                <Input {...register("address_street")} disabled={isPending} />
              </Field>
              <Field label="Barangay" required error={errors.address_barangay?.message}>
                <Input {...register("address_barangay")} disabled={isPending} />
              </Field>
              <Field label="City / Municipality" required error={errors.address_city?.message}>
                <Input {...register("address_city")} disabled={isPending} />
              </Field>
              <Field label="Province" required error={errors.address_province?.message}>
                <Input {...register("address_province")} disabled={isPending} />
              </Field>
              <Field
                label="ZIP Code"
                required
                error={errors.address_zip?.message}
                hint="4 digits"
              >
                <Input {...register("address_zip")} disabled={isPending} />
              </Field>
              <Field
                label="Congressional District"
                error={errors.congressional_district?.message}
              >
                <Input {...register("congressional_district")} disabled={isPending} />
              </Field>
            </div>
          </div>

          <Separator />

          {/* DPA Consent */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Data Privacy Act Consent — Required
                </p>
                <p className="text-sm">
                  Per RA 10173, we need your explicit consent to collect and
                  process your personal information. Read the notice in detail
                  before agreeing.
                </p>

                <div className="flex items-start gap-2 pt-2">
                  <Checkbox
                    id="dpa_consent"
                    checked={!!dpaConsent}
                    disabled={isPending}
                    onCheckedChange={(checked) => {
                      // Don't allow self-checking — must go through the dialog
                      if (!checked) {
                        setValue("dpa_consent", false as unknown as true, {
                          shouldValidate: true,
                        });
                      }
                    }}
                  />
                  <label
                    htmlFor="dpa_consent"
                    className="text-sm flex-1 cursor-default select-none"
                  >
                    I have read and consent to the collection and processing of
                    my personal data per the{" "}
                    <DpaConsentDialog
                      trigger={
                        <span className="text-primary font-medium underline-offset-2 hover:underline cursor-pointer">
                          Data Privacy Notice
                        </span>
                      }
                      onAccept={() =>
                        setValue("dpa_consent", true as never, {
                          shouldValidate: true,
                        })
                      }
                    />
                    .
                  </label>
                </div>

                {errors.dpa_consent && (
                  <p className="text-xs text-destructive">
                    {errors.dpa_consent.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isPending || !dpaConsent}
            className="w-full bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Continue to Step 2
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}

interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, required, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
