"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CameraIcon as Camera, CheckCircleIcon as CheckCircle2, ArrowSquareOutIcon as ExternalLink, UploadSimpleIcon as ImageUp, CircleNotchIcon as Loader2, ScanIcon as ScanLine, ShieldCheckIcon as ShieldCheck, WarningIcon as TriangleAlert, XIcon as X } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

import { getStampedScanUrl, scanStampedCopy, verifyWithStampedScan } from "@/app/staff/documents/actions";
import { Button } from "@/components/ui/button";
import { SCAN_TARGET, compressImage } from "@/lib/images/compress";
import type { ScanComparison } from "@/lib/documents/stamped-scan";

/**
 * At the counter: photograph the Registrar-stamped COR or rating slip the
 * student hands over, compare it with their upload, and verify it if every
 * row matches and the Registrar's stamp is there (the OSA head's "check by
 * scanning"). The comparison is shown before anything is verified.
 */
export function StampedScanPanel({
  documentId,
  documentLabel,
  initial,
}: {
  documentId: string;
  documentLabel: string;
  /** The last comparison saved on the document, if it was scanned before. */
  initial?: ScanComparison | null;
}) {
  const [comparison, setComparison] = useState<ScanComparison | null>(initial ?? null);
  const [mode, setMode] = useState<"idle" | "camera">("idle");
  const [reading, startReading] = useTransition();
  const [verifying, startVerifying] = useTransition();
  const [verified, setVerified] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (photo: File) =>
    startReading(async () => {
      const ready = await compressImage(photo, SCAN_TARGET);
      const formData = new FormData();
      formData.append("document_id", documentId);
      formData.append("photo", ready);
      const result = await scanStampedCopy(formData);
      if (result.error || !result.comparison) {
        toast.error(result.error ?? "The photo could not be read.");
        return;
      }
      setComparison(result.comparison);
    });

  if (verified) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 p-2 text-sm font-medium text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
        <ShieldCheck className="h-4 w-4" /> Verified with the stamped copy.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ScanLine className="h-3.5 w-3.5" /> Stamped copy of the {documentLabel}
        </p>
        {mode === "idle" && !reading && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setMode("camera")} className={smallButton}>
              <Camera className="h-3 w-3" /> {comparison ? "Scan again" : "Scan with camera"}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className={smallButton}>
              <ImageUp className="h-3 w-3" /> Use a photo
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) submit(file);
              }}
            />
          </div>
        )}
      </div>

      {mode === "camera" && (
        <DocumentCamera
          onCancel={() => setMode("idle")}
          onCapture={(file) => {
            setMode("idle");
            submit(file);
          }}
        />
      )}

      {reading && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the stamped copy and comparing it with the upload…
        </p>
      )}

      {!reading && !comparison && mode === "idle" && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Lay the stamped paper flat in good light, with the whole page in the frame. STARS checks every row against what
          the student uploaded and looks for the Registrar&apos;s stamp.
        </p>
      )}

      {!reading && comparison && (
        <ComparisonResult
          comparison={comparison}
          documentId={documentId}
          verifying={verifying}
          onVerify={() =>
            startVerifying(async () => {
              const result = await verifyWithStampedScan(documentId);
              if (result.error) toast.error(result.error);
              else {
                toast.success(result.message ?? "Verified with the stamped copy.");
                setVerified(true);
              }
            })
          }
        />
      )}
    </div>
  );
}

function ComparisonResult({
  comparison,
  documentId,
  verifying,
  onVerify,
}: {
  comparison: ScanComparison;
  documentId: string;
  verifying: boolean;
  onVerify: () => void;
}) {
  const good = comparison.canVerify;
  return (
    <div className="space-y-2">
      <p
        className={`flex items-start gap-1.5 rounded-md p-2 text-sm leading-relaxed ${
          good
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
            : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
        }`}
      >
        {good ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <span>{comparison.summary}</span>
      </p>

      <div className="flex flex-wrap gap-1.5 text-sm">
        <Stamp label="Registrar stamp" present={comparison.stamps.registrar} />
        <Stamp label="OSA stamp" present={comparison.stamps.osa} />
        {comparison.rowsTotal > 0 && (
          <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
            {comparison.rowsMatched} of {comparison.rowsTotal} rows match
          </span>
        )}
      </div>

      {comparison.differences.length > 0 && (
        <ul className="ml-4 list-disc space-y-0.5 text-sm text-muted-foreground">
          {comparison.differences.map((difference) => (
            <li key={difference}>{difference}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {good && (
          <Button
            type="button"
            size="sm"
            disabled={verifying}
            onClick={onVerify}
            className="h-8 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
          >
            {verifying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            Verify with stamped copy
          </Button>
        )}
        <ScanLink documentId={documentId} />
      </div>
    </div>
  );
}

function Stamp({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 ${
        present
          ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
          : "border-border text-muted-foreground"
      }`}
    >
      {present ? "✓" : "✗"} {label}
    </span>
  );
}

/** Fetches the signed link first, then offers it: window.open after an await is blocked as a popup. */
function ScanLink({ documentId }: { documentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={`${smallButton} text-tup-maroon-600`}>
        <ExternalLink className="h-3 w-3" /> Open scan (5 min link)
      </a>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      className={smallButton}
      onClick={() =>
        startTransition(async () => {
          const result = await getStampedScanUrl(documentId);
          if (result.error || !result.url) toast.error(result.error ?? "Could not open the scan.");
          else setUrl(result.url);
        })
      }
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />} View scan
    </button>
  );
}

/**
 * The back camera, full frame and not mirrored: the page has to read the
 * right way round. Falls back to the photo picker when there is no camera.
 */
function DocumentCamera({ onCapture, onCancel }: { onCapture: (file: File) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera here. Use a photo instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            void videoRef.current?.play();
            setReady(true);
          };
        }
      } catch {
        setError("The camera could not be opened. Allow camera access, or use a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], "stamped-copy.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9,
    );
  };

  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-muted p-2 text-sm">
        <span>{error}</span>
        <button type="button" onClick={onCancel} className={smallButton}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="block max-h-[60vh] w-full object-contain" />
        {!ready && <p className="absolute inset-0 grid place-items-center text-base text-white">Starting camera…</p>}
        <div className="pointer-events-none absolute inset-3 rounded border-2 border-dashed border-white/40" />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} className="flex-1">
          <X className="mr-1 h-3.5 w-3.5" /> Cancel
        </Button>
        <Button type="button" size="sm" disabled={!ready} onClick={capture} className="flex-1 bg-tup-maroon-600 text-white hover:bg-tup-maroon-700">
          <Camera className="mr-1 h-3.5 w-3.5" /> Capture page
        </Button>
      </div>
    </div>
  );
}

const smallButton =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50";
