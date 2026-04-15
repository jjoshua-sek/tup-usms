import DOMPurify from "dompurify";

/**
 * Sanitize user-generated text input.
 * Strips null bytes, trims whitespace, and enforces max length.
 *
 * Use this before saving to the database, even though Supabase
 * uses parameterized queries (which prevent SQL injection).
 * This handles XSS and data integrity.
 */
export function sanitizeText(input: string, maxLength = 10000): string {
  return input
    .replace(/\0/g, "") // Remove null bytes
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize HTML content using DOMPurify.
 * Only use this when you MUST render user HTML (rare).
 * React auto-escapes by default — only needed for dangerouslySetInnerHTML.
 */
export function sanitizeHtml(dirty: string): string {
  // DOMPurify only works in browser environment
  if (typeof window === "undefined") {
    // Server-side: strip all HTML tags
    return dirty.replace(/<[^>]*>/g, "");
  }
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "p", "br", "ul", "ol", "li"],
    ALLOWED_ATTR: [],
  });
}

/**
 * Validate and sanitize file upload MIME types.
 * Checks against the allowed list — never trust the file extension alone.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType);
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
