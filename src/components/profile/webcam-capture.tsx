"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, X, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface WebcamCaptureProps {
  /** Called when student confirms a captured frame; receives a JPEG Blob (512x512) */
  onCapture: (blob: Blob) => void;
  /** Called when student cancels webcam mode entirely */
  onCancel: () => void;
}

const TARGET_SIZE = 512;
const JPEG_QUALITY = 0.85;

/**
 * Live camera preview with capture → preview → retake/confirm flow.
 *
 * - Auto-mirrors the preview (selfie convention) but un-mirrors the saved blob
 * - Center-square crops the captured frame to TARGET_SIZE × TARGET_SIZE
 * - Properly stops the MediaStream tracks on unmount (camera light goes off)
 * - Falls back to error state if camera permission is denied
 */
export function WebcamCapture({ onCapture, onCancel }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  // Start camera on mount
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      // Defensive: getUserMedia is unavailable on non-HTTPS / older browsers
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("Your browser doesn't support camera access. Please use the Upload option instead.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setIsReady(true);
          };
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        if (errMsg.includes("Permission") || errMsg.includes("NotAllowed")) {
          setError(
            "Camera permission denied. Allow access in your browser settings, or use the Upload option."
          );
        } else if (errMsg.includes("NotFound")) {
          setError(
            "No camera detected on this device. Please use the Upload option instead."
          );
        } else {
          setError(`Camera error: ${errMsg}`);
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Compute center-square crop on the source video
    const srcSize = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - srcSize) / 2;
    const sy = (video.videoHeight - srcSize) / 2;

    // Un-mirror the captured frame (preview was mirrored, but we want the real image saved)
    ctx.save();
    ctx.translate(TARGET_SIZE, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, srcSize, srcSize, 0, 0, TARGET_SIZE, TARGET_SIZE);
    ctx.restore();

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCapturedDataUrl(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  };

  const handleRetake = () => {
    setCapturedBlob(null);
    setCapturedDataUrl(null);
  };

  const handleConfirm = () => {
    if (capturedBlob) onCapture(capturedBlob);
  };

  // ============================================
  // Error state — no camera available
  // ============================================
  if (error) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={onCancel} variant="outline" className="w-full">
          Back to options
        </Button>
      </div>
    );
  }

  // ============================================
  // Preview state — captured frame, awaiting confirm/retake
  // ============================================
  if (capturedDataUrl) {
    return (
      <div className="space-y-4">
        <div className="relative mx-auto max-w-sm aspect-square overflow-hidden rounded-2xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL */}
          <img
            src={capturedDataUrl}
            alt="Captured photo preview"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleRetake}
            className="flex-1"
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Retake
          </Button>
          <Button
            onClick={handleConfirm}
            className="flex-1 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
          >
            <Check className="mr-1 h-4 w-4" />
            Use this photo
          </Button>
        </div>
      </div>
    );
  }

  // ============================================
  // Live preview state — camera streaming
  // ============================================
  return (
    <div className="space-y-4">
      <div className="relative mx-auto max-w-sm aspect-square overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          // Mirror preview for natural selfie experience
          style={{ transform: "scaleX(-1)" }}
        />
        {/* Loading overlay until camera ready */}
        {!isReady && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            Starting camera...
          </div>
        )}
        {/* Square crop indicator overlay */}
        <div className="pointer-events-none absolute inset-2 rounded-xl border-2 border-white/30" />
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={onCancel}
          className="flex-1"
          type="button"
        >
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
        <Button
          onClick={handleCapture}
          disabled={!isReady}
          className="flex-1 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
          type="button"
        >
          <Camera className="mr-1 h-4 w-4" />
          Capture
        </Button>
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Position your face inside the bordered area for the best ID photo.
      </p>
    </div>
  );
}
