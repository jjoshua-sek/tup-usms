import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Concerns",
};

export default function StaffConcernsPage() {
  return (
    <div>
      <PageHeader
        title="Student Concerns"
        description="Review, filter, and manage all submitted student concerns."
      >
        <Button variant="outline" size="sm">
          Export
        </Button>
      </PageHeader>

      {/* ---------- Filters ---------- */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Narrow down concerns by status, urgency, category, department, or
            date range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {/* Placeholder filter controls — will be replaced with Select / DatePicker components */}
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Status: All
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Urgency: All
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Category: All
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Department: All
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              Date Range: Any
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- Bulk Actions ---------- */}
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="sm" disabled>
          Assign Selected
        </Button>
        <Button variant="outline" size="sm" disabled>
          Mark Resolved
        </Button>
        <Button variant="outline" size="sm" disabled>
          Escalate
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">
          Select concerns below to enable bulk actions.
        </span>
      </div>

      {/* ---------- Concern List ---------- */}
      <div className="space-y-4">
        <Card>
          <CardContent className="flex items-start justify-between p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">No concerns found</p>
              <p className="text-sm text-muted-foreground">
                Submitted concerns will appear here with AI-generated summaries,
                urgency color coding, and category tags.
              </p>
            </div>
            <Badge variant="secondary">--</Badge>
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Each concern card displays the student name, AI summary, urgency badge
        (color-coded: red for critical, amber for high, blue for medium, gray
        for low), assigned staff member, and submission date.
      </p>
    </div>
  );
}
