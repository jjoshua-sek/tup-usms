"use client";

import { useEffect, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw, Loader2 } from "lucide-react";
import { issueIdToken } from "@/app/(student)/id/actions";
import { cn } from "@/lib/utils";

interface RotatingQrProps {
  /** Initial token + expiry, fetched server-side for fast first paint */
  initialToken: string;
  initialExpiresAt: number;
}

/**
 * Rotating QR code component.
 *
 * Renders a QR with the current token. Polls the server for a new token
 * 1 second before expiry, ensuring the QR is always valid.
 *
 * The countdown timer is updated locally (no network requests) and only
 * the actual token refresh hits the server.
 */
export function RotatingQr({ initialToken, initialExpiresAt }: RotatingQrProps) {
  const [token, setToken] = useState(initialToken);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((initialExpiresAt - Date.now()) / 1000))
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const result = await issueIdToken();
    if (result.token && result.expiresAt) {
      setToken(result.token);
      setExpiresAt(result.expiresAt);
      setSecondsLeft(Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000)));
    }
    setIsRefreshing(false);
  }, []);

  // Tick the timer every second; auto-refresh when it hits 0
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        refresh();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, refresh]);

  const progress = Math.min(100, Math.max(0, (secondsLeft / 60) * 100));
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="space-y-5">
      {/* QR itself — rendered into the digital ID card via portal-like wrapper.
          Parent positions this absolutely; we just render the SVG. */}
      <div className="hidden" id="qr-payload" data-token={token} />

      {/* Timer card */}
      <div className="bg-accent border border-border rounded-md p-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
          QR Refreshes In
        </div>
        <div className="text-[32px] font-semibold tracking-tighter font-mono leading-none">
          {mm}:{ss}
        </div>
        <div className="h-1 bg-border rounded-full mt-2.5 overflow-hidden">
          <div
            className="h-full bg-tup-maroon-600 rounded-full transition-all duration-1000 linear"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={refresh}
        disabled={isRefreshing}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-card border border-border hover:bg-muted transition-colors disabled:opacity-50"
      >
        {isRefreshing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {isRefreshing ? "Refreshing..." : "Refresh Now"}
      </button>
    </div>
  );
}

/**
 * The QR code visual itself, rendered inside the digital ID card.
 * Receives token from parent via prop (which polls + updates).
 */
export function RotatingQrVisual({
  initialToken,
  className,
}: {
  initialToken: string;
  className?: string;
}) {
  const [token, setToken] = useState(initialToken);

  useEffect(() => {
    // Poll the data-token attribute from the timer card via a 250ms tick.
    // This is a lightweight cross-component sync that avoids lifting state
    // when the timer and visual live in different layout columns.
    const interval = setInterval(() => {
      const node = document.getElementById("qr-payload");
      const current = node?.getAttribute("data-token");
      if (current && current !== token) {
        setToken(current);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [token]);

  return (
    <div className={cn("bg-white p-1.5 rounded", className)}>
      <QRCodeSVG
        value={token}
        size={70}
        level="L"
        bgColor="#ffffff"
        fgColor="#7a1f2b"
        marginSize={0}
      />
    </div>
  );
}
