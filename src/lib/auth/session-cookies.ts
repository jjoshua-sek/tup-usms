/**
 * Auth cookies that end when the browser closes.
 *
 * @supabase/ssr writes its session cookies with a 400-day Max-Age and
 * re-applies that value after merging any cookieOptions it is given, so it
 * cannot be configured away. It does hand every cookie to our setAll
 * before writing it, and that is where the lifetime is removed. A cookie
 * with no Max-Age or Expires is a session cookie: the browser discards it
 * when it closes, and the sign-in goes with it.
 */

export interface CookieOptionsLike {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date | string | number;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
  [key: string]: unknown;
}

/**
 * Strips the lifetime from a cookie being set. A deletion (maxAge 0) is left
 * exactly as it is — removing its Max-Age would turn "delete this cookie"
 * into "keep it until the browser closes".
 */
export function asSessionCookie<T extends CookieOptionsLike>(options: T | undefined): T | undefined {
  if (!options || options.maxAge === 0) return options;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- removed on purpose
  const { maxAge, expires, ...rest } = options;
  return rest as T;
}

/** Reads document.cookie into name/value pairs. */
export function parseCookieHeader(header: string): Array<{ name: string; value: string }> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      const name = separator < 0 ? part : part.slice(0, separator);
      const raw = separator < 0 ? "" : part.slice(separator + 1);
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        // Not percent-encoded by us; keep it as written.
      }
      return { name, value };
    });
}

/** Builds a document.cookie assignment, mirroring the `cookie` package's format. */
export function serializeCookie(name: string, value: string, options: CookieOptionsLike = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires !== undefined) parts.push(`Expires=${new Date(options.expires).toUTCString()}`);
  if (options.sameSite) {
    const mode = options.sameSite === true ? "strict" : options.sameSite;
    parts.push(`SameSite=${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  }
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
