import { redirect } from "next/navigation";

/**
 * Legacy route.
 *
 * The enrolment-era `violations` table was replaced by the OSA case file in
 * migration 00007, and this screen by /staff/cases. Kept as a redirect so old
 * bookmarks and any lingering links land somewhere useful instead of on a 404.
 */
export default function StaffViolationsPage() {
  redirect("/staff/cases");
}
