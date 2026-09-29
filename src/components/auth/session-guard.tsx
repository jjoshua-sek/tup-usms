"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { HEARTBEAT_PATH } from "@/lib/auth/session-policy";
import { nowMs } from "@/lib/utils/time";

/**
 * Ends a signed-in session in the browser, in the two situations the server
 * cannot see for itself:
 *
 *   Idle — no keyboard, mouse, touch or scroll input for the limit (15
 *   minutes for staff, 30 for students by default). A warning appears a
 *   minute beforehand. Input in any open tab counts for all of them.
 *
 *   Site closed — every tab was closed and the site opened again later. A
 *   new tab asks the others whether anyone is still open; if no tab
 *   answers, the site had been closed, and the old sign-in is ended before
 *   anything else happens.
 *
 * The proxy enforces the idle limit too, and is the part that cannot be
 * bypassed: this component is what makes it pleasant (a warning, a
 * heartbeat while someone reads without clicking), and what catches a
 * closed tab, which the server has no way to observe.
 */

/** Present for as long as this tab has been open, across reloads. */
const TAB_KEY = "usms-tab-open";
/** Last real input in any tab of the site, shared through localStorage. */
const ACTIVITY_KEY = "usms-last-activity";
const CHANNEL_NAME = "usms-session";

const WARN_BEFORE_MS = 60_000;
const CHECK_EVERY_MS = 5_000;
const HEARTBEAT_EVERY_MS = 60_000;
/** How long a new tab waits for another tab of the site to answer. */
const PRESENCE_WAIT_MS = 700;

let memoryActivity = 0;

function readActivity(): number {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || memoryActivity;
  } catch {
    return memoryActivity;
  }
}

function writeActivity(at: number) {
  memoryActivity = at;
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage blocked: activity is tracked for this tab only.
  }
}

/**
 * Marks this tab as open. Called wherever a sign-in lands (the login form,
 * the account activation page) so the first page afterwards is not
 * mistaken for the site being reopened.
 */
export function markTabOpen() {
  try {
    sessionStorage.setItem(TAB_KEY, "1");
  } catch {
    // Storage blocked: the presence check fails open (see below).
  }
  writeActivity(nowMs());
}

type EndReason = "idle" | "closed";

export function SessionGuard({ idleMinutes }: { idleMinutes: number }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const ending = useRef(false);
  const lastHeartbeat = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const limitMs = idleMinutes * 60_000;

  const endSession = useCallback(async (reason: EndReason) => {
    if (ending.current) return;
    ending.current = true;
    channel.current?.postMessage({ type: "ended", reason });
    try {
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // Offline: the cookies are still cleared locally, and the server
      // enforces its own limit on the next request regardless.
    }
    try {
      sessionStorage.removeItem(TAB_KEY);
    } catch {
      // Nothing to clean up.
    }
    // A full navigation, not a router push: nothing from the signed-in
    // session should survive in memory.
    window.location.replace(`/login?notice=${reason === "idle" ? "session-expired" : "site-closed"}`);
  }, []);

  const heartbeat = useCallback(() => {
    const now = nowMs();
    if (now - lastHeartbeat.current < HEARTBEAT_EVERY_MS) return;
    lastHeartbeat.current = now;
    fetch(HEARTBEAT_PATH, { method: "POST", cache: "no-store", keepalive: true })
      .then((response) => {
        // The server decided first — the session was already over.
        if (response.status === 401) void endSession("idle");
      })
      .catch(() => {
        // Offline. The next successful request settles it.
      });
  }, [endSession]);

  const recordActivity = useCallback(() => {
    if (ending.current) return;
    writeActivity(nowMs());
    setSecondsLeft(null);
    heartbeat();
  }, [heartbeat]);

  // ---- Is anyone still here? ----------------------------------------
  useEffect(() => {
    let lastMove = 0;
    const onInput = () => recordActivity();
    // Pointer movement fires constantly; sampling it every few seconds is
    // plenty to know someone is there.
    const onMove = () => {
      const now = nowMs();
      if (now - lastMove < 5_000) return;
      lastMove = now;
      recordActivity();
    };

    const inputs = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    inputs.forEach((event) => window.addEventListener(event, onInput, { passive: true }));
    window.addEventListener("scroll", onInput, { passive: true, capture: true });
    window.addEventListener("pointermove", onMove, { passive: true });

    const check = () => {
      if (ending.current) return;
      const idle = nowMs() - readActivity();
      if (idle >= limitMs) {
        void endSession("idle");
      } else if (idle >= limitMs - WARN_BEFORE_MS) {
        setSecondsLeft(Math.max(Math.ceil((limitMs - idle) / 1000), 0));
      } else {
        setSecondsLeft(null);
      }
    };

    // Timers do not run while a laptop sleeps; check the moment it wakes.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    check();

    return () => {
      inputs.forEach((event) => window.removeEventListener(event, onInput));
      window.removeEventListener("scroll", onInput, { capture: true });
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [endSession, limitMs, recordActivity]);

  // ---- Was the site closed? -----------------------------------------
  useEffect(() => {
    let presence: BroadcastChannel;
    try {
      presence = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // No BroadcastChannel: skip the closed-site check rather than sign
      // people out on a guess. The idle limit still applies.
      return;
    }
    channel.current = presence;

    let answered = false;
    presence.onmessage = (event: MessageEvent<{ type?: string; reason?: EndReason }>) => {
      const message = event.data;
      if (message?.type === "anyone-open") presence.postMessage({ type: "open" });
      if (message?.type === "open") answered = true;
      // Another tab ended the session; follow it rather than keep showing
      // records to whoever looks at this one.
      if (message?.type === "ended" && !ending.current) {
        ending.current = true;
        window.location.replace(
          `/login?notice=${message.reason === "closed" ? "site-closed" : "session-expired"}`,
        );
      }
    };

    let tabWasOpen = true;
    try {
      tabWasOpen = sessionStorage.getItem(TAB_KEY) === "1";
    } catch {
      // Storage blocked: assume open rather than sign out on a guess.
    }

    let timer: number | undefined;
    if (!tabWasOpen) {
      // A tab with no memory of being open: a new tab, or the site reopened
      // after being closed. Only another open tab can tell the difference.
      presence.postMessage({ type: "anyone-open" });
      timer = window.setTimeout(() => {
        if (answered) markTabOpen();
        else void endSession("closed");
      }, PRESENCE_WAIT_MS);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      presence.close();
      channel.current = null;
    };
  }, [endSession]);

  if (secondsLeft === null) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-warning-title"
        aria-describedby="session-warning-body"
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-amber-700" aria-hidden="true" />
          <h2 id="session-warning-title" className="font-display text-base font-semibold">
            Are you still there?
          </h2>
        </div>
        <p id="session-warning-body" className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          For your security you&apos;ll be signed out in{" "}
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {minutes}:{seconds}
          </span>{" "}
          because there&apos;s been no activity for a while.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void endSession("idle")}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted"
          >
            Sign out now
          </button>
          <button
            type="button"
            autoFocus
            onClick={recordActivity}
            className="rounded-md bg-tup-maroon-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-tup-maroon-700"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
