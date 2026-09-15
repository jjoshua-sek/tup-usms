/**
 * Hearing slot finder — requirement #1.
 *
 * Cross-checks the complainant's (professor's) and complainee's (student's)
 * schedules to propose viable conference times. The professor approves one
 * before the student is notified; that ordering is enforced at the database
 * level by the `notify_requires_approval` constraint on case_hearings.
 *
 * ALGORITHM
 *   1. Expand each party's recurring + one-off busy blocks into concrete
 *      datetime intervals across the search horizon.
 *   2. Merge each party's intervals (union) to get their busy set.
 *   3. Walk candidate start times at a fixed granularity; keep those where
 *      the proposed window collides with neither party's busy set and falls
 *      inside business hours, outside lunch.
 *   4. Score each surviving candidate; return the top N.
 *
 * This is deterministic interval arithmetic, not a heuristic search. For
 * the scale involved — two calendars over a two-week horizon — an exact
 * sweep is both feasible and preferable to anything approximate, because
 * a missed valid slot means a case sits idle.
 */

export interface AvailabilityBlock {
  id: string;
  user_id: string;
  day_of_week: string | null;
  specific_date: string | null; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  block_type: "busy" | "free";
  source: string;
  label: string | null;
  valid_from: string | null;
  valid_until: string | null;
}

export interface SchedulingConfig {
  minNoticeDays: number;
  maxHorizonDays: number;
  durationMinutes: number;
  businessHours: { start: string; end: string };
  lunchBreak: { start: string; end: string };
  preferredWindows: Array<{ start: string; end: string; bonus: number }>;
  avoidFridayAfternoon: boolean;
  maxProposals: number;
}

export const DEFAULT_CONFIG: SchedulingConfig = {
  minNoticeDays: 2,
  maxHorizonDays: 14,
  durationMinutes: 45,
  businessHours: { start: "08:00", end: "17:00" },
  lunchBreak: { start: "12:00", end: "13:00" },
  preferredWindows: [
    { start: "09:00", end: "11:00", bonus: 0.15 },
    { start: "14:00", end: "16:00", bonus: 0.1 },
  ],
  avoidFridayAfternoon: true,
  maxProposals: 5,
};

export interface SlotProposal {
  start: Date;
  end: Date;
  score: number;
  rationale: string;
  factors: {
    daysOut: number;
    inPreferredWindow: boolean;
    dayOfWeek: string;
    isFridayAfternoon: boolean;
    complainantFreeMinutesAround: number;
    studentFreeMinutesAround: number;
  };
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Candidate start times are generated on this grid. */
const SLOT_GRANULARITY_MINUTES = 30;

// ============================================================
// Time helpers
// ============================================================

/** "HH:MM" or "HH:MM:SS" → minutes past midnight. */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutesToTimeLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function toDateOnlyString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// ============================================================
// Interval model
// ============================================================

interface Interval {
  start: number; // minutes past midnight
  end: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  // Touching endpoints do not overlap: a block ending at 10:00 and one
  // starting at 10:00 are compatible.
  return a.start < b.end && b.start < a.end;
}

/** Union of intervals, sorted and coalesced. */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

/**
 * Resolves a party's busy intervals for one specific calendar day, from
 * their recurring weekly blocks plus any one-off blocks on that date.
 */
function busyIntervalsForDay(
  blocks: AvailabilityBlock[],
  day: Date
): Interval[] {
  const dayName = DAY_NAMES[day.getDay()];
  const dateStr = toDateOnlyString(day);
  const result: Interval[] = [];

  for (const b of blocks) {
    if (b.block_type !== "busy") continue;

    // Respect validity windows so last semester's class schedule does not
    // block this semester's hearings.
    if (b.valid_from && dateStr < b.valid_from) continue;
    if (b.valid_until && dateStr > b.valid_until) continue;

    const isRecurringMatch = b.day_of_week != null && b.day_of_week === dayName;
    const isSpecificMatch = b.specific_date != null && b.specific_date === dateStr;

    if (isRecurringMatch || isSpecificMatch) {
      result.push({
        start: parseTimeToMinutes(b.start_time),
        end: parseTimeToMinutes(b.end_time),
      });
    }
  }

  return mergeIntervals(result);
}

/**
 * Minutes of contiguous free time immediately surrounding a slot.
 * A slot with breathing room on both sides is better than one wedged
 * between two commitments — both parties arrive less rushed, and the
 * meeting can run over without cascading into someone's next class.
 */
function freeMarginAround(
  busy: Interval[],
  slot: Interval,
  dayStart: number,
  dayEnd: number
): number {
  let before = slot.start - dayStart;
  let after = dayEnd - slot.end;

  for (const b of busy) {
    if (b.end <= slot.start) before = Math.min(before, slot.start - b.end);
    if (b.start >= slot.end) after = Math.min(after, b.start - slot.end);
  }

  return Math.max(0, before) + Math.max(0, after);
}

// ============================================================
// Scoring
// ============================================================

/**
 * Produces a desirability score in [0, 1].
 *
 * The weighting reflects an operational judgment: resolving a disciplinary
 * case promptly matters more than holding it at an ideal hour. Delay is
 * itself harmful — the student stays in limbo and memories fade — so
 * recency carries the largest single weight.
 */
function scoreSlot(
  slotStart: Date,
  slotEnd: Date,
  now: Date,
  config: SchedulingConfig,
  complainantMargin: number,
  studentMargin: number
): { score: number; rationale: string; factors: SlotProposal["factors"] } {
  const reasons: string[] = [];

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysOut = Math.max(
    0,
    Math.round((slotStart.getTime() - now.getTime()) / msPerDay)
  );

  // ---- Promptness: 45% of the score ----
  // Linear decay across the horizon. Earliest permissible slot scores 1.0.
  const promptness =
    1 - Math.min(1, Math.max(0, daysOut - config.minNoticeDays) / config.maxHorizonDays);
  let score = promptness * 0.45;

  if (daysOut <= config.minNoticeDays + 1) {
    reasons.push("earliest available");
  } else {
    reasons.push(`${daysOut} days out`);
  }

  // ---- Preferred time window: up to 20% ----
  const slotMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
  let inPreferred = false;
  let windowBonus = 0;

  for (const w of config.preferredWindows) {
    const ws = parseTimeToMinutes(w.start);
    const we = parseTimeToMinutes(w.end);
    if (slotMinutes >= ws && slotMinutes < we) {
      inPreferred = true;
      windowBonus = Math.max(windowBonus, w.bonus);
    }
  }
  score += windowBonus;
  if (inPreferred) {
    reasons.push(slotMinutes < 720 ? "mid-morning" : "mid-afternoon");
  }

  // ---- Scheduling margin: up to 20% ----
  // Normalized against two hours of combined breathing room.
  const combinedMargin = complainantMargin + studentMargin;
  const marginScore = Math.min(1, combinedMargin / 120) * 0.2;
  score += marginScore;
  if (combinedMargin >= 90) {
    reasons.push("both parties have surrounding free time");
  } else if (combinedMargin < 30) {
    reasons.push("tight for both parties");
  }

  // ---- Day-of-week adjustment: up to 15% ----
  const dow = slotStart.getDay();
  const dayName = DAY_NAMES[dow];
  const isFriday = dow === 5;
  const isAfternoon = slotMinutes >= 13 * 60;
  const isFridayAfternoon = isFriday && isAfternoon;

  if (config.avoidFridayAfternoon && isFridayAfternoon) {
    // Penalized: attendance is poor, and any follow-up stalls until Monday.
    score -= 0.12;
    reasons.push("Friday afternoon — lower attendance likelihood");
  } else if (dow >= 2 && dow <= 4) {
    // Tue–Thu are the most reliable attendance days.
    score += 0.15;
  } else if (dow === 1) {
    score += 0.08;
  }

  // Weekends are excluded before scoring, so no branch is needed here.

  score = Math.min(1, Math.max(0, score));

  return {
    score,
    rationale: `Both free · ${reasons.join(" · ")}`,
    factors: {
      daysOut,
      inPreferredWindow: inPreferred,
      dayOfWeek: dayName,
      isFridayAfternoon,
      complainantFreeMinutesAround: complainantMargin,
      studentFreeMinutesAround: studentMargin,
    },
  };
}

// ============================================================
// Main entry point
// ============================================================

export interface FindSlotsParams {
  complainantBlocks: AvailabilityBlock[];
  studentBlocks: AvailabilityBlock[];
  config?: Partial<SchedulingConfig>;
  /** Injectable for deterministic tests. Defaults to now. */
  now?: Date;
}

/**
 * Returns up to `maxProposals` ranked slots where both parties are free.
 *
 * Returns an empty array when no mutually free slot exists in the horizon.
 * The caller must handle that case explicitly — in the UI it becomes a
 * prompt for the OSA officer to either extend the horizon or schedule
 * manually, rather than a silent failure.
 */
export function findAvailableSlots({
  complainantBlocks,
  studentBlocks,
  config: configOverrides,
  now = new Date(),
}: FindSlotsParams): SlotProposal[] {
  const config: SchedulingConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  const dayStart = parseTimeToMinutes(config.businessHours.start);
  const dayEnd = parseTimeToMinutes(config.businessHours.end);
  const lunchStart = parseTimeToMinutes(config.lunchBreak.start);
  const lunchEnd = parseTimeToMinutes(config.lunchBreak.end);
  const duration = config.durationMinutes;

  const candidates: SlotProposal[] = [];

  // Earliest permissible day, honoring the minimum notice period.
  const searchStart = new Date(now);
  searchStart.setDate(searchStart.getDate() + config.minNoticeDays);
  searchStart.setHours(0, 0, 0, 0);

  for (let offset = 0; offset <= config.maxHorizonDays; offset++) {
    const day = new Date(searchStart);
    day.setDate(day.getDate() + offset);

    // Skip weekends — OSA does not hold conferences outside working days.
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;

    const complainantBusy = busyIntervalsForDay(complainantBlocks, day);
    const studentBusy = busyIntervalsForDay(studentBlocks, day);

    // Sweep candidate start times across the working day.
    for (
      let start = dayStart;
      start + duration <= dayEnd;
      start += SLOT_GRANULARITY_MINUTES
    ) {
      const slot: Interval = { start, end: start + duration };

      // Exclude lunch.
      if (overlaps(slot, { start: lunchStart, end: lunchEnd })) continue;

      // Exclude collisions with either party.
      if (complainantBusy.some((b) => overlaps(slot, b))) continue;
      if (studentBusy.some((b) => overlaps(slot, b))) continue;

      const slotStart = atMinutes(day, start);
      const slotEnd = atMinutes(day, start + duration);

      // A slot earlier today than "now + notice" is not actually valid.
      if (slotStart.getTime() <= now.getTime()) continue;

      const complainantMargin = freeMarginAround(
        complainantBusy,
        slot,
        dayStart,
        dayEnd
      );
      const studentMargin = freeMarginAround(studentBusy, slot, dayStart, dayEnd);

      const { score, rationale, factors } = scoreSlot(
        slotStart,
        slotEnd,
        now,
        config,
        complainantMargin,
        studentMargin
      );

      candidates.push({ start: slotStart, end: slotEnd, score, rationale, factors });
    }
  }

  // Rank, then thin out near-duplicates: five options at 9:00, 9:30, 10:00
  // on the same morning is a worse menu than five options across different
  // days, because it gives the professor no meaningful choice.
  candidates.sort((a, b) => b.score - a.score);

  const selected: SlotProposal[] = [];
  const perDayCount = new Map<string, number>();
  const MAX_PER_DAY = 2;

  for (const c of candidates) {
    if (selected.length >= config.maxProposals) break;
    const dayKey = toDateOnlyString(c.start);
    const count = perDayCount.get(dayKey) ?? 0;
    if (count >= MAX_PER_DAY) continue;
    selected.push(c);
    perDayCount.set(dayKey, count + 1);
  }

  return selected;
}

/**
 * Formats a proposal for display, e.g.
 * "Tuesday, May 12 · 9:00 AM – 9:45 AM"
 */
export function formatSlot(slot: SlotProposal): string {
  const dateLabel = slot.start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const startMin = slot.start.getHours() * 60 + slot.start.getMinutes();
  const endMin = slot.end.getHours() * 60 + slot.end.getMinutes();
  return `${dateLabel} · ${minutesToTimeLabel(startMin)} – ${minutesToTimeLabel(endMin)}`;
}

/**
 * Derives busy blocks from a Certificate of Registration's parsed class
 * schedule. Called after an OSA officer verifies an extracted COR, so a
 * student's class times automatically become scheduling constraints
 * without the student having to enter them by hand.
 */
export function classScheduleToBlocks(
  userId: string,
  schedule: Array<{
    day_of_week: string;
    start_time: string;
    end_time: string;
    subject_code?: string;
  }>,
  term: { school_year: string; semester: string; valid_from?: string; valid_until?: string }
): Array<Omit<AvailabilityBlock, "id">> {
  return schedule.map((s) => ({
    user_id: userId,
    day_of_week: s.day_of_week,
    specific_date: null,
    start_time: s.start_time,
    end_time: s.end_time,
    block_type: "busy" as const,
    source: "cor_import",
    label: s.subject_code ?? "Class",
    valid_from: term.valid_from ?? null,
    valid_until: term.valid_until ?? null,
  }));
}
