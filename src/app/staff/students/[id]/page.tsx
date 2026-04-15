import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "Student Detail",
};

export default async function StaffStudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <PageHeader
        title={`Student: ${id}`}
        description="View and manage this student's complete academic record."
      >
        <Button variant="outline" size="sm">
          Send Message
        </Button>
      </PageHeader>

      {/* ---------- Tabs ---------- */}
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="concerns">Concerns</TabsTrigger>
          <TabsTrigger value="violations">Violations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* --- Profile Tab --- */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Personal Information</CardTitle>
              <CardDescription>
                Basic demographic and contact details for student {id}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between border-b pb-2">
                <span>Full Name</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Student ID</span>
                <span>{id}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Email</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Program</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Year Level</span>
                <span>--</span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span>--</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Enrollments Tab --- */}
        <TabsContent value="enrollments">
          <Card>
            <CardHeader>
              <CardTitle>Enrollment History</CardTitle>
              <CardDescription>
                Semester-by-semester enrollment records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No enrollment records loaded yet. Data will be fetched from the
                enrollment database.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Grades Tab --- */}
        <TabsContent value="grades">
          <Card>
            <CardHeader>
              <CardTitle>Academic Grades</CardTitle>
              <CardDescription>
                Course grades grouped by semester.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No grade records loaded yet. Data will be fetched from the
                academic records system.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Concerns Tab --- */}
        <TabsContent value="concerns">
          <Card>
            <CardHeader>
              <CardTitle>Filed Concerns</CardTitle>
              <CardDescription>
                All concerns submitted by or about this student.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No concerns found for this student.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Violations Tab --- */}
        <TabsContent value="violations">
          <Card>
            <CardHeader>
              <CardTitle>Violation Records</CardTitle>
              <CardDescription>
                Disciplinary records and their current statuses.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No violations recorded for this student.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* --- Documents Tab --- */}
        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Uploaded Documents</CardTitle>
              <CardDescription>
                Supporting documents, certificates, and forms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No documents uploaded for this student.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
