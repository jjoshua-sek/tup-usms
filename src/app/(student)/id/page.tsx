import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { User } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { RotatingQr, RotatingQrVisual } from "@/components/id/rotating-qr";
import { issueIdToken } from "./actions";

export const metadata: Metadata = {
  title: "Digital ID",
};

interface StudentRow {
  id: string;
  first_name: string;
  last_name: string;
  student_number: string;
  program: string;
  year_level: string;
  department: string;
  campus: string;
  photo_url: string | null;
}

function getCurrentAcademicYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) {
    return `AY ${year}–${year + 1}`;
  }
  return `AY ${year - 1}–${year}`;
}

const VALID_FOR = [
  "Campus Access",
  "OSA Transactions",
  "Library Borrowing",
  "Exam Verification",
  "Lab Reservation",
];

const NOT_VALID_FOR = ["Financial Transactions", "Grade Retrieval"];

export default async function DigitalIdPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: studentRaw } = await supabase
    .from("students")
    .select(
      "id, first_name, last_name, student_number, program, year_level, department, campus, photo_url"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const student = studentRaw as StudentRow | null;
  if (!student) redirect("/profile");

  // Server-issue first token for fast first paint (no client flash)
  const { token, expiresAt } = await issueIdToken();
  const initialToken = token ?? "";
  const initialExpiresAt = expiresAt ?? Date.now() + 60_000;

  const academicYear = getCurrentAcademicYear();

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Digital ID" },
        ]}
        title="Your Verifiable Digital ID"
        description={`This is your active TUP — Manila digital credential for ${academicYear}.`}
      />

      <div className="grid lg:grid-cols-2 gap-10 items-center">
        {/* DIGITAL ID CARD */}
        <div
          className="relative bg-tup-gradient text-white p-7 rounded-2xl shadow-[0_4px_12px_rgba(122,31,43,0.2),0_20px_40px_rgba(0,0,0,0.15)] flex flex-col justify-between overflow-hidden"
          style={{ aspectRatio: "1.586 / 1" }}
        >
          {/* Decorative gold radial blob */}
          <div
            className="absolute -top-20 -right-20 w-56 h-56 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(212,160,23,0.2), transparent 70%)",
            }}
            aria-hidden="true"
          />

          {/* TOP: brand */}
          <div className="flex justify-between items-start relative z-10">
            <div className="text-[11px] tracking-wider opacity-85 leading-snug">
              <strong className="block text-tup-gold-500 font-semibold text-sm mb-1 tracking-wide">
                TUP MANILA
              </strong>
              Technological University
              <br />
              of the Philippines
            </div>
            <div
              className="w-10 h-10 rounded-full bg-tup-gold-500 text-tup-maroon-600 font-bold text-sm flex items-center justify-center border-2 border-white"
              aria-label="TUP seal"
            >
              TUP
            </div>
          </div>

          {/* MIDDLE: photo + identity */}
          <div className="grid grid-cols-[auto_1fr] gap-5 items-center relative z-10">
            <div
              className="w-20 h-[100px] rounded bg-white/10 border-2 border-tup-gold-500 flex items-center justify-center overflow-hidden"
              aria-label="Student photo"
            >
              {student.photo_url ? (
                /* eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL */
                <img
                  src={student.photo_url}
                  alt={`${student.first_name} ${student.last_name}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 text-white/40" />
              )}
            </div>

            <div>
              <div className="text-[20px] font-semibold tracking-tight mb-1.5 leading-tight">
                {student.first_name}
                <br />
                {student.last_name}
              </div>
              <div className="text-[10px] leading-[1.6] opacity-85 space-y-0.5">
                <IdMetaRow label="ID" value={student.student_number} />
                <IdMetaRow label="Course" value={student.program} />
                <IdMetaRow label="Year" value={student.year_level} />
                <IdMetaRow
                  label="College"
                  value={student.department}
                />
              </div>
            </div>
          </div>

          {/* BOTTOM: validity + QR */}
          <div className="flex justify-between items-end relative z-10 border-t border-white/20 pt-3.5">
            <div className="text-[9px] tracking-widest uppercase opacity-70">
              Valid
              <br />
              <strong className="text-tup-gold-500 mt-0.5 block tracking-wide">
                {academicYear}
              </strong>
            </div>

            <RotatingQrVisual initialToken={initialToken} />
          </div>
        </div>

        {/* RIGHT: info side */}
        <div>
          <h3 className="text-[22px] font-semibold tracking-tight mb-2">
            Tap to verify identity
          </h3>
          <p className="text-[13px] text-muted-foreground leading-relaxed mb-5">
            Your QR code rotates every <strong className="text-foreground">
              60 seconds
            </strong>{" "}
            for security. When scanned, it reveals only your enrollment
            status and identity — never your full profile.
          </p>

          <RotatingQr
            initialToken={initialToken}
            initialExpiresAt={initialExpiresAt}
          />

          <div className="mt-5 pt-5 border-t border-border">
            <h5 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
              Valid For
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {VALID_FOR.map((label) => (
                <UseTag key={label} label={label} />
              ))}
            </div>

            <h5 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-destructive mt-4 mb-2.5">
              Not Valid For
            </h5>
            <div className="flex flex-wrap gap-1.5">
              {NOT_VALID_FOR.map((label) => (
                <UseTag key={label} label={label} variant="danger" />
              ))}
            </div>
          </div>

          <div className="mt-5 pt-5 border-t border-border">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Data minimization:</strong>{" "}
              When scanned, only the validity status and your name are
              revealed — not your contact information, grades, or
              disciplinary record. This aligns with RA 10173 §11.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function IdMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <strong className="uppercase text-[9px] tracking-widest text-tup-gold-500 font-semibold min-w-[56px]">
        {label}
      </strong>
      <span>{value}</span>
    </div>
  );
}

function UseTag({ label, variant }: { label: string; variant?: "danger" }) {
  if (variant === "danger") {
    return (
      <span className="text-[11px] px-2.5 py-1 rounded-full bg-[#fef2f2] text-[#991b1b] border border-[#fecaca]">
        {label}
      </span>
    );
  }
  return (
    <span className="text-[11px] px-2.5 py-1 rounded-full bg-muted text-foreground border border-border">
      {label}
    </span>
  );
}
