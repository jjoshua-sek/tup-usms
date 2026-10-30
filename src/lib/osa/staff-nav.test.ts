import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAFF_ROLES, type StaffRole } from "@/types/osa";

import { staffNavFor } from "./staff-nav";

const labels = (role: StaffRole | null) => staffNavFor(role).flatMap((section) => section.items.map((item) => item.label));

describe("staffNavFor", () => {
  it("gives an OSA officer every OSA page, grouped by task", () => {
    expect(labels("osa_officer")).toEqual([
      "Home",
      "Student concerns", "Discipline cases", "Hearings", "Calendar", "Student records",
      "At-risk students", "Follow-ups", "Guidance sessions", "Scholarships",
      "Clearance requests", "ID validation", "Check documents", "Scan an ID", "Campus gates",
      "Reports", "Settings",
    ]);
    expect(staffNavFor("osa_officer").map((s) => s.label)).toEqual([
      null, "Students and cases", "Student support", "Front desk", "Records and settings",
    ]);
  });

  it("adds Activity history for the OSA head, and User accounts for the administrator", () => {
    expect(labels("osa_head")).toContain("Activity history");
    expect(labels("osa_head")).not.toContain("User accounts");
    expect(labels("admin")).toEqual(expect.arrayContaining(["Activity history", "User accounts"]));
  });

  it("shows a guard only the gates, besides the pages everyone has", () => {
    expect(labels("security_guard")).toEqual([
      "Home", "Student concerns", "File a complaint", "Calendar", "Scan an ID", "Campus gates", "Settings",
    ]);
  });

  it("lets faculty file complaints and approve hearing dates", () => {
    expect(labels("faculty")).toEqual(["Home", "Student concerns", "File a complaint", "Hearings", "Calendar", "Settings"]);
  });

  it("gives counselors student support, and the cashier clearance", () => {
    expect(labels("guidance_counselor")).toEqual(expect.arrayContaining(["At-risk students", "Follow-ups", "Guidance sessions", "Student records"]));
    expect(labels("guidance_counselor")).not.toContain("Scholarships");
    expect(labels("cashier")).toEqual(expect.arrayContaining(["Clearance requests", "Student records"]));
    expect(labels("cashier")).not.toContain("Discipline cases");
  });

  it("keeps UITC to Accounts (and Settings)", () => {
    expect(labels("registrar")).toEqual(["User accounts", "Settings"]);
  });

  it("gives committee members the case list instead of the complaint form", () => {
    expect(labels("pic_member")).toEqual(expect.arrayContaining(["Discipline cases", "Hearings"]));
    expect(labels("pic_member")).not.toContain("File a complaint");
  });

  it("offers an account without a staff record nothing it would be refused", () => {
    expect(labels(null)).toEqual(["Home", "Student concerns", "Calendar", "Settings"]);
  });
});

describe("the staff menu covers the console", () => {
  const appDir = join(process.cwd(), "src", "app");
  const everyHref = new Set(
    [...STAFF_ROLES, null].flatMap((role) => staffNavFor(role).flatMap((s) => s.items.map((i) => i.href))),
  );

  it("links only to pages that exist", () => {
    for (const href of everyHref) expect(existsSync(join(appDir, href, "page.tsx")), href).toBe(true);
  });

  it("reaches every staff page from someone's menu, so no feature is lost", () => {
    // Reached another way: notifications from the header bell; messages and
    // violations are old addresses that redirect.
    const elsewhere = new Set(["notifications", "messages", "violations"]);
    const pages = readdirSync(join(appDir, "staff"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !elsewhere.has(entry.name))
      .map((entry) => `/staff/${entry.name}`);
    for (const page of pages) expect(everyHref.has(page), page).toBe(true);
  });
});
