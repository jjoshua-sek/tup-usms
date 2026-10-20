import { NextResponse } from "next/server";
import { z } from "zod";

import { ATTACHMENT_LINK_COLUMNS, CONCERN_ATTACHMENT_BUCKET } from "@/lib/concerns/attachments";
import { loose } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/utils/audit";

/**
 * Opens a concern attachment: GET /api/concerns/attachments/<id>
 *
 * Concern pages link here instead of embedding signed URLs, so a page left
 * open for an hour still opens its files. Each visit issues a fresh signed
 * URL that lives a minute, long enough for the redirect to land, and too
 * short to be worth copying out of a browser's history.
 *
 * Both the row lookup and the signing use the viewer's own session, so the
 * table's RLS (whoever can see the concern) and the bucket's (the uploader,
 * or staff) must both agree. Under /api because /concerns is a student-only
 * area and staff need these links too.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  if (!z.string().uuid().safeParse(id).success) return notFound;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data } = await loose(supabase)
    .from("concern_attachments")
    .select(ATTACHMENT_LINK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  const attachment = data as { id: string; file_path: string } | null;
  // Someone else's attachment looks exactly like a missing one.
  if (!attachment) return notFound;

  const { data: signed, error } = await supabase.storage
    .from(CONCERN_ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.file_path, 60);
  if (error || !signed?.signedUrl) return notFound;

  // A concern may be a harassment complaint; who opened its evidence is
  // worth knowing (RA 10173).
  await logAuditEvent(user.id, "file_download", `concern_attachments/${attachment.id}`);

  const response = NextResponse.redirect(signed.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
