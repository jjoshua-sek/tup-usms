import { describe, expect, it } from "vitest";

import { finalColumns, selectedColumns } from "@/lib/testing/migrations";

import { AGENDA_COLUMNS, manilaDay, needsAttention, upcomingAgenda, type AgendaSources } from "./agenda";

describe("the calendar's queries", () => {
  it("select only columns the migrations create", () => {
    const missing = Object.entries(AGENDA_COLUMNS).flatMap(([table, select]) => {
      const columns = finalColumns(table);
      return selectedColumns(select)
        .filter((column) => !columns.has(column))
        .map((column) => `${table}.${column}`);
    });
    expect(missing).toEqual([]);
  });
});

// 9:00 AM in Manila on Wednesday, October 7, 2026.
const now = new Date("2026-10-07T01:00:00Z");
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

const empty = (): AgendaSources => ({ hearings: [], sessions: [], interventions: [], appeals: [], services: [] });

const hearing = (overrides: Partial<AgendaSources["hearings"][number]> = {}) => ({
  id: "h1",
  case_id: "c1",
  hearing_type: "conference",
  scheduled_start: hoursFromNow(26),
  scheduled_end: hoursFromNow(27),
  venue: "OSA Office",
  status: "student_notified",
  case_number: "OSA-2026-0001",
  student: "Juan Dela Cruz",
  ...overrides,
});

describe("manilaDay", () => {
  it("names the Manila date, not the UTC one", () => {
    // 4:30 PM UTC on the 7th is 12:30 AM on the 8th in Manila.
    expect(manilaDay(new Date("2026-10-07T16:30:00Z"))).toBe("2026-10-08");
  });
});

describe("upcomingAgenda", () => {
  it("groups the next two weeks by Manila day, deadlines before timed entries", () => {
    const sources = empty();
    sources.hearings.push(hearing());
    sources.appeals.push({ id: "a1", case_id: "c2", appeal_deadline: "2026-10-08", status: "window_open", case_number: "OSA-2026-0002", student: "Maria Santos" });
    const days = upcomingAgenda(sources, now);
    expect(days.map((d) => d.day)).toEqual(["2026-10-08"]);
    expect(days[0].entries.map((e) => e.kind)).toEqual(["appeal", "hearing"]);
  });

  it("leaves out cancelled hearings and anything past the window", () => {
    const sources = empty();
    sources.hearings.push(hearing({ id: "h2", status: "cancelled" }));
    sources.hearings.push(hearing({ id: "h3", scheduled_start: hoursFromNow(24 * 20), scheduled_end: hoursFromNow(24 * 20 + 1) }));
    sources.services.push({ id: "s1", case_id: "c3", deadline: "2026-11-30", status: "assigned", hours_required: 10, hours_completed: 0, case_number: null, student: null });
    expect(upcomingAgenda(sources, now)).toEqual([]);
  });

  it("flags hearings still waiting on the professor", () => {
    const sources = empty();
    sources.hearings.push(hearing({ status: "awaiting_complainant" }));
    expect(upcomingAgenda(sources, now)[0].entries[0].badge?.tone).toBe("warning");
  });
});

describe("needsAttention", () => {
  it("asks for an outcome when a summoned hearing's date has passed", () => {
    const sources = empty();
    sources.hearings.push(hearing({ scheduled_start: hoursFromNow(-30), scheduled_end: hoursFromNow(-29) }));
    expect(needsAttention(sources, now).map((e) => e.badge?.label)).toEqual(["Record outcome"]);
  });

  it("asks for a new date when the slot passed before the student was summoned", () => {
    const sources = empty();
    sources.hearings.push(hearing({ status: "awaiting_complainant", scheduled_start: hoursFromNow(-30), scheduled_end: hoursFromNow(-29) }));
    expect(needsAttention(sources, now)[0].badge?.label).toBe("Rebook");
  });

  it("does not flag a hearing that is over and recorded, or still in progress", () => {
    const sources = empty();
    sources.hearings.push(hearing({ id: "done", status: "completed", scheduled_start: hoursFromNow(-30), scheduled_end: hoursFromNow(-29) }));
    sources.hearings.push(hearing({ id: "now", scheduled_start: hoursFromNow(-0.5), scheduled_end: hoursFromNow(0.5) }));
    expect(needsAttention(sources, now)).toEqual([]);
  });

  it("flags an appeal window only after its last day", () => {
    const sources = empty();
    sources.appeals.push({ id: "closed", case_id: "c1", appeal_deadline: "2026-10-06", status: "window_open", case_number: null, student: null });
    sources.appeals.push({ id: "today", case_id: "c1", appeal_deadline: "2026-10-07", status: "window_open", case_number: null, student: null });
    sources.appeals.push({ id: "filed", case_id: "c1", appeal_deadline: "2026-10-01", status: "filed", case_number: null, student: null });
    expect(needsAttention(sources, now).map((e) => e.key)).toEqual(["appeal-closed"]);
  });

  it("flags open community service past its deadline, not completed or waived service", () => {
    const sources = empty();
    const service = { case_id: "c1", deadline: "2026-10-01", hours_required: 20, hours_completed: 12, case_number: null, student: null };
    sources.services.push({ ...service, id: "open", status: "in_progress" });
    sources.services.push({ ...service, id: "done", status: "completed" });
    sources.services.push({ ...service, id: "waived", status: "waived" });
    const flagged = needsAttention(sources, now);
    expect(flagged.map((e) => e.key)).toEqual(["service-open"]);
    expect(flagged[0].detail).toMatch(/12 of 20 hours/);
  });

  it("flags sessions and interventions left scheduled on an earlier day, not earlier today", () => {
    const sources = empty();
    sources.sessions.push({ id: "yesterday", scheduled_at: hoursFromNow(-20), status: "scheduled", session_type: "follow_up", student: null });
    sources.sessions.push({ id: "this-morning", scheduled_at: hoursFromNow(-0.5), status: "scheduled", session_type: "walk_in", student: null });
    sources.interventions.push({ id: "i1", scheduled_for: hoursFromNow(-48), status: "scheduled", intervention_type: "academic_advising", student: null });
    expect(needsAttention(sources, now).map((e) => e.key)).toEqual(["intervention-i1", "session-yesterday"]);
  });
});
