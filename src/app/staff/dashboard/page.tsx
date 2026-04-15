import type { Metadata } from "next";
import {
  AlertTriangle,
  FileWarning,
  GraduationCap,
  MessageSquare,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Staff Dashboard",
};

export default function StaffDashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of student management activities and pending tasks."
      />

      {/* ---------- Stat Cards ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Pending Concerns"
          value={0}
          description="Awaiting staff review"
          icon={AlertTriangle}
          iconClassName="bg-amber-500/10"
        />
        <StatsCard
          title="Active Violations"
          value={0}
          description="Currently unresolved"
          icon={FileWarning}
          iconClassName="bg-red-500/10"
        />
        <StatsCard
          title="Enrolled Students"
          value={0}
          description="This semester"
          icon={GraduationCap}
          iconClassName="bg-emerald-500/10"
        />
        <StatsCard
          title="Unresolved Messages"
          value={0}
          description="Require a reply"
          icon={MessageSquare}
          iconClassName="bg-blue-500/10"
        />
      </div>

      {/* ---------- Concern Queue ---------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Concern Queue</CardTitle>
          <CardDescription>
            Recent student concerns ranked by AI-assessed urgency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Placeholder — will be replaced with server-fetched data */}
          <div className="space-y-4">
            <div className="flex items-start justify-between rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">
                  No pending concerns
                </p>
                <p className="text-sm text-muted-foreground">
                  All student concerns have been addressed.
                </p>
              </div>
              <Badge variant="secondary">None</Badge>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Each concern displays an AI-generated summary, urgency badge, and
            category tag. Click a concern to open the full detail view.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
