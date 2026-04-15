import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Violations",
};

export default function ViolationsPage() {
  return (
    <div>
      <PageHeader
        title="Violations"
        description="View your recorded disciplinary violations."
      />

      {/* Severity Legend */}
      <div className="mb-6 flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Severity:</span>
        <Badge variant="destructive">Major</Badge>
        <Badge variant="secondary">Minor</Badge>
        <Badge variant="outline">Warning</Badge>
      </div>

      {/* Violations List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Violation Records</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No violations on record. Any disciplinary violations will be listed
            here with their severity, date, description, and status.
          </p>
          {/* TODO: Map violation records into a read-only list with severity badges */}
        </CardContent>
      </Card>
    </div>
  );
}
