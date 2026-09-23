"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader2,
  Search,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
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
}

interface FileCaseFormProps {
  violationTypes: ViolationTypeOption[];
  /** Faculty file as faculty; OSA can also file on the office's own motion. */
  defaultComplainantType: "faculty" | "staff" | "osa_initiated";
  canFileOsaInitiated: boolean;
  filerName: string;
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
}: FileCaseFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
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
  const routesToCodi =
    selectedType?.auto_route_codi || selectedType?.default_classification === "confidential";

  const grouped = {
    minor: violationTypes.filter((type) => type.default_classification === "minor"),
    major: violationTypes.filter((type) => type.default_classification === "major"),
    confidential: violationTypes.filter(
      (type) => type.default_classification === "confidential" || type.auto_route_codi,
    ),
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
              <optgroup label="Confidential (routed to CODI)">
                {grouped.confidential.map((type) => (
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
            ) : (
              <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Filed as a <strong className="mx-1">{selectedType.default_classification}</strong>
                offense. The OSA may reclassify after review — that change is recorded in the
                case history.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Date of incident</span>
            <input type="date" name="incident_date" required className={inputClass} />
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
            placeholder="Describe what you observed: what the student did, when, who else was present, and anything already said to them about it. Stick to what you saw yourself."
            className={inputClass}
          />
          <span className="block text-[11px] text-muted-foreground">
            The student will see this description when the case reaches them. Write it as
            something you would be comfortable reading aloud at a hearing.
          </span>
        </label>
      </section>

      {/* 3. Who is filing */}
      <section className="rounded-xl border border-border bg-card p-5">
        <SectionHeading step={3} title="Who is filing?" />

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
          You are recorded as the filer either way. If a meeting is scheduled, you approve
          the date before the student is summoned — nothing is sent to them on filing.
        </p>
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
