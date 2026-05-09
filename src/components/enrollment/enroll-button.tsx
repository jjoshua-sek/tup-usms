"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";

import { enrollInSection, dropEnrollment } from "@/app/(student)/enrollment/actions";
import { Button } from "@/components/ui/button";

interface EnrollButtonProps {
  subjectId: string;
  sectionId: string;
  schoolYear: string;
  semester: string;
  hasConflict?: boolean;
  disabled?: boolean;
}

export function EnrollButton({
  subjectId,
  sectionId,
  schoolYear,
  semester,
  hasConflict,
  disabled,
}: EnrollButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleEnroll = () => {
    if (hasConflict) {
      toast.warning("This section conflicts with another enrolled subject.");
      return;
    }
    startTransition(async () => {
      const result = await enrollInSection(
        subjectId,
        sectionId,
        schoolYear,
        semester
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Enrolled successfully");
      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      variant={hasConflict ? "outline" : "default"}
      onClick={handleEnroll}
      disabled={isPending || disabled || hasConflict}
      className={
        !hasConflict ? "bg-tup-maroon-900 hover:bg-tup-maroon-800 text-white" : ""
      }
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {hasConflict ? "Conflicts" : "Enroll"}
        </>
      )}
    </Button>
  );
}

interface DropButtonProps {
  enrollmentId: string;
}

export function DropButton({ enrollmentId }: DropButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDrop = () => {
    if (
      !confirm(
        "Drop this subject? You can re-enroll later if a section is still open."
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await dropEnrollment(enrollmentId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Subject dropped");
      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleDrop}
      disabled={isPending}
      className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <>
          <X className="mr-1 h-3.5 w-3.5" />
          Drop
        </>
      )}
    </Button>
  );
}
