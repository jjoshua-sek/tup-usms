import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "QR Scanner",
};

export default function StaffScannerPage() {
  return (
    <div>
      <PageHeader
        title="QR Scanner"
        description="Scan student QR codes to quickly view their profile and enrollment status."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Camera View ---------- */}
        <Card className="lg:row-span-2">
          <CardHeader>
            <CardTitle className="text-base">Camera Feed</CardTitle>
            <CardDescription>
              Point the camera at a student&apos;s QR code to scan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/*
             * Placeholder for the html5-qrcode camera view.
             * A client component will mount here and initialize
             * Html5QrcodeScanner targeting this container div.
             */}
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border-2 border-dashed bg-muted/50">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <QrCode className="h-12 w-12" />
                <p className="text-sm font-medium">Camera preview area</p>
                <p className="text-xs">
                  The html5-qrcode scanner will render here.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------- Scan Result ---------- */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student Information</CardTitle>
            <CardDescription>
              Details appear here after a successful scan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between border-b pb-2">
                <span>Name</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Student ID</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Program</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Year Level</span>
                <span>--</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span>Enrollment Status</span>
                <span>--</span>
              </div>
              <div className="flex justify-between">
                <span>Active Violations</span>
                <span>--</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan History</CardTitle>
            <CardDescription>
              Recent scans from this session.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No scans yet this session.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
