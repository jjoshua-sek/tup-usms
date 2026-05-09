import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Body font: Inter — the de facto standard for SaaS dashboards.
// Highly readable at small sizes, comprehensive language support
// (including Filipino diacritics for student names like ñ, é).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Display/heading font: Plus Jakarta Sans — slightly more characterful
// than Inter, gives section titles and stat numbers presence without
// feeling academic or stuffy. Designed in Jakarta (Southeast Asian context).
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-display",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Mono font: JetBrains Mono for code/IDs (student numbers, audit logs).
const jetbrainsMono = JetBrains_Mono({
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
  keywords: [
    "TUP",
    "Manila",
    "Student Portal",
    "Registration",
    "University",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
