import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { TEXT_SIZE_SCRIPT } from "@/components/layout/text-size-switch";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_FULL_NAME, APP_NAME, APP_SITE_NAME } from "@/lib/brand";
import { isOfflineMode } from "@/lib/offline/mode";
import "./globals.css";

/**
 * Geist Sans — Vercel's institutional sans-serif. Used for body and all headings.
 * Chosen to match the mockup precisely. Geist is highly readable at small sizes
 * (body text is 16px, and larger with the text-size switch) and has excellent
 * Latin Extended support for Filipino diacritics.
 */
const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/**
 * Geist Mono — paired mono. Used for:
 * - Breadcrumbs ("Home / Dashboard")
 * - Section labels ("MAIN", "ACCOUNT")
 * - Badges ("HIGH", "MEDIUM")
 * - Student/concern IDs ("#C-2026-0148")
 * - Audit log timestamps
 */
const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: APP_SITE_NAME,
    template: `%s | ${APP_SITE_NAME}`,
  },
  description: `${APP_NAME}: ${APP_FULL_NAME} with Integrated OSA Services — Technological University of the Philippines - Manila`,
  keywords: ["TUP", "Manila", "Office of Student Affairs", "Student Portal", "Early Warning"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/* The text size chosen in the header (A, A+, A++), applied before first paint. */}
      <Script id="text-size" strategy="beforeInteractive">
        {TEXT_SIZE_SCRIPT}
      </Script>
      {/* data-offline-mode greys out every saving form on the LAN copy (globals.css). */}
      <body className="min-h-full flex flex-col font-sans" data-offline-mode={isOfflineMode() ? "" : undefined}>
        <OfflineBanner />
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
