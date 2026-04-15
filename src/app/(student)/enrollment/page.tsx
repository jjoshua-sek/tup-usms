import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Enrollment",
};

export default function EnrollmentPage() {
  return (
    <div>
      <PageHeader
        title="Enrollment"
        description="Manage your subject enrollment for the current semester."
      />

      {/* Student Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Student Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Student No.:</span>{" "}
              <span className="font-medium">--</span>
            </div>
            <div>
              <span className="text-muted-foreground">Program:</span>{" "}
              <span className="font-medium">--</span>
            </div>
            <div>
              <span className="text-muted-foreground">Year Level:</span>{" "}
              <span className="font-medium">--</span>
            </div>
          </div>
          {/* TODO: Populate with actual student data */}
        </CardContent>
      </Card>

      {/* Deficiency Alerts */}
      <Alert variant="destructive" className="mb-6">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Deficiency Alerts</AlertTitle>
        <AlertDescription>
          No deficiencies found. You are clear to enroll.
        </AlertDescription>
        {/* TODO: Display actual deficiency data from student records */}
      </Alert>

      {/* Subject Picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Subject Picker</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select your subjects for the current semester. Available subjects
            will appear here based on your curriculum and prerequisites.
          </p>
          {/* TODO: Implement subject search, filtering, and enrollment cart */}
        </CardContent>
      </Card>
    </div>
  );
}
