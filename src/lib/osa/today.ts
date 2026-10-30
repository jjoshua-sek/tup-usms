/**
 * The "Today" list on the staff home page: what is waiting for this person,
 * as plain sentences, each with one button. Pure, so the wording, the order
 * and who sees what are tested without a database.
 *
 * Counts come from the same rules the pages use for "waiting" (the Cases
 * page's Needs scheduling tab, Document Review's pending list, and so on);
 * the home page reads them. A task shows only when its count is above zero
 * and its page is in this person's menu (staff-nav.ts).
 */

/**
 * What "waiting" means, one list per queue. The pages that show these queues
 * import the same lists, so the home page's counts always match them.
 */
export const WAITING = {
  /** Cases → Needs scheduling. */
  casesToSchedule: ["filed", "under_review", "counselling_scheduled"],
  /** Check documents → still to be checked. */
  documentsToCheck: ["uploaded", "extracted", "extracting", "verification_failed"],
  /** Clearance requests → Incoming. */
  clearanceRequests: ["submitted", "verifying"],
  /** ID validation → requests not yet decided. */
  idValidations: ["pending", "under_review"],
  /** Follow-ups not finished. */
  openFollowUps: ["recommended", "approved", "scheduled", "in_progress"],
  /** Hearings that will go ahead (not awaiting approval, not over). */
  hearingsGoingAhead: ["student_notified", "student_acknowledged", "confirmed"],
} as const;

/** "Good morning" by the time in Manila, whatever the server's own zone. */
export function greetingFor(manilaMinutes: number): string {
  if (manilaMinutes < 12 * 60) return "Good morning";
  if (manilaMinutes < 18 * 60) return "Good afternoon";
  return "Good evening";
}

export interface TodayCounts {
  urgentConcerns: number;
  criticalStudents: number;
  gateAlerts: number;
  hearingsToday: number;
  /** Hearing dates waiting for this faculty member's approval. */
  datesToApprove: number;
  newConcerns: number;
  casesToSchedule: number;
  lettersToRead: number;
  documentsToCheck: number;
  idValidations: number;
  clearanceRequests: number;
  openFollowUps: number;
}

export interface TodayTask {
  key: keyof TodayCounts;
  count: number;
  /** "2 new concerns are waiting to be read." */
  text: string;
  /** The button's words: what pressing it does. */
  action: string;
  href: string;
  /** Urgent tasks come first and are marked in red. */
  urgent: boolean;
}

interface Definition {
  key: keyof TodayCounts;
  /** The page the button opens; its base path must be in the person's menu. */
  href: string;
  action: string;
  urgent: boolean;
  text: (n: number) => string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// In the order they are shown: urgent first, then the day's fixed points,
// then the queues.
const DEFINITIONS: Definition[] = [
  {
    key: "urgentConcerns", href: "/staff/concerns", action: "Open concerns", urgent: true,
    text: (n) => `${n} urgent ${plural(n, "concern needs", "concerns need")} a reply.`,
  },
  {
    key: "criticalStudents", href: "/staff/risk?tier=critical", action: "See students", urgent: true,
    text: (n) => `${n} ${plural(n, "student is", "students are")} rated critical on the at-risk list.`,
  },
  {
    key: "gateAlerts", href: "/staff/gates", action: "Review alerts", urgent: true,
    text: (n) => `${n} gate ${plural(n, "alert is", "alerts are")} waiting for review.`,
  },
  {
    key: "hearingsToday", href: "/staff/hearings", action: "See hearings", urgent: false,
    text: (n) => `${n} ${plural(n, "hearing is", "hearings are")} scheduled for today.`,
  },
  {
    key: "datesToApprove", href: "/staff/hearings", action: "Approve dates", urgent: false,
    text: (n) => `${n} hearing ${plural(n, "date is", "dates are")} waiting for your approval.`,
  },
  {
    key: "newConcerns", href: "/staff/concerns?status=pending", action: "Read concerns", urgent: false,
    text: (n) => `${n} new ${plural(n, "concern is", "concerns are")} waiting to be read.`,
  },
  {
    key: "casesToSchedule", href: "/staff/cases?filter=scheduling", action: "Set dates", urgent: false,
    text: (n) => `${n} ${plural(n, "case needs", "cases need")} a hearing or counselling date.`,
  },
  {
    key: "lettersToRead", href: "/staff/cases?filter=apology", action: "Read letters", urgent: false,
    text: (n) => `${n} apology ${plural(n, "letter is", "letters are")} waiting to be read.`,
  },
  {
    key: "documentsToCheck", href: "/staff/documents", action: "Check documents", urgent: false,
    text: (n) => `${n} uploaded ${plural(n, "document needs", "documents need")} checking.`,
  },
  {
    key: "idValidations", href: "/staff/id-validation", action: "Open requests", urgent: false,
    text: (n) => `${n} ID validation ${plural(n, "request is", "requests are")} waiting.`,
  },
  {
    key: "clearanceRequests", href: "/staff/clearance", action: "Open requests", urgent: false,
    text: (n) => `${n} clearance ${plural(n, "request is", "requests are")} waiting.`,
  },
  {
    key: "openFollowUps", href: "/staff/interventions", action: "See follow-ups", urgent: false,
    text: (n) => `${n} ${plural(n, "follow-up is", "follow-ups are")} not finished yet.`,
  },
];

/** The page a task needs, without its query string. */
export function taskPage(key: keyof TodayCounts): string {
  const definition = DEFINITIONS.find((d) => d.key === key);
  return (definition?.href ?? "").split("?")[0];
}

/**
 * The tasks for one person. `menuHrefs` is their menu (staff-nav.ts): a task
 * whose page they cannot open never shows, whatever its count.
 */
export function todayTasks(counts: Partial<TodayCounts>, menuHrefs: ReadonlySet<string>): TodayTask[] {
  return DEFINITIONS.flatMap((definition) => {
    const count = counts[definition.key] ?? 0;
    if (count <= 0 || !menuHrefs.has(taskPage(definition.key))) return [];
    return [{
      key: definition.key,
      count,
      text: definition.text(count),
      action: definition.action,
      href: definition.href,
      urgent: definition.urgent,
    }];
  });
}
