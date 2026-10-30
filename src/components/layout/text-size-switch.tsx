"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * A, A+, A++: makes everything on screen bigger for staff who find the
 * normal size hard to read. Every size in the app is in rem, so changing the
 * root font size scales text, spacing and buttons together. The choice is
 * kept per device in localStorage and applied before first paint by the
 * script in app/layout.tsx (TEXT_SIZE_SCRIPT), so pages never jump.
 */
export const TEXT_SIZE_KEY = "stars-text-size";

const SIZES = [
  { value: "normal", label: "A", name: "Normal text" },
  { value: "large", label: "A+", name: "Larger text" },
  { value: "larger", label: "A++", name: "Largest text" },
] as const;

type TextSize = (typeof SIZES)[number]["value"];

/** Runs before the page paints; keep it tiny and self-contained. */
export const TEXT_SIZE_SCRIPT = `try{var s=localStorage.getItem("${TEXT_SIZE_KEY}");if(s==="large"||s==="larger")document.documentElement.dataset.textSize=s}catch(e){}`;

function readSize(): TextSize {
  if (typeof document === "undefined") return "normal";
  const value = document.documentElement.dataset.textSize;
  return value === "large" || value === "larger" ? value : "normal";
}

// The size lives on <html>, outside React; every switch on screen reads it there.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets the root size the CSS scales from, and remembers it on this device. */
function applySize(next: TextSize) {
  const root = document.documentElement;
  if (next === "normal") delete root.dataset.textSize;
  else root.dataset.textSize = next;
  try {
    localStorage.setItem(TEXT_SIZE_KEY, next);
  } catch {
    // Private windows can refuse storage; the size still applies until reload.
  }
  listeners.forEach((listener) => listener());
}

export function TextSizeSwitch({ className }: { className?: string }) {
  // The server cannot know the stored choice, so it renders "normal".
  const size = useSyncExternalStore(subscribe, readSize, () => "normal" as const);

  return (
    <div role="group" aria-label="Text size" className={cn("flex items-center rounded-lg bg-white/10 p-0.5", className)}>
      {SIZES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.name}
          aria-pressed={size === option.value}
          title={option.name}
          data-size={option.value}
          onClick={() => applySize(option.value)}
          // The highlight comes from CSS (globals.css, .text-size-option), which
          // reads the same <html> attribute the size does, so it is right from
          // the first frame instead of after hydration.
          className="text-size-option min-w-9 rounded-md px-2 py-1 text-sm font-semibold leading-none text-white/85 transition-colors duration-150 hover:bg-white/15 hover:text-white active:scale-[0.97]"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
