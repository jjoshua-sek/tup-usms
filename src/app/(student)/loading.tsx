import { LoadingSpinner } from "@/components/shared/loading-spinner";

/**
 * Loading UI for any (student) route while server data fetches.
 *
 * Without this file, Next.js shows a blank screen during the server render
 * (especially on slow connections or when the layout is doing a redirect
 * cascade). With it, users see a centered spinner — much better UX.
 */
export default function StudentLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
