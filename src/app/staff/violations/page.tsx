import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Violations",
};

export default function StaffViolationsPage() {
  return (
    <div>
      <PageHeader
        title="Violations"
        description="View and manage all recorded student violations."
      >
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Record New Violation
        </Button>
      </PageHeader>

      {/* ---------- Search ---------- */}
      <div className="mb-4 max-w-sm">
        <Input placeholder="Search by student name, ID, or violation type..." />
      </div>

      {/* ---------- Violations Table ---------- */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Student ID</TableHead>
              <TableHead>Violation Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-24 text-center text-muted-foreground"
              >
                No violations recorded yet. Click &quot;Record New
                Violation&quot; to add one.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Violations are categorized by type and severity. Staff can edit, resolve,
        or escalate individual records from the actions column.
      </p>
    </div>
  );
}
