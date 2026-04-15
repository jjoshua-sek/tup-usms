import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Schedule",
};

export default function SchedulePage() {
  return (
    <div>
      <PageHeader
        title="Class Schedule"
        description="View your enrolled subjects and weekly timetable."
      />

      {/* Subject List Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Subject List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Instructor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  No subjects enrolled yet.
                </TableCell>
              </TableRow>
              {/* TODO: Map enrolled subjects into table rows */}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Weekly Timetable Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Weekly Timetable</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-6 gap-px rounded-lg border bg-muted text-sm">
            {/* Header Row */}
            <div className="bg-background p-2 font-medium text-muted-foreground">
              Time
            </div>
            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(
              (day) => (
                <div
                  key={day}
                  className="bg-background p-2 text-center font-medium text-muted-foreground"
                >
                  {day}
                </div>
              )
            )}

            {/* Placeholder Time Slots */}
            {["7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM"].map(
              (time) => (
                <>
                  <div
                    key={time}
                    className="bg-background p-2 text-muted-foreground"
                  >
                    {time}
                  </div>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={`${time}-${i}`}
                      className="bg-background p-2"
                    />
                  ))}
                </>
              )
            )}
          </div>
          {/* TODO: Populate timetable cells with enrolled subject blocks */}
        </CardContent>
      </Card>
    </div>
  );
}
