import type { Metadata } from "next";
import Link from "next/link";
import { DoorOpen, Lock } from "lucide-react";

import { DeskScanner } from "@/components/access/desk-scanner";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAccessStaff } from "@/lib/access/guards";
import { getCurrentTerm } from "@/lib/access/term";

export const metadata: Metadata = {
  title: "QR Scanner",
};

/**
 * OSA front-desk scanner — the manned counterpart to the gate kiosk.
 *
 * Both call the same verification engine, so an ID that opens a turnstile is
 * exactly the ID that passes here.
 */
export default async function StaffScannerPage() {
  const staff = await getAccessStaff();
  const term = getCurrentTerm();

  if (!staff?.canView) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "QR Scanner" }]}
          title="QR Scanner"
        />
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
          <Lock className="h-7 w-7 text-muted-foreground/50" />
          <p className="max-w-sm text-sm text-muted-foreground">
            ID verification is limited to OSA staff and security personnel.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Staff", href: "/staff/dashboard" }, { label: "QR Scanner" }]}
        title="ID Verification"
        description={`Checks the institutional QR against this term's validation — ${term.label}.`}
      >
        <Link
          href="/staff/gates"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <DoorOpen className="mr-1.5 h-4 w-4" />
          Gates & Access
        </Link>
      </PageHeader>

      <DeskScanner canSeeCases={staff.role !== "security_guard"} />
    </div>
  );
}
