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
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Manage your account security and preferences."
      />

      {/* Password Change Form */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-4">
            <p className="text-sm text-muted-foreground">
              Password change form will be rendered here with current password,
              new password, and confirmation fields.
            </p>
          </div>
          {/* TODO: Implement password change form with validation */}
        </CardContent>
      </Card>

      {/* Login History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Login History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; Time</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Device / Browser</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  No login history available.
                </TableCell>
              </TableRow>
              {/* TODO: Fetch and display login history records */}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
