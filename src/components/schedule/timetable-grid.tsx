import { cn } from "@/lib/utils";

interface ScheduleEntry {
  id: string;
  subject_code: string;
  subject_description: string;
  section_code: string;
  faculty_name: string;
  day_of_week: string;
  start_time: string; // "HH:MM:SS" or "HH:MM"
  end_time: string;
  room: string;
}

interface TimetableGridProps {
  schedules: ScheduleEntry[];
  /** Earliest hour to display (24h). Default 7. */
  startHour?: number;
  /** Latest hour to display (24h, exclusive). Default 21 (9 PM). */
  endHour?: number;
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const SHORT_DAYS: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

// Tailwind color palette for subject blocks. Same subject code → same color.
const COLORS = [
  "bg-blue-500/15 border-blue-500/40 text-blue-900 dark:text-blue-200",
  "bg-emerald-500/15 border-emerald-500/40 text-emerald-900 dark:text-emerald-200",
  "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-200",
  "bg-violet-500/15 border-violet-500/40 text-violet-900 dark:text-violet-200",
  "bg-pink-500/15 border-pink-500/40 text-pink-900 dark:text-pink-200",
  "bg-cyan-500/15 border-cyan-500/40 text-cyan-900 dark:text-cyan-200",
  "bg-indigo-500/15 border-indigo-500/40 text-indigo-900 dark:text-indigo-200",
  "bg-rose-500/15 border-rose-500/40 text-rose-900 dark:text-rose-200",
];

function colorForSubject(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function timeToHalfHours(time: string): number {
  const [hours, minutes] = time.split(":").map((s) => parseInt(s, 10));
  return hours * 2 + (minutes >= 30 ? 1 : 0);
}

function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display} ${period}`;
}

export function TimetableGrid({
  schedules,
  startHour = 7,
  endHour = 21,
}: TimetableGridProps) {
  const totalSlots = (endHour - startHour) * 2; // 30-min slots
  const startSlot = startHour * 2;

  // Group by day
  const byDay = new Map<string, ScheduleEntry[]>();
  for (const day of DAYS) byDay.set(day, []);
  for (const sched of schedules) {
    byDay.get(sched.day_of_week)?.push(sched);
  }

  return (
    <div className="overflow-x-auto">
      {/* Container has min-width so days don't squish on mobile */}
      <div className="min-w-[700px]">
        {/* Header row: Day names */}
        <div className="grid grid-cols-[60px_repeat(7,minmax(80px,1fr))] gap-px bg-border rounded-t-lg overflow-hidden">
          <div className="bg-muted px-2 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
            Time
          </div>
          {DAYS.map((day) => (
            <div
              key={day}
              className="bg-muted px-2 py-3 text-xs font-semibold text-center"
            >
              <span className="hidden sm:inline">{day}</span>
              <span className="sm:hidden">{SHORT_DAYS[day]}</span>
            </div>
          ))}
        </div>

        {/* Body grid */}
        <div
          className="grid grid-cols-[60px_repeat(7,minmax(80px,1fr))] gap-px bg-border rounded-b-lg overflow-hidden border border-t-0"
          style={{
            gridTemplateRows: `repeat(${totalSlots}, minmax(20px, 1fr))`,
          }}
        >
          {/* Time column */}
          {Array.from({ length: endHour - startHour }, (_, i) => {
            const hour = startHour + i;
            return (
              <div
                key={`time-${hour}`}
                className="bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground text-right border-b border-border/40"
                style={{ gridRow: `${i * 2 + 1} / span 2`, gridColumn: 1 }}
              >
                {formatHour(hour)}
              </div>
            );
          })}

          {/* Background day cells (alternate stripes for readability) */}
          {DAYS.map((day, dayIdx) => (
            <div
              key={`bg-${day}`}
              className={cn(
                "bg-background",
                dayIdx % 2 === 1 && "bg-muted/30"
              )}
              style={{
                gridRow: `1 / span ${totalSlots}`,
                gridColumn: dayIdx + 2,
              }}
            />
          ))}

          {/* Class blocks */}
          {DAYS.map((day, dayIdx) => {
            const daySchedules = byDay.get(day) || [];
            return daySchedules.map((sched) => {
              const start = timeToHalfHours(sched.start_time);
              const end = timeToHalfHours(sched.end_time);
              const rowStart = start - startSlot + 1;
              const rowSpan = Math.max(1, end - start);
              const color = colorForSubject(sched.subject_code);

              if (rowStart < 1 || rowStart > totalSlots) return null;

              return (
                <div
                  key={`${day}-${sched.id}`}
                  className={cn(
                    "rounded-md border-l-4 px-2 py-1.5 m-0.5 overflow-hidden text-[11px] leading-tight",
                    color
                  )}
                  style={{
                    gridRow: `${rowStart} / span ${rowSpan}`,
                    gridColumn: dayIdx + 2,
                  }}
                  title={`${sched.subject_code}: ${sched.subject_description}\n${sched.faculty_name}\nRoom ${sched.room}`}
                >
                  <p className="font-display font-semibold truncate">
                    {sched.subject_code}
                  </p>
                  <p className="truncate text-[10px] opacity-80">
                    {sched.start_time.slice(0, 5)}–{sched.end_time.slice(0, 5)}
                  </p>
                  <p className="truncate text-[10px] opacity-70">
                    {sched.room}
                  </p>
                </div>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}
