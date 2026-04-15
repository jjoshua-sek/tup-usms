import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle, CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Grades",
};

export default function GradesPage() {
  return (
    <div>
      <PageHeader
        title="Grades"
        description="View your academic grades, GPA, and curriculum progress."
      />

      {/* Evaluation Gate */}
      <Alert className="mb-6">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Faculty Evaluation Required</AlertTitle>
        <AlertDescription>
          Please complete all faculty evaluations before viewing your grades.
          This is a university requirement each semester.
        </AlertDescription>
        {/* TODO: Check evaluation status and conditionally show/hide grades */}
      </Alert>

      {/* Grade Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Grade Report</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Units</TableHead>
                <TableHead>Midterm</TableHead>
                <TableHead>Final</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Remarks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  Grades will appear here after faculty evaluations are
                  completed.
                </TableCell>
              </TableRow>
              {/* TODO: Map grade records into table rows */}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* GPA Chart */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">GPA Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed text-sm text-muted-foreground">
            GPA chart will be rendered here.
          </div>
          {/* TODO: Implement GPA trend chart using a charting library */}
        </CardContent>
      </Card>

      {/* Curriculum Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Curriculum Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-muted-foreground/50" />
              <span>Curriculum subjects and completion status will appear here.</span>
            </div>
          </div>
          {/* TODO: Map curriculum subjects with pass/fail/pending status */}
        </CardContent>
      </Card>
    </div>
  );
}
