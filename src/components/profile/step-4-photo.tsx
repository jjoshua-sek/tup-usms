"use client";

import { useState, useTransition, useRef } from "react";
import {
  ArrowLeft,
  Loader2,
  Camera,
  Upload,
  Check,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

import { uploadProfilePhoto, finalizeProfile } from "@/app/(student)/profile/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

import { WebcamCapture } from "./webcam-capture";
import { PhotoChoiceDialog } from "./photo-choice-dialog";

interface Step4PhotoProps {
  initialPhotoUrl?: string | null;
  initialIsProvisional?: boolean;
  initialHeight?: number | null;
  initialWeight?: number | null;
  onBack: () => void;
  /** Called after the wizard finalizes and we land on /dashboard */
  onComplete: () => void;
}

type Mode = "choose" | "webcam" | "upload-preview" | "uploading";

export function Step4Photo({
  initialPhotoUrl,
  initialIsProvisional,
  initialHeight,
  initialWeight,
  onBack,
  onComplete,
}: Step4PhotoProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [photoUrl, setPhotoUrl] = useState<string | null>(initialPhotoUrl ?? null);
  const [isProvisional, setIsProvisional] = useState<boolean>(
    initialIsProvisional ?? false
  );
  const [serverError, setServerError] = useState<string | null>(null);

  // Captured-not-yet-uploaded state (from webcam → choice dialog)
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  // Upload preview state (from file picker → preview before upload)
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreviewUrl, setPendingFilePreviewUrl] = useState<string | null>(null);

  const [height, setHeight] = useState<string>(initialHeight ? String(initialHeight) : "");
  const [weight, setWeight] = useState<string>(initialWeight ? String(initialWeight) : "");

  const [isUploading, startUploadTransition] = useTransition();
  const [isFinishing, startFinishTransition] = useTransition();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ============================================
  // File upload path
  // ============================================
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (JPG, PNG, etc.)");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5 MB.");
      return;
    }
    setPendingFile(file);
    setPendingFilePreviewUrl(URL.createObjectURL(file));
    setMode("upload-preview");
  };

  const handleUploadConfirm = () => {
    if (!pendingFile) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.append("photo", pendingFile);
      formData.append("is_provisional", "false"); // file uploads always permanent

      const result = await uploadProfilePhoto(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      if (result.url) {
        setPhotoUrl(result.url);
        setIsProvisional(false);
        setPendingFile(null);
        if (pendingFilePreviewUrl) URL.revokeObjectURL(pendingFilePreviewUrl);
        setPendingFilePreviewUrl(null);
        setMode("choose");
        toast.success("Photo uploaded");
      }
    });
  };

  const handleUploadCancel = () => {
    setPendingFile(null);
    if (pendingFilePreviewUrl) URL.revokeObjectURL(pendingFilePreviewUrl);
    setPendingFilePreviewUrl(null);
    setMode("choose");
  };

  // ============================================
  // Webcam path
  // ============================================
  const handleWebcamCapture = (blob: Blob) => {
    setPendingBlob(blob);
    setPendingPreviewUrl(URL.createObjectURL(blob));
    // Don't switch mode — the choice dialog opens on top
  };

  const handleWebcamCancel = () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingBlob(null);
    setPendingPreviewUrl(null);
    setMode("choose");
  };

  const uploadCapturedPhoto = (provisional: boolean) => {
    if (!pendingBlob) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.append("photo", pendingBlob, "capture.jpg");
      formData.append("is_provisional", String(provisional));

      const result = await uploadProfilePhoto(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      if (result.url) {
        setPhotoUrl(result.url);
        setIsProvisional(provisional);
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingBlob(null);
        setPendingPreviewUrl(null);
        setMode("choose");
        toast.success(
          provisional
            ? "Provisional photo saved — you can replace it anytime"
            : "Photo saved"
        );
      }
    });
  };

  // ============================================
  // Final: complete the wizard
  // ============================================
  const handleFinish = () => {
    if (!photoUrl) {
      toast.error("Please add a profile photo first.");
      return;
    }
    setServerError(null);
    startFinishTransition(async () => {
      const formData = new FormData();
      if (height) formData.append("height_cm", height);
      if (weight) formData.append("weight_lbs", weight);

      const result = await finalizeProfile(formData);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Profile complete! Welcome to USMS.");
      onComplete();
    });
  };

  // ============================================
  // Render: WEBCAM mode
  // ============================================
  if (mode === "webcam") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Take Photo
          </CardTitle>
          <CardDescription>
            Capture your photo using this device&apos;s camera.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WebcamCapture
            onCapture={handleWebcamCapture}
            onCancel={() => setMode("choose")}
          />

          {/* Photo choice dialog — shown when a frame has been captured */}
          {pendingPreviewUrl && (
            <PhotoChoiceDialog
              previewDataUrl={pendingPreviewUrl}
              open={!!pendingPreviewUrl}
              onConfirmPermanent={() => uploadCapturedPhoto(false)}
              onConfirmProvisional={() => uploadCapturedPhoto(true)}
              onCancel={handleWebcamCancel}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // ============================================
  // Render: UPLOAD-PREVIEW mode
  // ============================================
  if (mode === "upload-preview" && pendingFilePreviewUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Confirm Photo
          </CardTitle>
          <CardDescription>Preview your photo before uploading.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="mx-auto h-48 w-48 overflow-hidden rounded-2xl ring-2 ring-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline blob URL */}
            <img
              src={pendingFilePreviewUrl}
              alt="Preview"
              className="h-full w-full object-cover"
            />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            File uploads are saved as your final photo (no reminder).
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleUploadCancel}
              disabled={isUploading}
              className="flex-1"
            >
              <X className="mr-1 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleUploadConfirm}
              disabled={isUploading}
              className="flex-1 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
            >
              {isUploading ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1 h-4 w-4" />
              )}
              Upload this photo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ============================================
  // Render: CHOOSE mode (default)
  // ============================================
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          Profile Photo
        </CardTitle>
        <CardDescription>
          Required. Used for your student ID, profile, and QR identification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {/* Current photo (if uploaded) */}
        {photoUrl ? (
          <div className="flex flex-col items-center gap-3">
            <div
              className={cn(
                "relative h-40 w-40 overflow-hidden rounded-2xl ring-4",
                isProvisional ? "ring-amber-500/30" : "ring-emerald-500/30"
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl}
                alt="Your profile photo"
                className="h-full w-full object-cover"
              />
              {isProvisional && (
                <span className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full bg-amber-500 ring-2 ring-background" />
              )}
            </div>
            {isProvisional ? (
              <div className="text-center max-w-sm">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Provisional photo
                </p>
                <p className="text-xs text-muted-foreground">
                  Replace it anytime by clicking one of the options below.
                </p>
              </div>
            ) : (
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="inline h-4 w-4 mr-1" />
                Photo saved
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-2">
            <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium">No photo yet</p>
            <p className="text-xs text-muted-foreground">
              Choose how you&apos;d like to add one
            </p>
          </div>
        )}

        {/* Two paths */}
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isFinishing}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors hover:border-primary hover:bg-accent/40 disabled:opacity-50"
          >
            <div className="rounded-lg bg-primary/10 p-3 transition-transform group-hover:scale-110">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">
              {photoUrl ? "Upload different photo" : "Upload from device"}
            </p>
            <p className="text-xs text-muted-foreground">
              JPG / PNG · max 5 MB
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode("webcam")}
            disabled={isUploading || isFinishing}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors hover:border-primary hover:bg-accent/40 disabled:opacity-50"
          >
            <div className="rounded-lg bg-primary/10 p-3 transition-transform group-hover:scale-110">
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">
              {photoUrl ? "Retake with camera" : "Take photo now"}
            </p>
            <p className="text-xs text-muted-foreground">
              Use this device&apos;s camera
            </p>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Optional height & weight */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Physical Info — optional
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Height (cm)</Label>
              <Input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="170"
                disabled={isFinishing}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Weight (lbs)</Label>
              <Input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="150"
                disabled={isFinishing}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={isUploading || isFinishing}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <Button
            onClick={handleFinish}
            disabled={!photoUrl || isFinishing || isUploading}
            className="flex-1 bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white"
          >
            {isFinishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Finishing...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Complete profile
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
