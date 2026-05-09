"use client";

import { Camera, Clock, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PhotoChoiceDialogProps {
  /** Captured photo data URL for preview */
  previewDataUrl: string;
  open: boolean;
  /** Called when user picks "Set as my profile photo" (NOT provisional) */
  onConfirmPermanent: () => void;
  /** Called when user picks "Use for now" (provisional) */
  onConfirmProvisional: () => void;
  /** Called when user cancels (back to retake) */
  onCancel: () => void;
}

/**
 * Modal shown after a webcam capture is confirmed but BEFORE upload.
 *
 * Lets the student declare their intent:
 * - "Set as my profile photo" → photo_is_provisional = false (no reminder)
 * - "Use for now — I'll update later" → photo_is_provisional = true
 *   (persistent reminder banner + dot indicator on avatar)
 *
 * Both options upload the same photo. The difference is metadata.
 */
export function PhotoChoiceDialog({
  previewDataUrl,
  open,
  onConfirmPermanent,
  onConfirmProvisional,
  onCancel,
}: PhotoChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Camera className="h-5 w-5 text-primary" />
            How will you use this photo?
          </DialogTitle>
          <DialogDescription>
            Both options accept the photo — choose based on whether you plan
            to replace it later.
          </DialogDescription>
        </DialogHeader>

        {/* Photo preview */}
        <div className="mx-auto h-32 w-32 overflow-hidden rounded-xl ring-2 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewDataUrl}
            alt="Captured photo preview"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="space-y-2">
          {/* Option A: permanent */}
          <button
            type="button"
            onClick={onConfirmPermanent}
            className="group flex w-full items-start gap-3 rounded-lg border-2 border-emerald-500/30 bg-emerald-500/5 p-4 text-left transition-all hover:border-emerald-500 hover:bg-emerald-500/10"
          >
            <div className="rounded-lg bg-emerald-500/15 p-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="flex-1 space-y-0.5">
              <p className="font-medium text-emerald-900 dark:text-emerald-200">
                Set as my profile photo
              </p>
              <p className="text-xs text-muted-foreground">
                I&apos;m happy with this photo — no reminders needed.
              </p>
            </div>
          </button>

          {/* Option B: provisional */}
          <button
            type="button"
            onClick={onConfirmProvisional}
            className="group flex w-full items-start gap-3 rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-4 text-left transition-all hover:border-amber-500 hover:bg-amber-500/10"
          >
            <div className="rounded-lg bg-amber-500/15 p-2">
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div className="flex-1 space-y-0.5">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Use for now — I&apos;ll update later
              </p>
              <p className="text-xs text-muted-foreground">
                Acceptable for now, but I want a reminder to replace it.
              </p>
            </div>
          </button>
        </div>

        <div className="flex justify-center pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Go back and retake
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          You can always change your photo later from your profile.
        </p>
      </DialogContent>
    </Dialog>
  );
}
