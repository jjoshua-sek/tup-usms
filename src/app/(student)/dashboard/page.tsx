import type { Metadata } from "next";
import { BookOpen, TrendingUp, AlertCircle, Mail } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's an overview of your academic status."
      />

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatsCard
          title="Enrolled Subjects"
          value={0}
          description="Current semester"
          icon={BookOpen}
        />
        <StatsCard
          title="GPA"
          value="--"
          description="Cumulative average"
          icon={TrendingUp}
        />
        <StatsCard
          title="Pending Concerns"
          value={0}
          description="Awaiting response"
          icon={AlertCircle}
        />
        <StatsCard
          title="Unread Messages"
          value={0}
          description="In your inbox"
          icon={Mail}
        />
      </div>

      {/* Today's Schedule Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Today&apos;s Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No classes scheduled for today.
          </p>
          {/* TODO: Render today's schedule entries from enrolled subjects */}
        </CardContent>
      </Card>
    </div>
  );
}
