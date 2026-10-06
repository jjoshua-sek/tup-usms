import type { Metadata } from "next";

import { GateKiosk } from "@/components/access/kiosk";
import { APP_SITE_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: `Gate Terminal · ${APP_SITE_NAME}` },
  description: "Campus access verification terminal.",
  robots: { index: false, follow: false },
};

/**
 * /kiosk — the unattended page that runs on the terminal at each turnstile.
 *
 * Deliberately outside the (student) and staff route groups: it has no
 * sidebar, no header, no Supabase session, and `src/middleware.ts` skips it
 * so an idle kiosk is never bounced to /login. All of its authority comes
 * from the device key it holds (see src/lib/access/device-auth.ts).
 */
export default function KioskPage() {
  return <GateKiosk />;
}
