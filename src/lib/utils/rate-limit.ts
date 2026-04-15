/**
 * Simple in-memory rate limiter for Server Actions and Route Handlers.
 *
 * For production at scale, replace with Redis (Upstash) or
 * Supabase Edge Function rate limiting.
 *
 * This implementation uses a sliding window counter.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

interface RateLimitOptions {
  /** Unique identifier (e.g., userId, IP address) */
  identifier: string;
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given identifier.
 *
 * Usage:
 * ```ts
 * const limit = checkRateLimit({
 *   identifier: userId,
 *   maxRequests: 10,
 *   windowSeconds: 3600, // 1 hour
 * });
 * if (!limit.success) {
 *   return { error: "Too many requests. Try again later." };
 * }
 * ```
 */
export function checkRateLimit(options: RateLimitOptions): RateLimitResult {
  const { identifier, maxRequests, windowSeconds } = options;
  const now = Date.now();
  const key = `${identifier}`;

  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt <= now) {
    // First request or window expired
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowSeconds * 1000,
    });
    return {
      success: true,
      remaining: maxRequests - 1,
      resetAt: now + windowSeconds * 1000,
    };
  }

  if (entry.count >= maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count++;
  return {
    success: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Client-side rate limit hook state.
 * Use this for login throttling (5 attempts / 30s cooldown).
 */
export function createClientRateLimiter(maxAttempts: number, cooldownMs: number) {
  let attempts = 0;
  let cooldownUntil = 0;

  return {
    canAttempt(): boolean {
      const now = Date.now();
      if (cooldownUntil > now) return false;
      if (attempts >= maxAttempts) {
        cooldownUntil = now + cooldownMs;
        attempts = 0;
        return false;
      }
      return true;
    },
    recordAttempt(): void {
      attempts++;
    },
    reset(): void {
      attempts = 0;
      cooldownUntil = 0;
    },
    getCooldownRemaining(): number {
      const remaining = cooldownUntil - Date.now();
      return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    },
  };
}
