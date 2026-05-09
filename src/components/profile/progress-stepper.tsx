import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  number: number;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { number: 1, label: "Personal", description: "Basic info & consent" },
  { number: 2, label: "Family", description: "Background details" },
  { number: 3, label: "Academic", description: "Program & section" },
  { number: 4, label: "Photo", description: "Profile picture" },
];

interface ProgressStepperProps {
  currentStep: number;
  className?: string;
}

/**
 * Visual stepper showing wizard progress.
 * Steps are non-clickable — students cannot skip ahead.
 * Completed steps show a checkmark; current is highlighted; future are dimmed.
 */
export function ProgressStepper({ currentStep, className }: ProgressStepperProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 sm:gap-2",
        className
      )}
    >
      {STEPS.map((step, idx) => {
        const isCompleted = step.number < currentStep;
        const isCurrent = step.number === currentStep;
        const isFuture = step.number > currentStep;
        const isLast = idx === STEPS.length - 1;

        return (
          <div key={step.number} className="flex flex-1 items-center gap-1 sm:gap-2">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted &&
                    "bg-tup-maroon-900 border-tup-maroon-900 text-white",
                  isCurrent &&
                    "bg-tup-maroon-900 border-tup-maroon-900 text-white shadow-lg ring-4 ring-tup-maroon-900/15",
                  isFuture && "bg-muted border-border text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <span className="font-display text-sm font-bold">
                    {step.number}
                  </span>
                )}
              </div>
              <div className="hidden sm:block text-center">
                <p
                  className={cn(
                    "text-xs font-medium",
                    isCurrent && "text-foreground",
                    !isCurrent && "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  {step.description}
                </p>
              </div>
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  "h-0.5 flex-1 transition-colors mt-[-22px] sm:mt-[-22px]",
                  isCompleted ? "bg-tup-maroon-900" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
