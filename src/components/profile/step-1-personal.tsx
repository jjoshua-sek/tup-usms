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
  // Lifted out of DpaConsentDialog so both the "Read the notice" button and
  // the checkbox can open it. See the structure note at the consent block.
  const [dpaDialogOpen, setDpaDialogOpen] = useState(false);

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

  // Surface validation errors as a sticky summary so users don't miss them
  // when fields are off-screen.
  const errorEntries = Object.entries(errors).filter(
    ([, e]) => e?.message
  ) as [string, { message: string }][];
  const hasErrors = errorEntries.length > 0;

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
        // Show specific field errors if the server returned them
        const fieldErrors = result.fieldErrors;
        if (fieldErrors) {
          const allFieldErrorMsgs = Object.entries(fieldErrors)
            .map(([field, msgs]) => `${field}: ${(msgs as string[])?.[0]}`)
            .join("; ");
          setServerError(`${result.error} (${allFieldErrorMsgs})`);
        } else {
          setServerError(result.error);
        }
        toast.error(result.error);
        return;
      }
      toast.success("Personal info saved");
      onComplete();
    });
  };

  // When react-hook-form's validation fails, show a toast so the user
  // knows their click was acknowledged but something needs fixing.
  const onInvalid = () => {
    toast.error("Please fix the highlighted errors before continuing.");
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
      <form onSubmit={handleSubmit(onSubmit, onInvalid)}>
        <CardContent className="space-y-6">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          {/* Show a top-level summary when client validation has errors.
              Users may not see inline errors if they're scrolled past the field. */}
          {hasErrors && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-1">Please fix these issues:</p>
                <ul className="list-disc ml-4 space-y-0.5 text-xs">
                  {errorEntries.slice(0, 5).map(([field, error]) => (
                    <li key={field}>
                      <span className="font-mono">{field.replace(/_/g, " ")}</span>:{" "}
                      {error.message}
                    </li>
                  ))}
                  {errorEntries.length > 5 && (
                    <li className="italic">
                      ...and {errorEntries.length - 5} more
                    </li>
                  )}
                </ul>
              </AlertDescription>
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
              {/* `?? ""` on the Select values below keeps them controlled from
                  the first render. Passing undefined makes Base UI treat the
                  Select as uncontrolled, and switching to a real value later
                  trips React's uncontrolled-to-controlled warning. */}
              <Field label="Gender" required error={errors.gender?.message}>
                <Select
                  value={watch("gender") ?? ""}
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
                label="Cellphone"
                error={errors.cellphone?.message}
                hint="e.g. 09171234567 — any common format works"
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
                hint="e.g. 1008"
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

          {/* ==========================================================
              DPA CONSENT

              STRUCTURE NOTE: the dialog trigger must NOT be nested inside
              a <label htmlFor="dpa_consent">. Browsers retarget any click
              inside a label to its associated form control, which swallows
              the trigger's click and makes the dialog impossible to open.
              The dialog is therefore driven by explicit open state, and
              both the button and the checkbox can raise it.
              ========================================================== */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                <Shield className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Data Privacy Act Consent — Required
                  </p>
                  <p className="text-sm mt-1">
                    Per RA 10173, we need your explicit consent before
                    collecting and processing your personal information.
                  </p>
                </div>

                {/* Primary action — reading the notice is the required step,
                    so it gets a real button rather than an inline link. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setDpaDialogOpen(true)}
                  className="border-primary/40 text-primary hover:bg-primary/10"
                >
                  <Shield className="mr-1.5 h-3.5 w-3.5" />
                  {dpaConsent
                    ? "Review the Data Privacy Notice"
                    : "Read the Data Privacy Notice"}
                </Button>

                {/* Status row. The checkbox reflects consent; clicking it
                    while unchecked opens the notice, because consent cannot
                    be given without reading it first. */}
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id="dpa_consent"
                    checked={!!dpaConsent}
                    disabled={isPending}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        // Consent must be informed: route through the notice
                        // rather than letting a bare tick stand as consent.
                        setDpaDialogOpen(true);
                      } else {
                        setValue("dpa_consent", false as unknown as true, {
                          shouldValidate: true,
                        });
                      }
                    }}
                    className="mt-0.5"
                  />
                  <label
                    htmlFor="dpa_consent"
                    className="text-sm flex-1 cursor-pointer select-none"
                  >
                    I have read and consent to the collection and processing
                    of my personal data.
                  </label>
                </div>

                {!dpaConsent && (
                  <p className="text-xs text-muted-foreground">
                    Open the notice above and choose &ldquo;I understand and
                    agree&rdquo; to continue.
                  </p>
                )}

                {errors.dpa_consent && (
                  <p className="text-xs text-destructive">
                    {errors.dpa_consent.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Rendered outside the consent card so no ancestor label can
              intercept its interactions. */}
          <DpaConsentDialog
            open={dpaDialogOpen}
            onOpenChange={setDpaDialogOpen}
            onAccept={() =>
              setValue("dpa_consent", true as never, { shouldValidate: true })
            }
          />

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
