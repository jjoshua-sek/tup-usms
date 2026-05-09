"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  Upload,
  Edit2,
  Loader2,
  CheckCircle2,
  Lock,
  User,
  Users,
  GraduationCap,
  Image as ImageIcon,
  ChevronDown,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { ProvisionalPhotoBanner } from "./provisional-photo-banner";
import { Step4Photo } from "./step-4-photo";

interface StudentProfile {
  id: string;
  user_id: string;
  student_number: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_extension: string | null;
  birth_date: string;
  birth_place: string | null;
  gender: string;
  citizenship: string;
  religion: string | null;
  civil_status: string | null;
  height_cm: number | null;
  weight_lbs: number | null;
  lrn: string | null;
  cellphone: string | null;
  email_address: string;
  address_unit: string | null;
  address_street: string | null;
  address_barangay: string;
  address_city: string;
  address_province: string;
  address_zip: string;
  congressional_district: string | null;
  financial_support: string | null;
  sponsor_name: string | null;
  is_indigenous: boolean;
  is_pwd: boolean;
  is_listahan: boolean;
  campus: string;
  department: string;
  program: string;
  year_level: string;
  section: string | null;
  scholastic_status: string;
  photo_url: string | null;
  photo_is_provisional: boolean;
  dpa_consent: boolean;
  dpa_consent_date: string | null;
  profile_completed_at: string | null;
}

interface ProfileEditProps {
  student: StudentProfile;
}

/**
 * Edit mode for completed profiles.
 * Profile is shown as collapsible sections; clicking "Replace photo" opens
 * the same Step 4 photo flow as the wizard.
 *
 * For now, only photo replacement is fully implemented.
 * Full editing of other fields is a follow-up feature — students will see
 * their data in read-only sections with an "Edit field" affordance that
 * we'll wire up later.
 */
export function ProfileEdit({ student }: ProfileEditProps) {
  const router = useRouter();
  const [showPhotoEditor, setShowPhotoEditor] = useState(false);

  const fullName = [
    student.first_name,
    student.middle_name,
    student.last_name,
    student.name_extension,
  ]
    .filter(Boolean)
    .join(" ");

  if (showPhotoEditor) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Replace Profile Photo</CardTitle>
            <CardDescription>
              Upload a new photo or take one with your camera.
            </CardDescription>
          </CardHeader>
        </Card>
        <Step4Photo
          initialPhotoUrl={student.photo_url}
          initialIsProvisional={student.photo_is_provisional}
          initialHeight={student.height_cm}
          initialWeight={student.weight_lbs}
          onBack={() => setShowPhotoEditor(false)}
          onComplete={() => {
            setShowPhotoEditor(false);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Provisional photo banner — only shown when applicable */}
      <ProvisionalPhotoBanner
        show={student.photo_is_provisional && !!student.photo_url}
        onReplaceClick={() => setShowPhotoEditor(true)}
      />

      {/* Profile header card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="relative">
              <div
                className={cn(
                  "h-24 w-24 sm:h-28 sm:w-28 overflow-hidden rounded-2xl ring-4",
                  student.photo_is_provisional
                    ? "ring-amber-500/30"
                    : "ring-tup-maroon-900/20"
                )}
              >
                {student.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avoiding Image config for external Supabase Storage URL
                  <img
                    src={student.photo_url}
                    alt={fullName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>
              {student.photo_is_provisional && (
                <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-amber-500 ring-2 ring-background" />
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-display font-bold tracking-tight">
                {fullName}
              </h1>
              <p className="font-mono text-sm text-muted-foreground">
                {student.student_number}
              </p>
              <div className="mt-2 flex flex-wrap justify-center sm:justify-start items-center gap-2">
                <Badge variant="secondary">{student.program}</Badge>
                <Badge variant="outline">{student.year_level}</Badge>
                {student.section && (
                  <Badge variant="outline">Section {student.section}</Badge>
                )}
                {student.scholastic_status === "Regular" ? (
                  <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {student.scholastic_status}
                  </Badge>
                ) : (
                  <Badge variant="destructive">{student.scholastic_status}</Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPhotoEditor(true)}
              >
                <Camera className="mr-1 h-3.5 w-3.5" />
                Replace photo
              </Button>
              {student.photo_is_provisional && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  Photo marked provisional
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sections */}
      <Section
        icon={User}
        title="Personal Information"
        description="Identity and contact details"
      >
        <FieldGrid>
          <Field label="Full Name" value={fullName} />
          <Field
            label="Birth Date"
            value={new Date(student.birth_date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          />
          {student.birth_place && (
            <Field label="Birth Place" value={student.birth_place} />
          )}
          <Field label="Gender" value={student.gender} />
          <Field label="Citizenship" value={student.citizenship} />
          {student.civil_status && (
            <Field label="Civil Status" value={student.civil_status} />
          )}
          {student.religion && <Field label="Religion" value={student.religion} />}
          <Field label="Email" value={student.email_address} />
          {student.cellphone && <Field label="Cellphone" value={student.cellphone} />}
        </FieldGrid>
        <Separator className="my-3" />
        <FieldGrid>
          <Field label="Barangay" value={student.address_barangay} />
          <Field label="City / Municipality" value={student.address_city} />
          <Field label="Province" value={student.address_province} />
          <Field label="ZIP" value={student.address_zip} />
          {student.address_street && (
            <Field label="Street" value={student.address_street} />
          )}
          {student.address_unit && (
            <Field label="Unit / House No." value={student.address_unit} />
          )}
        </FieldGrid>
      </Section>

      <Section
        icon={Users}
        title="Family Background"
        description="Financial and beneficiary status"
      >
        <FieldGrid>
          {student.financial_support && (
            <Field label="Financial Support" value={student.financial_support} />
          )}
          {student.sponsor_name && (
            <Field label="Sponsor Name" value={student.sponsor_name} />
          )}
        </FieldGrid>
        <div className="mt-3 flex flex-wrap gap-2">
          {student.is_indigenous && <Badge variant="outline">IP member</Badge>}
          {student.is_pwd && <Badge variant="outline">PWD</Badge>}
          {student.is_listahan && <Badge variant="outline">Listahanan</Badge>}
          {!student.is_indigenous && !student.is_pwd && !student.is_listahan && (
            <p className="text-xs text-muted-foreground">No beneficiary statuses indicated</p>
          )}
        </div>
      </Section>

      <Section
        icon={GraduationCap}
        title="Academic Information"
        description="Set by the Registrar"
      >
        <FieldGrid>
          <Field label="Campus" value={student.campus} />
          <Field label="Department" value={student.department} />
          <Field label="Program" value={student.program} />
          <Field label="Year Level" value={student.year_level} />
          {student.section && <Field label="Section" value={student.section} />}
          {student.lrn && <Field label="LRN" value={student.lrn} />}
        </FieldGrid>
        <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
          <Lock className="h-3 w-3" />
          Most academic fields are read-only. Contact{" "}
          <a
            href="mailto:registrar@tup.edu.ph"
            className="text-primary hover:underline"
          >
            registrar@tup.edu.ph
          </a>{" "}
          to request changes.
        </p>
      </Section>

      {/* DPA consent record */}
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="py-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Data Privacy Act consent on file</p>
            {student.dpa_consent_date && (
              <p className="text-xs text-muted-foreground">
                Consented on{" "}
                {new Date(student.dpa_consent_date).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Subcomponents
// ============================================================

interface SectionProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, description, children }: SectionProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5 mt-0.5">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
