import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
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
  title: "Student Directory",
};

export default function StaffStudentsPage() {
  return (
    <div>
      <PageHeader
        title="Student Directory"
        description="Search, sort, and browse all enrolled students. Powered by TanStack Table."
      />

      {/* ---------- Search / Filters ---------- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search by name, student ID, or email..."
          className="max-w-sm"
        />
        {/* Placeholder column-visibility and filter controls for TanStack Table */}
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Program: All
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Year Level: All
        </div>
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Status: All
        </div>
      </div>

      {/* ---------- Students Table ---------- */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student ID</TableHead>
              <TableHead>Full Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Year Level</TableHead>
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
                No students found. The directory will be populated from the
                enrollment database.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* ---------- Pagination ---------- */}
      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <p>Showing 0 of 0 students</p>
        <div className="flex items-center gap-2">
          {/* TanStack Table pagination controls will go here */}
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
}
