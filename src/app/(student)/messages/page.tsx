import { redirect } from "next/navigation";

/**
 * Retired route. The enrollment-era messaging screen was never built: a
 * student talks to the OSA through a concern's thread, and everything the
 * Office sends arrives as a notification. Kept as a redirect so old links
 * and bookmarks land on the inbox instead of a blank page.
 */
export default function MessagesPage() {
  redirect("/notifications");
}
