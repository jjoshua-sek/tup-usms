import { describe, expect, it } from "vitest";

import { staffNavFor } from "./staff-nav";
import { greetingFor, todayTasks } from "./today";

describe("greetingFor", () => {
  it("follows the Manila clock", () => {
    expect(greetingFor(7 * 60)).toBe("Good morning");
    expect(greetingFor(12 * 60)).toBe("Good afternoon");
    expect(greetingFor(18 * 60 + 30)).toBe("Good evening");
  });
});

const menu = (role: Parameters<typeof staffNavFor>[0]) =>
  new Set(staffNavFor(role).flatMap((section) => section.items.map((item) => item.href)));

describe("todayTasks", () => {
  it("lists only what is waiting, urgent first, in plain sentences", () => {
    const tasks = todayTasks({ newConcerns: 2, urgentConcerns: 1, casesToSchedule: 1, documentsToCheck: 0 }, menu("osa_officer"));
    expect(tasks.map((t) => t.text)).toEqual([
      "1 urgent concern needs a reply.",
      "2 new concerns are waiting to be read.",
      "1 case needs a hearing or counselling date.",
    ]);
    expect(tasks[0]).toMatchObject({ urgent: true, action: "Open concerns", href: "/staff/concerns" });
    expect(tasks[2]).toMatchObject({ action: "Set dates", href: "/staff/cases?filter=scheduling" });
  });

  it("is empty when nothing is waiting", () => {
    expect(todayTasks({}, menu("osa_officer"))).toEqual([]);
  });

  it("never offers a task whose page the person cannot open", () => {
    const counts = { gateAlerts: 3, documentsToCheck: 4, newConcerns: 1, datesToApprove: 2 };
    expect(todayTasks(counts, menu("security_guard")).map((t) => t.key)).toEqual(["gateAlerts", "newConcerns"]);
    expect(todayTasks(counts, menu("faculty")).map((t) => t.key)).toEqual(["datesToApprove", "newConcerns"]);
  });

  it("uses the singular for one and the plural for more", () => {
    const [one] = todayTasks({ hearingsToday: 1 }, menu("osa_officer"));
    const [two] = todayTasks({ hearingsToday: 2 }, menu("osa_officer"));
    expect(one.text).toBe("1 hearing is scheduled for today.");
    expect(two.text).toBe("2 hearings are scheduled for today.");
  });
});
