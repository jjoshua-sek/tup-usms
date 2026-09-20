"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2 } from "lucide-react";

const ELEMENT_ID = "kiosk-camera-region";

interface CameraScannerProps {
  onScan: (text: string) => void;
  className?: string;
}

/**
 * Camera-based QR reader for gates without a USB scanner (or as a fallback
 * when one fails).
 *
 * Two things matter here:
 *
 * 1. `html5-qrcode` touches `window` and `navigator.mediaDevices` at import
 *    time, so it must be dynamically imported *inside* an effect. A top-level
 *    import would break the server render of /kiosk.
 * 2. Its instance owns a live MediaStream. If the component unmounts without
 *    `stop()`, the camera light stays on and the next mount fails to acquire
 *    the device — so the cleanup stops, then clears, swallowing the throw that
 *    `stop()` raises when scanning never actually began.
 */
export function CameraScanner({ onScan, className }: CameraScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const scannerRef = useRef<{
    start: (...args: unknown[]) => Promise<void>;
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);

  // Keeps the effect from re-running (and the camera from restarting) every
  // time the parent re-renders with a new closure.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled) return;

        const instance = new Html5Qrcode(ELEMENT_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        scannerRef.current = instance as unknown as typeof scannerRef.current;

        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 260 } },
          (decodedText: string) => onScanRef.current(decodedText),
          // Per-frame "no QR found" callback — firing a state update here
          // would re-render the kiosk ten times a second.
          () => {},
        );

        if (!cancelled) setReady(true);
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error && cause.name === "NotAllowedError"
            ? "Camera permission was denied for this kiosk."
            : "No camera available. Use the USB scanner instead.",
        );
      }
    })();

    return () => {
      cancelled = true;
      const instance = scannerRef.current;
      scannerRef.current = null;
      if (!instance) return;

      Promise.resolve()
        .then(() => instance.stop())
        .catch(() => {})
        .finally(() => {
          try {
            instance.clear();
          } catch {
            // Element already detached.
          }
        });
    };
  }, []);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl border-2 border-white/20 bg-black">
        <div id={ELEMENT_ID} className="w-full [&_video]:w-full [&_video]:object-cover" />

        {!ready && !error && (
          <div className="absolute inset-0 grid place-content-center gap-2 justify-items-center text-white/70">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-xs">Starting camera…</p>
          </div>
        )}

        {error && (
          <div className="grid place-content-center gap-2 justify-items-center p-10 text-white/70">
            <CameraOff className="h-7 w-7" />
            <p className="max-w-[240px] text-center text-xs">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
