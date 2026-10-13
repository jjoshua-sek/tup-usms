# TUP-Manila STARS

**Student Tracking and At-Risk Support System** for the Office of Student Affairs (OSA), Technological University of the Philippines – Manila.

STARS replaces the OSA's paper logbooks with one web application. It handles disciplinary cases and hearings, guidance, scholarships, clearance and Good Moral certificates, ID validation and campus gates, and student concerns. On top of these records, a machine-learning early warning system flags students at academic or disciplinary risk, so the OSA can step in early. The OSA makes every decision: the system proposes, and a person confirms.

- **Live:** https://tup-usms.vercel.app
- **Thesis:** *STARS: Student Tracking and At-Risk Support System with Integrated OSA Services Using Machine Learning*
- **Researchers:** Llanillo, Joshua · Fernandez, Raizen · Ignacio, Christel · Pausal, John Emanuel · Rosete, Sandy
- **Adviser:** May Garcia

> The system was called USMS (Unified Student Management System) until October 2026. Internal names still use the old one so nothing breaks: the repository and site address (`tup-usms`), the `usms_` cookies and storage keys, and the Vault secrets `usms_cron_secret` and `usms_app_url`. The displayed name is set in [`src/lib/brand.ts`](src/lib/brand.ts).

## What it does

**Student portal** (`src/app/(student)`)
- **Concerns.** Submit a concern and follow the thread live. An AI summary, urgency level and suggested office help staff route it.
- **My Violations.** See your cases, submit apology letters, and track community service and appeal windows.
- **My Appointments.** See hearing summonses, confirm receipt, and get a reminder the day before.
- **Scholarships.** See your eligibility and the required documents.
- **Clearance and Good Moral.** Request a certificate and see exactly what is holding it up.
- **Digital ID.** A QR code for the campus turnstiles, valid once the OSA validates the ID for the term.
- **Academic Records.** Upload your COR and rating slips.
- **My Schedule.** Your class times, so hearings avoid them.
- **Notifications.** One inbox for every notice.
- **Profile and Settings.** Change your password, choose your email preferences, and review recent sign-ins.

**OSA staff console** (`src/app/staff`)
- **Calendar** of upcoming hearings, sessions and deadlines, plus anything overdue.
- **Cases.** Minor, major and confidential (CODI) paths, settlements, PIC/SDB escalation, the sanction ladder and appeals.
- **Hearings** scheduled across both parties' calendars, with the professor's approval before the summons.
- **Students.** The directory and full student records.
- **Concerns.** An AI-triaged queue.
- **At-risk list**, interventions and guidance sessions (counselor-only notes).
- **Services.** Scholarships, clearance holds, ID validation at the counter, gates and device keys, the QR scanner, and document review.
- **Audit and reports.** The append-only audit log and term reports (counts only).
- **Accounts** (administrator only). Enrollment CSV import, single accounts, and sign-in and reset links.

**Kiosk** (`src/app/kiosk`): the turnstile screen. It authenticates with a device key and checks validation, suspension, concurrent use and passback.

**Public pages**: sign-in, *Forgot password?*, account activation and `/help`.

## Stack

| Layer | Technology |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| Data | Supabase: Postgres with Row-Level Security, Auth, Storage, Realtime, Vault, pg_cron, pg_net |
| Email | Nodemailer over Gmail SMTP (Resend supported) |
| AI | Groq, free plan: concern triage (`openai/gpt-oss-120b`) and COR / rating slip reading (`qwen/qwen3.8-27b` for photos; PDF text via unpdf) |
| Hosting | Vercel; every push to `main` deploys |
| Tests | Vitest (192 tests), ESLint |

## Getting started

```bash
git clone https://github.com/jjoshua-sek/tup-usms.git
cd tup-usms
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

1. **Database.** In the Supabase SQL Editor, run every file in [`supabase/migrations`](supabase/migrations) in order, from `00001` to `00030`. Migrations are applied by hand.
2. **Environment.** [`.env.example`](.env.example) documents every variable. You need the Supabase URL, the anon key and the service-role key. Everything else is optional or only needed for email.
3. **First administrator.** Create the user in Supabase Auth with the email `<login id>@tup.edu.ph`. Then set `raw_app_meta_data.role = 'admin'` and insert a matching `staff` row with `role_type = 'admin'`. After that, every other account is created from Staff console → Accounts.

> `.env.local` decides which database the local app talks to. If it holds the production keys, local actions change live data.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build (on Windows, set `NODE_OPTIONS=--max-old-space-size=4096` first) |
| `npm test` | Unit tests, including checks that the code matches the SQL migrations |
| `npm run lint` | ESLint |
| `npm run email:verify` | Signs in to the mail provider without sending anything |

## Deployment

1. Import the repository into Vercel and add the variables from `.env.example`. Set `NEXT_PUBLIC_APP_URL` to the site address, `EMAIL_PROVIDER=gmail`, and `EMAIL_FROM="TUP-Manila STARS <address>"`.
2. In Supabase, enable `pg_cron` and `pg_net`. Then store the two Vault secrets and schedule the jobs (migration `00019`, section 6).
3. Every minute, the database calls `/api/notifications/dispatch`, signed with `CRON_SECRET`. Each run does four things in order:
   1. Sends hearing reminders.
   2. Sends notification emails.
   3. Sends sign-in and reset links.
   4. Writes concern summaries.

   Vercel's free plan runs its own cron only once a day, which is too slow for a summons.

## Project layout

```
src/app/(auth)        sign-in, activation, forgot password
src/app/(student)     student portal
src/app/staff         OSA console (Accounts: administrator only)
src/app/kiosk         turnstile kiosk
src/app/help          public help page
src/app/api           gate verification, dispatch job, session, uploads
src/lib               domain rules (pure and unit-tested): scheduling, risk,
                      sanctions, reminders, calendar, eligibility, gates, email
supabase/migrations   schema, RLS policies and functions, 00001–00030
```

## Security in brief

- **Row-Level Security on every table.** Students see only their own rows. Confidential CODI cases are invisible to staff who are not cleared, and counselor notes are visible only to their author.
- **Server-controlled roles.** Roles live in `app_metadata`. Queue, notification and clearance-check functions are callable only by the service role.
- **Append-only history.** `audit_logs` and `case_timeline` cannot be edited.
- **Sessions end on their own.** Staff are signed out after 15 idle minutes and students after 30, and closing every tab ends the session.
- **Password resets reveal nothing.** The form gives the same answer for every request, is rate-limited, and is recorded in the audit log.

## Documentation

The full system documentation (annotated architecture, workflows, roles, status reference and troubleshooting) is kept as *STARS System Documentation.docx* alongside the thesis files.
