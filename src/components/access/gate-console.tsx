"use client";

import { useState, useTransition } from "react";
import {
  Copy,
  DoorOpen,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createGate,
  rotateGateKey,
  setGateActive,
  updateGate,
} from "@/app/staff/gates/actions";
import { Button } from "@/components/ui/button";
import { formatManilaTime } from "@/lib/utils/time";

export interface GateRow {
  id: string;
  code: string;
  name: string;
  location: string | null;
  direction_mode: "entry" | "exit" | "bidirectional";
  enforcement_mode: "monitor" | "enforce";
  anti_passback: "off" | "soft" | "hard";
  relay_mode: "none" | "local_http" | "web_serial";
  relay_config: Record<string, unknown> | null;
  device_key_prefix: string | null;
  last_seen_at: string | null;
  is_active: boolean;
}

interface GateConsoleProps {
  gates: GateRow[];
  canManage: boolean;
}

/** A kiosk that hasn't checked in for three heartbeats is presumed down. */
const ONLINE_WINDOW_MS = 3 * 60_000;

export function isGateOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

export function GateConsole({ gates, canManage }: GateConsoleProps) {
  const [editing, setEditing] = useState<GateRow | "new" | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ gate: string; key: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    const target = editing;
    if (!target) return;

    startTransition(async () => {
      const result =
        target === "new" ? await createGate(formData) : await updateGate(target.id, formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(target === "new" ? "Gate created." : "Gate updated.");
      if (result.deviceKey) {
        setIssuedKey({
          gate: String(formData.get("name") ?? "this gate"),
          key: result.deviceKey,
        });
      }
      setEditing(null);
    });
  };

  const handleRotate = (gate: GateRow) => {
    startTransition(async () => {
      const result = await rotateGateKey(gate.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.deviceKey) setIssuedKey({ gate: gate.name, key: result.deviceKey });
      toast.success("New device key issued. The old one no longer works.");
    });
  };

  const handleToggle = (gate: GateRow) => {
    startTransition(async () => {
      const result = await setGateActive(gate.id, !gate.is_active);
      if (result.error) toast.error(result.error);
      else toast.success(gate.is_active ? "Lane closed." : "Lane reopened.");
    });
  };

  return (
    <div className="space-y-4">
      {/* One-time key reveal */}
      {issuedKey && (
        <div className="rounded-xl border border-ai-accent bg-ai-accent-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ai-accent">
                <KeyRound className="h-4 w-4" />
                Device key for {issuedKey.gate}
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Copy it into the kiosk at <span className="font-mono">/kiosk</span> now — it is
                shown once and stored only as a hash.
              </p>
              <code className="mt-2 block overflow-x-auto rounded-md bg-background px-3 py-2 font-mono text-xs">
                {issuedKey.key}
              </code>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Copy device key"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(issuedKey.key)
                    .then(() => toast.success("Key copied."))
                    .catch(() => toast.error("Copy failed — select the text manually."));
                }}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setIssuedKey(null)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gate list */}
      <div className="grid gap-3 md:grid-cols-2">
        {gates.map((gate) => {
          const online = isGateOnline(gate.last_seen_at);
          return (
            <div key={gate.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                    />
                    <p className="truncate font-display text-[15px] font-semibold">{gate.name}</p>
                    {!gate.is_active && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Closed
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span className="font-mono">{gate.code}</span>
                    {gate.location ? ` · ${gate.location}` : ""}
                  </p>
                </div>

                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label="Edit gate"
                      onClick={() => setEditing(gate)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={gate.is_active ? "Close lane" : "Reopen lane"}
                      onClick={() => handleToggle(gate)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <Meta label="Mode">
                  {gate.enforcement_mode === "enforce" ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <ShieldCheck className="h-3 w-3" /> Enforcing
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <Eye className="h-3 w-3" /> Monitor
                    </span>
                  )}
                </Meta>
                <Meta label="Direction">{gate.direction_mode}</Meta>
                <Meta label="Anti-passback">{gate.anti_passback}</Meta>
                <Meta label="Relay">{gate.relay_mode}</Meta>
                <Meta label="Key">{gate.device_key_prefix ?? "not issued"}</Meta>
                <Meta label="Last seen">
                  {gate.last_seen_at ? formatManilaTime(gate.last_seen_at) : "never"}
                </Meta>
              </dl>

              {canManage && (
                <button
                  type="button"
                  onClick={() => handleRotate(gate)}
                  disabled={isPending}
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <KeyRound className="h-3 w-3" />
                  Issue new device key
                </button>
              )}
            </div>
          );
        })}

        {gates.length === 0 && (
          <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center md:col-span-2">
            <DoorOpen className="h-6 w-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No gates yet. Add the first turnstile lane to start logging scans.
            </p>
          </div>
        )}
      </div>

      {canManage && !editing && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing("new")}
          className="w-full"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add a gate
        </Button>
      )}

      {/* Create / edit form */}
      {editing && (
        <form
          action={handleSubmit}
          className="space-y-4 rounded-xl border border-border bg-card p-5"
        >
          <div className="flex items-center justify-between">
            <p className="font-display text-sm font-semibold">
              {editing === "new" ? "New gate" : `Edit ${editing.name}`}
            </p>
            <button
              type="button"
              onClick={() => setEditing(null)}
              aria-label="Cancel"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Gate code" hint="Uppercase, e.g. MAIN-ENTRY">
              <input
                name="code"
                required
                defaultValue={editing === "new" ? "" : editing.code}
                placeholder="MAIN-ENTRY"
                className={inputClass}
              />
            </Field>
            <Field label="Display name">
              <input
                name="name"
                required
                defaultValue={editing === "new" ? "" : editing.name}
                placeholder="Main Gate — Ayala Blvd."
                className={inputClass}
              />
            </Field>
            <Field label="Location">
              <input
                name="location"
                defaultValue={editing === "new" ? "" : (editing.location ?? "")}
                placeholder="Main campus, lane 1"
                className={inputClass}
              />
            </Field>
            <Field label="Direction">
              <select
                name="direction_mode"
                defaultValue={editing === "new" ? "entry" : editing.direction_mode}
                className={inputClass}
              >
                <option value="entry">Entry</option>
                <option value="exit">Exit</option>
                <option value="bidirectional">Bidirectional</option>
              </select>
            </Field>
            <Field label="Enforcement" hint="Start in monitor for the first week">
              <select
                name="enforcement_mode"
                defaultValue={editing === "new" ? "monitor" : editing.enforcement_mode}
                className={inputClass}
              >
                <option value="monitor">Monitor — log only, always open</option>
                <option value="enforce">Enforce — deny holds the arm</option>
              </select>
            </Field>
            <Field label="Anti-passback">
              <select
                name="anti_passback"
                defaultValue={editing === "new" ? "soft" : editing.anti_passback}
                className={inputClass}
              >
                <option value="off">Off</option>
                <option value="soft">Soft — allow but flag</option>
                <option value="hard">Hard — deny</option>
              </select>
            </Field>
            <Field label="Relay">
              <select
                name="relay_mode"
                defaultValue={editing === "new" ? "none" : editing.relay_mode}
                className={inputClass}
              >
                <option value="none">None — screen only</option>
                <option value="local_http">Local HTTP relay board</option>
                <option value="web_serial">USB / RS-485 (Web Serial)</option>
              </select>
            </Field>
            <Field label="Relay URL" hint="local_http only">
              <input
                name="relay_url"
                defaultValue={
                  editing === "new" ? "" : String(editing.relay_config?.url ?? "")
                }
                placeholder="http://127.0.0.1:8181/open"
                className={inputClass}
              />
            </Field>
            <Field label="Open command" hint="web_serial only, hex">
              <input
                name="open_command"
                defaultValue={
                  editing === "new" ? "" : String(editing.relay_config?.open_command ?? "")
                }
                placeholder="A0 01 01 A2"
                className={inputClass}
              />
            </Field>
            <Field label="Close command" hint="web_serial only, hex">
              <input
                name="close_command"
                defaultValue={
                  editing === "new" ? "" : String(editing.relay_config?.close_command ?? "")
                }
                placeholder="A0 01 00 A1"
                className={inputClass}
              />
            </Field>
            <Field label="Pulse (ms)">
              <input
                name="pulse_ms"
                type="number"
                min={100}
                max={5000}
                defaultValue={
                  editing === "new" ? 600 : Number(editing.relay_config?.pulse_ms ?? 600)
                }
                className={inputClass}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-tup-maroon-600 text-white hover:bg-tup-maroon-700"
            >
              {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing === "new" ? "Create gate & issue key" : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:border-tup-maroon-600 focus:outline-none";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
