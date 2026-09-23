"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  KeyRound,
  Loader2,
  Plug,
  QrCode,
  ScanLine,
  Settings,
  ShieldAlert,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";

import { CameraScanner } from "@/components/access/camera-scanner";
import {
  connectSerialRelay,
  relayIsSupported,
  serialRelayIsConnected,
  triggerRelay,
  type RelayConfig,
  type RelayMode,
} from "@/lib/access/relay";
import { formatManila } from "@/lib/utils/time";

/** Where the paired device key lives. Never leaves this browser. */
const STORAGE_KEY = "usms.gate.deviceKey";
const HEARTBEAT_MS = 60_000;
/** A scan burst from a USB wedge finishes in well under this. */
const WEDGE_IDLE_RESET_MS = 400;
const RESULT_HOLD_ALLOW_MS = 3_000;
const RESULT_HOLD_DENY_MS = 5_000;

interface GateConfig {
  id: string;
  code: string;
  name: string;
  location: string | null;
  direction_mode: "entry" | "exit" | "bidirectional";
  enforcement_mode: "monitor" | "enforce";
  anti_passback: "off" | "soft" | "hard";
  relay_mode: RelayMode;
  relay_config: RelayConfig;
  is_active: boolean;
}

interface KioskScanResult {
  decision: "allow" | "deny";
  reason: string;
  gateOpened: boolean;
  enforced: boolean;
  headline: string;
  hint: string;
  tone: "success" | "warning" | "danger" | "neutral";
  student: {
    name: string;
    maskedNumber: string;
    photoUrl: string | null;
    program: string | null;
    yearLevel: string | null;
  } | null;
  termLabel: string;
}

type Phase = "loading" | "pairing" | "idle" | "checking" | "result";

export function GateKiosk() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [keyInput, setKeyInput] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const [gate, setGate] = useState<GateConfig | null>(null);
  const [termLabel, setTermLabel] = useState("");
  const [online, setOnline] = useState(true);
  const [result, setResult] = useState<KioskScanResult | null>(null);
  const [clock, setClock] = useState<string | null>(null);
  const [useCamera, setUseCamera] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [relayNote, setRelayNote] = useState<string | null>(null);
  const [tally, setTally] = useState({ allowed: 0, denied: 0 });

  const deviceKeyRef = useRef<string | null>(null);
  const gateRef = useRef<GateConfig | null>(null);
  const busyRef = useRef(false);
  const bufferRef = useRef("");
  const lastKeystrokeRef = useRef(0);
  const lastPayloadRef = useRef<{ payload: string; at: number } | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    gateRef.current = gate;
  }, [gate]);

  // ---------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------
  const applyHeartbeat = useCallback((payload: { gate: GateConfig; term?: { label?: string } }) => {
    setGate(payload.gate);
    if (payload.term?.label) setTermLabel(payload.term.label);
  }, []);

  const heartbeat = useCallback(
    async (key: string): Promise<{ ok: boolean; message?: string }> => {
      try {
        const response = await fetch("/api/access/heartbeat", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          cache: "no-store",
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          return { ok: false, message: body?.error ?? "This device key was rejected." };
        }

        applyHeartbeat((await response.json()) as { gate: GateConfig; term?: { label?: string } });
        return { ok: true };
      } catch {
        return { ok: false, message: "Cannot reach the USMS server." };
      }
    },
    [applyHeartbeat],
  );

  // Restore a previous pairing on load.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked storage: the gate must be paired each session.
    }

    if (!stored) {
      setPhase("pairing");
      return;
    }

    deviceKeyRef.current = stored;
    void heartbeat(stored).then((outcome) => {
      if (outcome.ok) {
        setPhase("idle");
        setOnline(true);
      } else {
        setPairError(outcome.message ?? null);
        setPhase("pairing");
      }
    });
  }, [heartbeat]);

  const handlePair = async () => {
    const key = keyInput.trim();
    if (!key) {
      setPairError("Paste the device key issued by the OSA.");
      return;
    }

    setPairing(true);
    setPairError(null);
    const outcome = await heartbeat(key);
    setPairing(false);

    if (!outcome.ok) {
      setPairError(outcome.message ?? "Pairing failed.");
      return;
    }

    deviceKeyRef.current = key;
    try {
      window.localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Still usable for this session, just not across reloads.
    }
    setKeyInput("");
    setPhase("idle");
    setOnline(true);
  };

  const handleUnpair = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up.
    }
    deviceKeyRef.current = null;
    setGate(null);
    setShowSettings(false);
    setPhase("pairing");
  };

  // ---------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------
  const submitScan = useCallback(
    async (rawPayload: string) => {
      const payload = rawPayload.trim();
      const key = deviceKeyRef.current;
      if (!payload || !key || busyRef.current) return;

      // One physical card often produces two reads (wedge + camera frame).
      const previous = lastPayloadRef.current;
      if (previous && previous.payload === payload && Date.now() - previous.at < 2_500) return;
      lastPayloadRef.current = { payload, at: Date.now() };

      busyRef.current = true;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setPhase("checking");

      let scan: KioskScanResult;
      try {
        const response = await fetch("/api/access/verify", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({ payload }),
          signal: AbortSignal.timeout(8_000),
        });

        scan = (await response.json()) as KioskScanResult;
        setOnline(true);

        if (!response.ok && !scan?.decision) {
          throw new Error("bad response");
        }
      } catch {
        setOnline(false);
        // Fail closed. An offline turnstile that opens for everyone is worse
        // than one that makes the guard check IDs by hand.
        scan = {
          decision: "deny",
          reason: "offline",
          gateOpened: false,
          enforced: true,
          headline: "Gate offline",
          hint: "Please see the guard on duty.",
          tone: "warning",
          student: null,
          termLabel,
        };
      }

      setResult(scan);
      setPhase("result");
      setTally((current) =>
        scan.decision === "allow"
          ? { ...current, allowed: current.allowed + 1 }
          : { ...current, denied: current.denied + 1 },
      );
      playTone(scan.decision === "allow");

      const activeGate = gateRef.current;
      if (scan.gateOpened && activeGate && activeGate.relay_mode !== "none") {
        const outcome = await triggerRelay(activeGate.relay_mode, activeGate.relay_config ?? {});
        if (!outcome.ok) setRelayNote(outcome.detail);
        else setRelayNote(null);
      }

      resetTimerRef.current = setTimeout(
        () => {
          setResult(null);
          setPhase("idle");
          busyRef.current = false;
        },
        scan.decision === "allow" ? RESULT_HOLD_ALLOW_MS : RESULT_HOLD_DENY_MS,
      );
    },
    [termLabel],
  );

  // USB scanners are keyboard wedges: they "type" the payload fast and press
  // Enter. Listening on the window means there is no input to keep focused —
  // one stray click on the kiosk would otherwise blind the gate.
  useEffect(() => {
    if (phase === "pairing" || phase === "loading" || useCamera) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const elapsed = Date.now() - lastKeystrokeRef.current;
      if (elapsed > WEDGE_IDLE_RESET_MS) bufferRef.current = "";
      lastKeystrokeRef.current = Date.now();

      if (event.key === "Enter" || event.key === "Tab") {
        const payload = bufferRef.current;
        bufferRef.current = "";
        if (payload.length >= 4) {
          event.preventDefault();
          void submitScan(payload);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current = (bufferRef.current + event.key).slice(-128);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, useCamera, submitScan]);

  // Config refresh + liveness. Flipping a gate to "enforce" from the staff
  // console reaches the kiosk within a minute; no site visit needed.
  useEffect(() => {
    if (phase === "pairing" || phase === "loading") return;

    const interval = setInterval(() => {
      const key = deviceKeyRef.current;
      if (!key) return;
      void heartbeat(key).then((outcome) => setOnline(outcome.ok));
    }, HEARTBEAT_MS);

    return () => clearInterval(interval);
  }, [phase, heartbeat]);

  // Clock, mounted-only so the server render doesn't disagree. Campus time,
  // whatever zone the kiosk device happens to be set to.
  useEffect(() => {
    const tick = () =>
      setClock(
        formatManila(new Date(), {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }),
      );
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, []);

  // Keep the gate display awake without disabling OS sleep settings.
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    const lock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock;

    if (lock) {
      lock
        .request("screen")
        .then((result) => {
          sentinel = result;
        })
        .catch(() => {});
    }

    return () => {
      void sentinel?.release().catch(() => {});
    };
  }, []);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (phase === "loading") {
    return (
      <Shell>
        <div className="grid place-items-center gap-3 text-white/60">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Starting gate terminal…</p>
        </div>
      </Shell>
    );
  }

  if (phase === "pairing") {
    return (
      <Shell>
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-xl bg-tup-gold-500/15 p-2.5">
              <KeyRound className="h-6 w-6 text-tup-gold-500" />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold">Pair this gate</h1>
              <p className="text-xs text-white/60">TUP–Manila · Campus Access Terminal</p>
            </div>
          </div>

          <label htmlFor="device-key" className="mb-1.5 block text-xs font-medium text-white/70">
            Device key
          </label>
          <input
            id="device-key"
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handlePair();
            }}
            placeholder="usms_gate_…"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/30 focus:border-tup-gold-500 focus:outline-none"
          />
          <p className="mt-2 text-xs text-white/50">
            Issued once from <span className="font-mono">Staff → Gates &amp; Access</span>. It is
            stored only in this browser.
          </p>

          {pairError && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{pairError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void handlePair()}
            disabled={pairing}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-tup-maroon-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-tup-maroon-700 disabled:opacity-60"
          >
            {pairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {pairing ? "Pairing…" : "Pair terminal"}
          </button>
        </div>
      </Shell>
    );
  }

  // A denial the gate didn't act on (monitor mode) gets its own amber
  // treatment: green would lie, red would imply the arm stayed shut.
  const monitorOnly = result?.decision === "deny" && !result.enforced;

  return (
    <Shell
      className={
        phase === "result"
          ? result?.decision === "allow"
            ? "bg-emerald-700"
            : monitorOnly
              ? "bg-amber-600"
              : "bg-red-800"
          : undefined
      }
    >
      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-4 text-xs text-white/70">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-semibold text-white">
            {gate?.name ?? "Gate"}
          </span>
          {gate?.location && <span className="text-white/50">{gate.location}</span>}
          {gate && !gate.is_active && (
            <span className="rounded-full bg-white/15 px-2 py-0.5 font-medium">Lane closed</span>
          )}
          {gate?.enforcement_mode === "monitor" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 font-medium text-amber-100">
              <Eye className="h-3 w-3" /> Monitor mode
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {!online && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-red-100">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
          <span className="tabular-nums">{clock ?? "—"}</span>
          <button
            type="button"
            onClick={() => setShowSettings((open) => !open)}
            aria-label="Terminal settings"
            className="rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            {showSettings ? <X className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main area */}
      {phase === "result" && result ? (
        <ResultPanel result={result} monitorOnly={monitorOnly} />
      ) : phase === "checking" ? (
        <div className="grid place-items-center gap-4 text-white/80">
          <Loader2 className="h-12 w-12 animate-spin" />
          <p className="text-lg">Checking…</p>
        </div>
      ) : (
        <div className="grid max-w-2xl place-items-center gap-5 px-6 text-center">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
            {useCamera ? (
              <CameraScanner onScan={(text) => void submitScan(text)} className="w-[280px]" />
            ) : (
              <ScanLine className="h-24 w-24 animate-pulse text-tup-gold-500" />
            )}
          </div>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Tap your TUP ID
          </h1>
          <p className="text-base text-white/70">
            {useCamera
              ? "Hold the QR code on your ID or Digital ID inside the frame."
              : "Place the QR code on your ID under the scanner."}
          </p>
          {termLabel && <p className="text-xs uppercase tracking-widest text-white/40">{termLabel}</p>}
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 py-4 text-[11px] text-white/45">
        <span>
          {tally.allowed} allowed · {tally.denied} denied this session
        </span>
        <span className="flex items-center gap-3">
          {relayNote && (
            <span className="inline-flex items-center gap-1 text-amber-200">
              <AlertTriangle className="h-3 w-3" /> {relayNote}
            </span>
          )}
          <span>Access logs are retained for 180 days · RA 10173</span>
        </span>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <div className="absolute right-4 top-14 z-10 w-72 rounded-xl border border-white/15 bg-neutral-900/95 p-4 text-xs text-white/80 shadow-2xl backdrop-blur">
          <p className="mb-3 font-display text-sm font-semibold text-white">Terminal</p>

          <dl className="mb-4 space-y-1.5">
            <SettingRow label="Gate code" value={gate?.code ?? "—"} />
            <SettingRow label="Direction" value={gate?.direction_mode ?? "—"} />
            <SettingRow label="Enforcement" value={gate?.enforcement_mode ?? "—"} />
            <SettingRow label="Anti-passback" value={gate?.anti_passback ?? "—"} />
            <SettingRow label="Relay" value={gate?.relay_mode ?? "none"} />
          </dl>

          <button
            type="button"
            onClick={() => setUseCamera((current) => !current)}
            className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 font-medium transition-colors hover:bg-white/10"
          >
            {useCamera ? <QrCode className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {useCamera ? "Use USB scanner" : "Use camera"}
          </button>

          {gate?.relay_mode === "web_serial" && (
            <button
              type="button"
              disabled={!relayIsSupported("web_serial")}
              onClick={async () => {
                const outcome = await connectSerialRelay(gate.relay_config ?? {});
                setRelayNote(outcome.ok ? null : outcome.detail);
              }}
              className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 font-medium transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <Plug className="h-3.5 w-3.5" />
              {serialRelayIsConnected() ? "Relay connected" : "Connect relay"}
            </button>
          )}

          <button
            type="button"
            onClick={handleUnpair}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-400/30 px-3 py-2 font-medium text-red-200 transition-colors hover:bg-red-500/15"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Unpair this terminal
          </button>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------

function Shell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main
      className={`relative grid min-h-screen place-items-center overflow-hidden bg-neutral-950 text-white transition-colors duration-300 ${className ?? ""}`}
    >
      {children}
    </main>
  );
}

function ResultPanel({
  result,
  monitorOnly,
}: {
  result: KioskScanResult;
  monitorOnly: boolean;
}) {
  const Icon =
    result.decision === "allow" ? CheckCircle2 : monitorOnly ? ShieldAlert : XCircle;

  return (
    <div className="grid w-full max-w-3xl place-items-center gap-6 px-6 text-center">
      <Icon className="h-24 w-24" strokeWidth={1.5} />

      <div>
        <h1 className="font-display text-5xl font-bold tracking-tight">{result.headline}</h1>
        <p className="mt-2 text-xl text-white/85">{result.hint}</p>
      </div>

      {result.student && (
        <div className="flex items-center gap-5 rounded-2xl bg-black/20 px-6 py-4 text-left">
          {result.student.photoUrl ? (
            // Plain <img>: kiosk photos come from Supabase Storage and are
            // rendered once, so the optimizer adds latency for no benefit.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.student.photoUrl}
              alt=""
              className="h-24 w-20 rounded-lg object-cover ring-2 ring-white/30"
            />
          ) : (
            <div className="grid h-24 w-20 place-items-center rounded-lg bg-white/10 text-3xl font-semibold">
              {result.student.name.charAt(0)}
            </div>
          )}
          <div>
            <p className="font-display text-2xl font-semibold">{result.student.name}</p>
            <p className="font-mono text-sm text-white/70">{result.student.maskedNumber}</p>
            {(result.student.program || result.student.yearLevel) && (
              <p className="mt-0.5 text-sm text-white/60">
                {[result.student.program, result.student.yearLevel].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
      )}

      {monitorOnly && (
        <p className="rounded-full bg-black/25 px-4 py-1.5 text-xs uppercase tracking-widest">
          Monitor mode — recorded, not blocked
        </p>
      )}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-white/50">{label}</dt>
      <dd className="font-mono text-[11px] text-white">{value}</dd>
    </div>
  );
}

/**
 * Short confirmation tone. Guards work by ear in a noisy corridor — the pitch
 * difference matters more than the volume.
 */
function playTone(allowed: boolean) {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = allowed ? "sine" : "square";
    oscillator.frequency.value = allowed ? 880 : 220;
    gain.gain.value = 0.08;

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();

    const duration = allowed ? 0.14 : 0.42;
    oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => void context.close().catch(() => {});
  } catch {
    // Audio is a nicety; a muted kiosk still works.
  }
}
