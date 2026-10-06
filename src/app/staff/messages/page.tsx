import { redirect } from "next/navigation";

/**
 * Retired route. The messaging screen was never built; the header bell that
 * pointed here now opens the staff notification inbox, and conversations
 * with students happen on their concern threads. Kept as a redirect so old
 * links land somewhere useful.
 */
export default function StaffMessagesPage() {
  redirect("/staff/notifications");
}
