/**
 * Auth Layout — Two-column institutional gateway matching Screen 01 of
 * the USMS mockups.
 *
 * On desktop:
 *   - Left half: TUP maroon gradient with brand seal, hero text,
 *     modules pill list, RA 10173 footer.
 *   - Right half: white form area containing the children (login form,
 *     password reset, etc.) + DPA notice card.
 *
 * On mobile (<lg):
 *   - Single column: brand side stacks on top of form side.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl bg-card border border-border rounded-lg overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.06)] grid lg:grid-cols-2 min-h-[640px]">
        {/* ============================================
            LEFT: BRAND SIDE
            ============================================ */}
        <aside className="relative overflow-hidden p-8 sm:p-12 text-white flex flex-col justify-between bg-tup-gradient">
          {/* Decorative gold radial blobs (gives the brand side depth) */}
          <div
            className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(212, 160, 23, 0.15), transparent 70%)",
            }}
            aria-hidden="true"
          />
          <div
            className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, rgba(212, 160, 23, 0.1), transparent 70%)",
            }}
            aria-hidden="true"
          />

          {/* Brand header */}
          <div className="relative z-10 flex items-center gap-3.5">
            <div
              className="w-14 h-14 rounded-full bg-tup-gold-500 text-tup-maroon-600 flex items-center justify-center font-bold text-xl border-[3px] border-white shrink-0"
              aria-label="TUP seal"
            >
              TUP
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest opacity-80 mb-0.5">
                Technological University of the Philippines · Manila
              </div>
              <div className="text-[22px] font-semibold tracking-tight leading-tight">
                Unified Student Management System
              </div>
            </div>
          </div>

          {/* Hero text */}
          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.1] mb-4">
              One platform.
              <br />
              Every student service.
            </h2>
            <p className="text-sm leading-relaxed opacity-85 max-w-sm">
              Registration, concerns, violations, ID validation, and document
              management — unified into a single secure interface.
            </p>

            <div className="mt-6 grid gap-2">
              {[
                "Electronic Registration",
                "AI-Assisted Concern Triage",
                "QR-Based Identity Validation",
                "Centralized File Management",
              ].map((label) => (
                <div
                  key={label}
                  className="inline-flex items-center gap-2 text-xs opacity-85"
                >
                  <span
                    className="text-tup-gold-500 font-bold"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Footer note */}
          <div className="relative z-10 text-[11px] opacity-60 border-t border-white/15 pt-4">
            © {new Date().getFullYear()} TUP — Manila · College of Science · Capstone Project
            <br />
            Protected under RA 10173 (Data Privacy Act of 2012)
          </div>
        </aside>

        {/* ============================================
            RIGHT: FORM SIDE
            ============================================ */}
        <main className="p-8 sm:p-14 flex flex-col justify-center bg-card">
          {children}
        </main>
      </div>
    </div>
  );
}
