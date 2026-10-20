import type { LooseClient } from "@/lib/supabase/loose";
import { MAX_UPLOAD_BYTES, formatBytes } from "@/lib/images/compress";

/**
 * Files a student attaches to a concern (migration 00033).
 *
 * The limits live here because both sides apply them: the form checks before
 * it creates the concern, so a file it would refuse never leaves a concern
 * filed without it, and the Server Action checks again, against the sizes
 * Storage actually recorded, since the browser can be made to send anything.
 * The bucket itself refuses files over MAX_UPLOAD_BYTES.
 */

export const CONCERN_ATTACHMENT_BUCKET = "concern-attachments";

export const CONCERN_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/** A handful of photos or scans is plenty for a concern; more is usually a mistake. */
export const MAX_CONCERN_FILES = 5;

/** Per concern, after photos are shrunk. Each file is also capped at MAX_UPLOAD_BYTES. */
export const MAX_CONCERN_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** "5 MB": limits are whole megabytes, and formatBytes would say "5.0 MB". */
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Shown under the dropzone; kept beside the limits it describes. */
export const CONCERN_ATTACHMENT_HINT = `PDF, JPG, PNG · up to ${MAX_CONCERN_FILES} files, ${megabytes(
  MAX_UPLOAD_BYTES,
)} each, ${megabytes(MAX_CONCERN_ATTACHMENT_BYTES)} total`;

/** What a concern page lists. No file_path: pages link by id, never by storage path. */
export const ATTACHMENT_LIST_COLUMNS = "id, file_name, mime_type, file_size, created_at";

/** What the link route needs to sign a URL. */
export const ATTACHMENT_LINK_COLUMNS = "id, file_path";

export interface ConcernAttachment {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface Sized {
  name: string;
  size: number;
  type: string;
}

export function isConcernAttachmentType(type: string): boolean {
  return (CONCERN_ATTACHMENT_TYPES as readonly string[]).includes(type);
}

/** Why one file cannot be attached, or null if it can. */
export function attachmentFileProblem(file: Sized): string | null {
  if (!isConcernAttachmentType(file.type)) return `${file.name} is not a PDF, JPG or PNG.`;
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}; each file can be at most ${megabytes(MAX_UPLOAD_BYTES)}.`;
  }
  return null;
}

/** Why this set of files cannot go on one concern together, or null if it can. */
export function attachmentSetProblem(files: Sized[]): string | null {
  if (files.length > MAX_CONCERN_FILES) {
    return `Attach at most ${MAX_CONCERN_FILES} files to a concern.`;
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_CONCERN_ATTACHMENT_BYTES) {
    return `These files come to ${formatBytes(total)}; the limit is ${megabytes(MAX_CONCERN_ATTACHMENT_BYTES)} per concern.`;
  }
  return null;
}

/**
 * The attachments on one concern, oldest first. RLS decides who gets rows
 * back: the student who filed it, or staff.
 */
export async function listConcernAttachments(db: LooseClient, concernId: string): Promise<ConcernAttachment[]> {
  const { data, error } = await db
    .from("concern_attachments")
    .select(ATTACHMENT_LIST_COLUMNS)
    .eq("concern_id", concernId)
    .order("created_at", { ascending: true });
  // Before 00033 runs the table does not exist; the concern should still show.
  if (error) return [];
  return (data as ConcernAttachment[] | null) ?? [];
}
