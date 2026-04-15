/**
 * Auth Layout — No sidebar, centered card design.
 * Used for /login and /reset-password pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-tup-maroon-900 via-tup-maroon-800 to-tup-maroon-950 px-4">
      <div className="w-full max-w-md">
        {/* TUP Logo/Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
            <span className="text-2xl font-bold text-tup-gold-400">TUP</span>
          </div>
          <h1 className="text-xl font-bold text-white">
            Technological University of the Philippines
          </h1>
          <p className="text-sm text-white/60 mt-1">
            Unified Student Management System
          </p>
        </div>

        {children}

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-white/40">
          © {new Date().getFullYear()} TUP-Manila. All rights reserved.
          <br />
          <a
            href="/privacy"
            className="underline hover:text-white/60 transition-colors"
          >
            Privacy Policy
          </a>{" "}
          ·{" "}
          <a
            href="/terms"
            className="underline hover:text-white/60 transition-colors"
          >
            Terms of Service
          </a>
        </p>
      </div>
    </div>
  );
}
