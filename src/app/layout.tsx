import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

/**
 * Geist Sans — Vercel's institutional sans-serif. Used for body and all headings.
 * Chosen to match the mockup precisely. Geist is highly readable at small sizes
 * (matters here because the redesign uses 13px body text) and has excellent
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
    default: "TUP-Manila USMS",
    template: "%s | TUP-Manila USMS",
  },
  description:
    "Unified Student Management System for Technological University of the Philippines - Manila",
  keywords: ["TUP", "Manila", "Student Portal", "Registration", "University"],
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
      <body className="min-h-full flex flex-col font-sans">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
