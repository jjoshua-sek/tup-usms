/**
 * The system's name, everywhere a person sees it — page titles, the header,
 * the sign-in page, emails. One place, so it cannot drift between screens.
 *
 * Not renamed with it, on purpose: the repository and the
 * tup-usms.vercel.app address, and internal identifiers people never read
 * but that live in browsers, devices and the database — the session cookie
 * (usms_activity), the gate device-key prefix (usms_gate_), browser storage
 * keys, and the Vault secret names. Changing those would sign everyone out,
 * break kiosks already provisioned, or stop the email job.
 */
export const APP_NAME = "STARS";

/** What the acronym stands for. */
export const APP_FULL_NAME = "Student Tracking and At-Risk Support System";

/** The capstone title. */
export const APP_TITLE =
  "STARS: Student Tracking and At-Risk Support System with Integrated OSA Services Using Machine Learning";

/** Used in page titles and as the email sender name. */
export const APP_SITE_NAME = `TUP-Manila ${APP_NAME}`;
