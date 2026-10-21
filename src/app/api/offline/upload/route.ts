/**
 * POST /api/offline/upload — where the offline LAN copy sends its outbox
 * once the internet is back (offline fallback plan, Phase 2).
 *
 * Called by the copy's sync job, never by a person: authenticated with
 * OFFLINE_UPLOAD_KEY (the same value is in Vercel and in lan/.env), not a
 * session, so src/middleware.ts lets /api/offline/ through untouched.
 *
 * Answers one result per record: applied, conflict (on the ID Validation
 * review list), rejected, or retry (send it again). The rules are in
 * lib/offline/upload-rules.ts.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { applyUploads } from "@/lib/offline/apply";
import { uploadBodySchema } from "@/lib/offline/upload-rules";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function authorized(request: Request): boolean {
  const expected = process.env.OFFLINE_UPLOAD_KEY?.trim();
  if (!expected) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.OFFLINE_UPLOAD_KEY?.trim()) {
    return NextResponse.json(
      { error: "Uploads from the offline copy are not set up here: OFFLINE_UPLOAD_KEY is missing." },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Wrong upload key." }, { status: 401, headers: NO_STORE });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }
  const parsed = uploadBodySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid upload: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim() },
      { status: 400, headers: NO_STORE },
    );
  }

  const results = await applyUploads(parsed.data.records);
  return NextResponse.json({ results }, { headers: NO_STORE });
}
