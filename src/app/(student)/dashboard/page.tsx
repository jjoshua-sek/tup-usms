import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckCircle2,
  MessageSquare,
  AlertTriangle,
  FolderOpen,
  Plus,
  BookOpen,
  IdCard,
  ShieldAlert,
  Megaphone,
  ArrowRight,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { StatsCard } from "@/components/shared/stats-card";
import { ModuleCard } from "@/components/shared/module-card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const revalidate = 30;

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string;
  year_level: string;
  scholastic_status: string;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getCurrentAcademicTerm(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // Aug-Dec → 1st sem AY (year)-(year+1)
  // Jan-May → 2nd sem AY (year-1)-(year)
  // Jun-Jul → Summer AY (year-1)-(year)
  if (month >= 8) {
    return `AY ${year}–${year + 1} · 1st Semester`;
  } else if (month >= 6) {
    return `AY ${year - 1}–${year} · Summer`;
  } else {
    return `AY ${year - 1}–${year} · 2nd Semester`;
  }
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, scholastic_status"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  const student = studentRaw as StudentRow | null;
  if (!student) redirect("/profile");

  // Fetch dashboard stats in parallel
  const [
    enrollmentResult,
    concernsActiveResult,
    concernsPendingResult,
    concernsReviewResult,
    violationsActiveResult,
    documentsResult,
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select("subjects(total_units)")
      .eq("student_id", student.id)
      .eq("status", "enrolled"),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .in("status", ["pending", "in_review"]),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("status", "pending"),
    supabase
      .from("concerns")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("status", "in_review"),
    supabase
      .from("violations")
      .select("*", { count: "exact", head: true })
      .eq("student_id", student.id)
      .eq("status", "active"),
    supabase
      .from("student_files")
      .select("uploaded_at", { count: "exact" })
      .eq("student_id", student.id)
      .order("uploaded_at", { ascending: false })
      .limit(1),
  ]);

  type EnrollmentSubject = { subjects: { total_units: number } | null };
  const enrollments = (enrollmentResult.data as unknown as EnrollmentSubject[]) ?? [];
  const enrolledSubjectsCount = enrollments.length;
  const totalUnits = enrollments.reduce(
    (sum, e) => sum + (e.subjects?.total_units || 0),
    0
  );
  const isEnrolled = enrolledSubjectsCount > 0;

  const activeConcerns = concernsActiveResult.count ?? 0;
  const pendingConcerns = concernsPendingResult.count ?? 0;
  const inReviewConcerns = concernsReviewResult.count ?? 0;
  const activeViolations = violationsActiveResult.count ?? 0;
  const documentsCount = documentsResult.count ?? 0;

  const lastUploadedRow = documentsResult.data?.[0] as
    | { uploaded_at: string }
    | undefined;
  const lastUpload = lastUploadedRow
    ? new Date(lastUploadedRow.uploaded_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "No uploads yet";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Dashboard" }]}
        title={`${getGreeting()}, ${student.first_name}.`}
        description={`Here's an overview of your student profile for ${getCurrentAcademicTerm()}.`}
      >
        <Link
          href="/concerns/new"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-md text-xs font-medium bg-tup-maroon-600 text-white hover:bg-tup-maroon-700 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Submit a Concern
        </Link>
      </PageHeader>

      {/* Stats grid — 4 cards matching mockup */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatsCard
          label="Enrollment"
          value={isEnrolled ? "Enrolled" : "Not enrolled"}
          trend={
            isEnrolled
              ? `${totalUnits} units · ${enrolledSubjectsCount} subjects`
              : "Pending registration"
          }
          trendTone={isEnrolled ? "up" : "warn"}
          icon={CheckCircle2}
          iconTone={isEnrolled ? "success" : "warn"}
        />
        <StatsCard
          label="Active Concerns"
          value={activeConcerns}
          trend={
            activeConcerns > 0
              ? `${inReviewConcerns} in review · ${pendingConcerns} pending`
              : "No active concerns"
          }
          trendTone={activeConcerns > 0 ? "warn" : "up"}
          icon={MessageSquare}
          iconTone={activeConcerns > 0 ? "warn" : "neutral"}
        />
        <StatsCard
          label="Violations"
          value={activeViolations}
          trend={activeViolations === 0 ? "Clean record" : "Requires attention"}
          trendTone={activeViolations === 0 ? "up" : "danger"}
          icon={activeViolations === 0 ? CheckCircle2 : AlertTriangle}
          iconTone={activeViolations === 0 ? "success" : "danger"}
        />
        <StatsCard
          label="Documents"
          value={documentsCount}
          trend={
            documentsCount > 0 ? `Last upload: ${lastUpload}` : "No documents yet"
          }
          icon={FolderOpen}
          iconTone="neutral"
        />
      </div>

      {/* Quick Access section */}
      <div className="flex items-baseline justify-between mb-3.5">
        <h2 className="text-base font-semibold">Quick Access</h2>
        <span className="text-xs text-muted-foreground font-mono">
          6 modules
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          title="Electronic Registration"
          description="View enrollment, select subjects, and manage your academic profile."
          icon={BookOpen}
          href="/enrollment"
        />
        <ModuleCard
          title="Submit a Concern"
          description="File guidance or complaint requests. Reviewed with AI-assisted triage."
          icon={MessageSquare}
          href="/concerns"
          linkLabel="New concern"
          variant="ai"
        />
        <ModuleCard
          title="Violation History"
          description="Review your disciplinary record and resolution status."
          icon={ShieldAlert}
          href="/violations"
          linkLabel="View history"
        />
        <ModuleCard
          title="Digital ID"
          description="Generate a verifiable QR code for use across campus services."
          icon={IdCard}
          href="/id"
          linkLabel="Show ID"
        />
        <ModuleCard
          title="File Management"
          description="Upload, archive, and retrieve official student documents securely."
          icon={FolderOpen}
          href="/documents"
          linkLabel="Browse files"
        />
        <ModuleCard
          title="Announcements"
          description="Latest notices from OSA, the Guidance Office, and the Registrar."
          icon={Megaphone}
          href="/messages"
          linkLabel="Read all"
        />
      </div>
    </div>
  );
}
