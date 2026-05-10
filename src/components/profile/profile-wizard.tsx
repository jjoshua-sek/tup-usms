"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Step1Personal } from "./step-1-personal";
import { Step2Family } from "./step-2-family";
import { Step3Academic } from "./step-3-academic";
import { Step4Photo } from "./step-4-photo";
import { ProgressStepper } from "./progress-stepper";

import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface WizardStudentData {
  // Step 1 fields (may be empty for first-time)
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  name_extension?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  gender?: string | null;
  citizenship?: string | null;
  religion?: string | null;
  civil_status?: string | null;
  cellphone?: string | null;
  email_address?: string | null;
  address_unit?: string | null;
  address_street?: string | null;
  address_barangay?: string | null;
  address_city?: string | null;
  address_province?: string | null;
  address_zip?: string | null;
  congressional_district?: string | null;
  dpa_consent?: boolean | null;

  // Step 2
  financial_support?: string | null;
  sponsor_name?: string | null;
  is_indigenous?: boolean | null;
  is_pwd?: boolean | null;
  is_listahan?: boolean | null;

  // Step 3 (admin-set)
  lrn?: string | null;
  campus?: string | null;
  department?: string | null;
  program?: string | null;
  year_level?: string | null;
  section?: string | null;

  // Step 4
  photo_url?: string | null;
  photo_is_provisional?: boolean | null;
  height_cm?: number | null;
  weight_lbs?: number | null;
}

interface ProfileWizardProps {
  initialData: WizardStudentData;
  startingStep: number;
  defaultEmail: string;
}

/**
 * Multi-step profile wizard for first-time student onboarding.
 *
 * Each step's "Continue" button calls a Server Action that validates and
 * persists THAT step's data, then we advance the local step state.
 * If they refresh mid-wizard, the page Server Component reads the partial
 * row and computes the right starting step via profileStartingStep().
 */
export function ProfileWizard({
  initialData,
  startingStep,
  defaultEmail,
}: ProfileWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(Math.min(Math.max(startingStep, 1), 4));

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, 4));
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 1));
  const finish = () => {
    router.push("/dashboard");
    router.refresh();
  };

  // Treat empty admin fields gracefully — registrar may not have filled them
  // before the student logged in. We let them through but the dashboard
  // gate will catch it later.
  const adminFields = {
    campus: initialData.campus || "Manila",
    department: initialData.department || "Not yet assigned",
    program: initialData.program || "Not yet assigned",
    year_level: initialData.year_level || "1st Year",
    section: initialData.section ?? null,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Welcome hero (plain div, NOT Card — avoids text-card-foreground
          fighting our text-white at runtime). */}
      <div className="bg-tup-gradient bg-grid-pattern relative overflow-hidden rounded-xl border-0 px-6 py-6 sm:py-7 shadow-lg">
        <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-tup-gold-400/10 blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-tup-gold-100" />
            <span className="text-xs font-semibold uppercase tracking-wider text-tup-gold-100">
              Profile Setup
            </span>
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-white">
            Welcome to TUP-Manila USMS
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Let&apos;s get your profile set up. This takes about 5 minutes
            and unlocks the rest of the system.
          </p>
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="py-4">
          <ProgressStepper currentStep={currentStep} />
        </CardContent>
      </Card>

      {/* Active step */}
      {currentStep === 1 && (
        <Step1Personal
          initialData={{
            last_name: initialData.last_name ?? "",
            first_name: initialData.first_name ?? "",
            middle_name: initialData.middle_name ?? "",
            name_extension: initialData.name_extension ?? "",
            birth_date: initialData.birth_date ?? "",
            birth_place: initialData.birth_place ?? "",
            gender: initialData.gender as "Male" | "Female" | "Other" | "Prefer not to say" | undefined,
            citizenship: initialData.citizenship ?? "FILIPINO",
            religion: initialData.religion ?? "",
            civil_status: (initialData.civil_status ?? "") as "Single" | "Married" | "Widowed" | "Separated" | "" | undefined,
            cellphone: initialData.cellphone ?? "",
            email_address: initialData.email_address ?? defaultEmail,
            address_unit: initialData.address_unit ?? "",
            address_street: initialData.address_street ?? "",
            address_barangay: initialData.address_barangay ?? "",
            address_city: initialData.address_city ?? "",
            address_province: initialData.address_province ?? "",
            address_zip: initialData.address_zip ?? "",
            congressional_district: initialData.congressional_district ?? "",
            dpa_consent: (initialData.dpa_consent === true ? true : undefined) as never,
          }}
          defaultEmail={defaultEmail}
          onComplete={goNext}
        />
      )}

      {currentStep === 2 && (
        <Step2Family
          initialData={{
            financial_support: initialData.financial_support as
              | "Self-supporting"
              | "Parent/Guardian"
              | "Scholarship"
              | "Working Student"
              | "Other"
              | undefined,
            sponsor_name: initialData.sponsor_name ?? "",
            is_indigenous: initialData.is_indigenous ?? false,
            is_pwd: initialData.is_pwd ?? false,
            is_listahan: initialData.is_listahan ?? false,
          }}
          onComplete={goNext}
          onBack={goBack}
        />
      )}

      {currentStep === 3 && (
        <Step3Academic
          initialData={{
            lrn: initialData.lrn ?? "",
            campus: adminFields.campus,
            department: adminFields.department,
            program: adminFields.program,
            year_level: adminFields.year_level as never,
            section: adminFields.section ?? "",
          }}
          adminFields={adminFields}
          onComplete={goNext}
          onBack={goBack}
        />
      )}

      {currentStep === 4 && (
        <Step4Photo
          initialPhotoUrl={initialData.photo_url}
          initialIsProvisional={initialData.photo_is_provisional ?? false}
          initialHeight={initialData.height_cm ?? null}
          initialWeight={initialData.weight_lbs ?? null}
          onBack={goBack}
          onComplete={finish}
        />
      )}
    </div>
  );
}
