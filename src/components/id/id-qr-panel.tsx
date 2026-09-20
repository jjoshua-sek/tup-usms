"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Maximize2, Sun, X } from "lucide-react";

/**
 * The institutional QR — the same code printed on the physical TUP ID.
 *
 * `qrcode.react` renders through `useMemo`, so these must be Client
 * Components even though nothing here is interactive by necessity.
 *
 * Rendering choices that matter for a real scanner:
 *   - near-black on pure white (not maroon-on-cream): laser and camera
 *     readers need contrast, not branding
 *   - error-correction level M, so a scuffed phone screen still decodes
 *   - a quiet zone (`includeMargin`) — scanners fail without it more often
 *     than anything else on this page
 */

interface IdCardQrProps {
  payload: string;
  size?: number;
}

export function IdCardQr({ payload, size = 62 }: IdCardQrProps) {
  return (
    <div className="rounded bg-white p-1.5" aria-label="ID QR code">
      <QRCodeSVG
        value={payload}
        size={size}
        level="M"
        marginSize={1}
        bgColor="#ffffff"
        fgColor="#0a0a0a"
      />
    </div>
  );
}

interface IdQrPanelProps {
  payload: string;
  /** False when there is no validated ID for the current term. */
  scannable: boolean;
}

export function IdQrPanel({ payload, scannable }: IdQrPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-5">
          <div
            className={`shrink-0 rounded-lg bg-white p-2.5 ring-1 ring-border ${
              scannable ? "" : "opacity-40"
            }`}
          >
            <QRCodeSVG
              value={payload}
              size={124}
              level="M"
              marginSize={1}
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
          </div>

          <div className="min-w-0">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Institutional QR
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tracking-tight">{payload}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              This is the same code printed on your physical TUP ID. Gate turnstiles, the OSA
              front desk and the library all read it.
            </p>

            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Enlarge for scanning
            </button>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <Sun className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Turn your screen brightness up before scanning. Gate readers are infrared and
          struggle with a dim or heavily tinted display.
        </p>
      </div>

      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged QR code"
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-white p-6"
        >
          <div className="grid justify-items-center gap-5">
            <QRCodeSVG
              value={payload}
              size={320}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#0a0a0a"
            />
            <p className="font-mono text-base font-semibold tracking-tight text-neutral-900">
              {payload}
            </p>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
            >
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
