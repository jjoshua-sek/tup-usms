import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Circle } from "lucide-react";

export const metadata: Metadata = {
  title: "Graduation",
};

const CLEARANCE_ITEMS = [
  { id: "library", label: "Library Clearance", cleared: false },
  { id: "registrar", label: "Registrar Clearance", cleared: false },
  { id: "finance", label: "Finance Clearance", cleared: false },
  { id: "department", label: "Department Clearance", cleared: false },
  { id: "guidance", label: "Guidance Office Clearance", cleared: false },
  { id: "laboratory", label: "Laboratory Clearance", cleared: false },
] as const;

export default function GraduationPage() {
  return (
    <div>
      <PageHeader
        title="Graduation Application"
        description="Apply for graduation and track your clearance status."
      >
        <Button disabled>Apply for Graduation</Button>
      </PageHeader>

      {/* Clearance Checklist */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Clearance Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {CLEARANCE_ITEMS.map(({ id, label, cleared }) => (
              <div key={id} className="flex items-center gap-3">
                {cleared ? (
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </div>
          {/* TODO: Fetch real clearance status for each department */}
        </CardContent>
      </Card>

      {/* Application Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Application Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No graduation application submitted. Complete all clearance
            requirements before applying.
          </p>
          {/* TODO: Show application status timeline after submission */}
        </CardContent>
      </Card>
    </div>
  );
}
