"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WarningIcon as AlertTriangle, CheckIcon as Check, CircleNotchIcon as Loader2, MagnifyingGlassIcon as Search, ShieldWarningIcon as ShieldAlert, UserIcon as UserRound, XIcon as X } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import {
  fileCase,
  getStudentTrackRecord,
  searchStudentsForCase,
  type StudentMatch,
  type TrackRecord,
} from "@/app/staff/cases/actions";
import { Button } from "@/components/ui/button";
import { formatManilaDate } from "@/lib/utils/time";

export interface ViolationTypeOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  default_classification: "minor" | "major" | "confidential";
  handbook_reference: string | null;
  typical_sanction: string | null;
  auto_route_codi: boolean;
  /** False only for OTH-01: the OSA classifies it after review (00049, checklist A2). */
  in_handbook?: boolean;
}

/** A student's complaint (checklist A3) the OSA is filing as a case. */
export interface ComplaintSource {
  concernId: string;
  respondentName: string;
  respondentDetails: string | null;
  incidentDate: string | null;
  incidentLocation: string | null;
  description: string;
}

interface FileCaseFormProps {
  violationTypes: ViolationTypeOption[];
  /** Faculty file as faculty; OSA can also file on the office's own motion. */
  defaultComplainantType: "faculty" | "staff" | "osa_initiated";
  canFileOsaInitiated: boolean;
  filerName: string;
  fromComplaint?: ComplaintSource | null;
}

const COMPLAINANT_TYPES = [
  { value: "faculty", label: "Faculty member (me)" },
  { value: "staff", label: "Staff member (me)" },
  { value: "osa_initiated", label: "OSA's own observation" },
  { value: "student", label: "Relayed from a student" },
  { value: "external", label: "External party" },
] as const;

export function FileCaseForm({
  violationTypes,
  defaultComplainantType,
  canFileOsaInitiated,
  filerName,
  fromComplaint = null,
}: FileCaseFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // From a complaint, the search starts on the surname the student gave: the
  // search matches one name field at a time, so a full name finds nothing.
  const complaintSurname = (fromComplaint?.respondentName ?? "").trim().split(/\s+/).pop() ?? "";
  const [query, setQuery] = useState(complaintSurname);
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<StudentMatch | null>(null);
  const [record, setRecord] = useState<TrackRecord | null>(null);

  const [typeId, setTypeId] = useState("");
  const [complainantType, setComplainantType] =
    useState<string>(defaultComplainantType);

  // Ignore stale responses: a fast typist can outrun the network, and the
  // wrong student appearing under the cursor is exactly the failure this
  // search exists to prevent.
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Driven by the input's own handler rather than an effect on `query`:
  // searching is a reaction to the user typing, not state React needs to
  // synchronise, and setState inside an effect body would cascade renders.
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);

    const term = value.trim();
    if (term.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const requestId = ++requestRef.current;
    timerRef.current = setTimeout(async () => {
      const result = await searchStudentsForCase(term);
      if (requestRef.current !== requestId) return;
      setMatches(result.students ?? []);
      setSearching(false);
    }, 250);
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // A complaint names the student in words; show the records that match it.
  useEffect(() => {
    if (complaintSurname.length < 2) return;
    let cancelled = false;
    void searchStudentsForCase(complaintSurname).then((result) => {
      if (!cancelled) setMatches(result.students ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [complaintSurname]);

  const pickStudent = (student: StudentMatch) => {
    setSelected(student);
    setMatches([]);
    setQuery("");
    setRecord(null);
    void getStudentTrackRecord(student.id).then((result) => {
      if (result.record) setRecord(result.record);
    });
  };

  const selectedType = violationTypes.find((type) => type.id === typeId) ?? null;
  // Checklist A7: CODI takes what the law sends it; other confidential
  // types stay with the OSA as restricted cases (migration 00040).
  const routesToCodi = Boolean(selectedType?.auto_route_codi);
  const restricted = !routesToCodi && selectedType?.default_classification === "confidential";
  // Checklist A2: the Manual classifies first; the OSA classifies what it does not list.
  const unlisted = selectedType?.in_handbook === false;

  const listed = violationTypes.filter((type) => type.in_handbook !== false);
  const grouped = {
    minor: listed.filter((type) => type.default_classification === "minor"),
    major: listed.filter((type) => type.default_classification === "major"),
    confidential: listed.filter(
      (type) => type.default_classification === "confidential" || type.auto_route_codi,
    ),
    unlisted: violationTypes.filter((type) => type.in_handbook === false),
  };

  const needsName = complainantType === "student" || complainantType === "external";

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const result = await fileCase(formData);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(result.message ?? "Case filed.");
          if (result.caseId) router.push(`/staff/cases/${result.caseId}`);
          else router.push("/staff/cases");
        })
      }
      className="space-y-6"
    >
      {/* 1. Who */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading step={1} title="Who is the complaint against?" />

        {fromComplaint && (
          <p className="mb-3 rounded-lg bg-muted p-3 text-[12px] leading-relaxed">
            The student&rsquo;s complaint names <strong>{fromComplaint.respondentName}</strong>
            {fromComplaint.respondentDetails ? ` (${fromComplaint.respondentDetails})` : ""}. Pick the matching
            student record below; search by number or surname if it is not listed.
          </p>
        )}

        {selected ? (
          <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold">
                    {selected.first_name} {selected.last_name}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {selected.student_number}
                    {selected.program ? ` · ${selected.program}` : ""}
                    {selected.year_level ? ` · ${selected.year_level}` : ""}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setRecord(null);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted"
              >
                <X className="h-3 w-3" />
                Change
              </button>
            </div>

            {/* Requirement #2 — the filer sees the track record before submitting */}
            {record && (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border pt-3 text-[12px]">
                <span className="text-muted-foreground">Track record:</span>
                <span>
                  <strong>{record.minor}</strong> minor
                </span>
                <span>
                  <strong>{record.major}</strong> major
                </span>
                <span className={record.open > 0 ? "text-amber-700" : ""}>
                  <strong>{record.open}</strong> still open
                </span>
                {record.lastIncidentDate && (
                  <span className="text-muted-foreground">
                    last incident {formatManilaDate(record.lastIncidentDate)}
                  </span>
                )}
                {record.minor + record.major === 0 && (
                  <span className="text-emerald-700">first offense on record</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-tup-maroon-600">
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <input
                value={query}
                onChange={(event) => handleQueryChange(event.target.value)}
                placeholder="Search by student number or surname — e.g. TUPM-22-0148 or Dela Cruz"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>

            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
                {matches.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      onClick={() => pickStudent(match)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">
                          {match.first_name} {match.last_name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {match.student_number}
                          {match.program ? ` · ${match.program}` : ""}
                        </span>
                      </span>
                      <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {query.trim().length >= 2 && !searching && matches.length === 0 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                No student matches that. Check the number on their ID.
              </p>
            )}
          </div>
        )}

        <input type="hidden" name="student_id" value={selected?.id ?? ""} />
      </section>

      {/* 2. What */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading step={2} title="What happened?" />

        <label className="block space-y-1">
          <span className="text-xs font-medium">Offense</span>
          <select
            name="violation_type_id"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            required
            className={inputClass}
          >
            <option value="">Choose the offense…</option>
            <optgroup label="Minor">
              {grouped.minor.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} — {type.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Major">
              {grouped.major.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} — {type.name}
                </option>
              ))}
            </optgroup>
            {grouped.confidential.length > 0 && (
              <optgroup label="Confidential">
                {grouped.confidential.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} — {type.name}
                  </option>
                ))}
              </optgroup>
            )}
            {grouped.unlisted.length > 0 && (
              <optgroup label="Not in the Student Manual">
                {grouped.unlisted.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} — {type.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {selectedType && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg bg-muted p-3 text-[12px] leading-relaxed">
              {selectedType.description}
              {selectedType.handbook_reference && (
                <span className="mt-1 block text-muted-foreground">
                  {selectedType.handbook_reference}
                  {selectedType.typical_sanction
                    ? ` · usual outcome: ${selectedType.typical_sanction}`
                    : ""}
                </span>
              )}
            </p>

            {routesToCodi ? (
              <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] leading-relaxed text-red-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This is filed <strong>confidentially</strong> and goes straight to the
                  Committee on Decorum and Investigation. It will not appear in the general
                  OSA case queue, and only CODI members can open it. Do not discuss it with
                  other staff.
                </span>
              </p>
            ) : restricted ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This is filed as a <strong>restricted</strong> case. The OSA handles it, but only the OSA head,
                  the administrator and the assigned officer can open it (you, if you are an OSA officer). Do not
                  discuss it with other staff.
                </span>
              </p>
            ) : unlisted ? (
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                The Student Manual does not list this, so the OSA classifies it as minor or major
                after review, and decides the sanction.
              </p>
            ) : (
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Filed as a <strong className="mx-1">{selectedType.default_classification}</strong>
                offense, as the Student Manual classifies it. The sanction is decided by the OSA.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Date of incident</span>
            <input
              type="date"
              name="incident_date"
              required
              defaultValue={fromComplaint?.incidentDate ?? undefined}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Time (optional)</span>
            <input type="time" name="incident_time" className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">Where (optional)</span>
            <input
              name="incident_location"
              maxLength={120}
              defaultValue={fromComplaint?.incidentLocation ?? undefined}
              placeholder="e.g. Room 304, Main Bldg."
              className={inputClass}
            />
          </label>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-xs font-medium">
            What happened, in your own words
          </span>
          <textarea
            name="description"
            required
            rows={6}
            minLength={30}
            maxLength={5000}
            defaultValue={fromComplaint?.description.slice(0, 5000)}
            placeholder="Describe what you observed: what the student did, when, who else was present, and anything already said to them about it. Stick to what you saw yourself."
            className={inputClass}
          />
          <span className="block text-[11px] text-muted-foreground">
            The student will see this description when the case reaches them. Write it as
            something you would be comfortable reading aloud at a hearing.
          </span>
          {fromComplaint && (
            <span className="block text-[11px] font-medium text-amber-800">
              Copied from the complaint. Take out the complainant&rsquo;s name and anything that identifies them,
              unless they agreed to be named.
            </span>
          )}
        </label>
      </section>

      {/* 3. Who is filing */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading step={3} title="Who is filing?" />

        {fromComplaint ? (
          <>
            <input type="hidden" name="source_concern_id" value={fromComplaint.concernId} />
            <input type="hidden" name="complainant_type" value="student" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Filed for the student who complained. The case names them only as &ldquo;a student&rdquo;; who they
              are stays on their concern, which only they and OSA staff can read. They are told in their concern
              that the case was filed. You are recorded as the filer, and the OSA sets the hearing date.
            </p>
          </>
        ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Filing as</span>
            <select
              name="complainant_type"
              value={complainantType}
              onChange={(event) => setComplainantType(event.target.value)}
              className={inputClass}
            >
              {COMPLAINANT_TYPES.filter(
                (option) => option.value !== "osa_initiated" || canFileOsaInitiated,
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">
              Complainant name {needsName ? "" : "(optional)"}
            </span>
            <input
              name="complainant_name"
              maxLength={120}
              required={needsName}
              placeholder={needsName ? "Name of the person reporting" : filerName}
              className={inputClass}
            />
          </label>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          You are recorded as the filer either way, and nothing is sent to the student on filing. If you are
          faculty and a meeting is scheduled, you approve the date before the student is summoned.
        </p>
        </>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/staff/cases")}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending || !selected}
          className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
        >
          {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          File the case
        </Button>
      </div>
    </form>
  );
}

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-tup-maroon-600 text-[11px] font-semibold text-white">
        {step}
      </span>
      <h2 className="font-display text-base font-semibold">{title}</h2>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";
