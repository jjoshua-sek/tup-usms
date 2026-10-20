import type { NextConfig } from "next";

/**
 * Security headers applied to every response.
 *
 * - X-Content-Type-Options: prevents MIME-type sniffing (mitigates XSS via odd file types)
 * - X-Frame-Options: prevents this app from being embedded in an <iframe> on another domain
 *   (mitigates clickjacking — RA 10173 considers this a "reasonable security measure")
 * - Referrer-Policy: limits how much referrer info leaks to external sites students click to
 * - Strict-Transport-Security: forces HTTPS for 2 years (only effective on production HTTPS)
 * - Permissions-Policy: disables sensors/devices we don't use (camera/mic kept enabled for QR scanner)
 * - X-DNS-Prefetch-Control: enables DNS prefetch (small perf win)
 *
 * NOTE: A full Content-Security-Policy (CSP) is intentionally NOT set here — it requires careful
 * tuning to allow Supabase's domain (REST, Realtime, Storage) and breaks if misconfigured. We'll
 * add a tested CSP in a follow-up once the app's external requests are stable.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    // Allow camera (for /staff/scanner QR scanning), deny everything else
    value:
      "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  // The offline LAN copy runs STARS in a Docker container (lan/Dockerfile),
  // which needs the self-contained server. Vercel builds without it.
  output: process.env.STARS_STANDALONE === "true" ? "standalone" : undefined,
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
