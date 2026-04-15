import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Calendar",
};

export default function StaffCalendarPage() {
  return (
    <div>
      <PageHeader
        title="Academic Calendar"
        description="Manage and view academic events, deadlines, and important dates."
      >
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Event
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ---------- Calendar View ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Calendar</CardTitle>
            <CardDescription>
              Monthly view of all scheduled academic events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Placeholder for a full calendar component (e.g., FullCalendar or custom) */}
            <div className="flex h-96 items-center justify-center rounded-lg border-2 border-dashed bg-muted/50 text-sm text-muted-foreground">
              Calendar component will render here. Supports month, week, and day
              views.
            </div>
          </CardContent>
        </Card>

        {/* ---------- Upcoming Events ---------- */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Upcoming Events</CardTitle>
            <CardDescription>Next 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No upcoming events scheduled. Use &quot;Add Event&quot; to
                create academic calendar entries such as enrollment periods, exam
                weeks, holidays, and deadlines.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------- Event Categories ---------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Event Categories</CardTitle>
          <CardDescription>
            Color-coded categories for different types of academic events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full bg-blue-500" />
              Enrollment
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full bg-red-500" />
              Examinations
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full bg-emerald-500" />
              Holidays
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full bg-amber-500" />
              Deadlines
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-full bg-purple-500" />
              Events &amp; Activities
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
