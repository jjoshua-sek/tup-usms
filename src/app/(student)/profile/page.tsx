import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Profile",
};

const WIZARD_STEPS = [
  { step: 1, label: "Personal", description: "Basic personal information" },
  { step: 2, label: "Family", description: "Family background details" },
  { step: 3, label: "Education", description: "Educational background" },
  { step: 4, label: "Physical", description: "Physical & medical information" },
] as const;

export default function ProfilePage() {
  return (
    <div>
      <PageHeader
        title="Profile Management"
        description="Update your student profile information across all sections."
      />

      {/* Wizard Step Indicators */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {WIZARD_STEPS.map(({ step, label, description }) => (
          <Card
            key={step}
            className="text-center"
          >
            <CardHeader className="pb-2">
              <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {step}
              </div>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Wizard Form Placeholder */}
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Profile wizard form will be rendered here. Navigate through all four
            steps to complete your student profile.
          </p>
          {/* TODO: Implement multi-step profile wizard form */}
        </CardContent>
      </Card>
    </div>
  );
}
