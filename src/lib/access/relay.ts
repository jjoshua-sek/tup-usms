/**
 * Turnstile relay drivers (browser-side).
 *
 * The kiosk decides nothing — the server already did. These functions only
 * translate an "open" verdict into a pulse on the physical arm. Three modes:
 *
 *   none        Software-only pilot: the screen says allow/deny, a guard acts.
 *   local_http  A small relay board (or controller PC) on the gate's LAN that
 *               exposes an HTTP endpoint. Chrome treats http://localhost and
 *               http://127.0.0.1 as trustworthy, so an HTTPS page may call them
 *               without mixed-content errors; other LAN IPs need the board to
 *               speak HTTPS or the kiosk to run over http on the local network.
 *   web_serial  A USB/RS-485 relay module driven through the Web Serial API.
 *               Requires a one-time user gesture to grant the port — hence
 *               `connectSerialRelay()` being wired to a button, not to a scan.
 *
 * Failures are reported, never thrown into the scan path: a dead relay must
 * still show the verdict on screen so the guard can wave the student through.
 */

// ---- Minimal Web Serial typings (the DOM lib doesn't ship them yet) ----
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

function getSerial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

export type RelayMode = "none" | "local_http" | "web_serial";

export interface RelayConfig {
  /** local_http: absolute URL the kiosk pings to open the arm. */
  url?: string;
  /** web_serial: hex bytes, e.g. "A0 01 01 A2". */
  open_command?: string;
  close_command?: string;
  /** How long the relay stays energized. */
  pulse_ms?: number;
  baud_rate?: number;
}

export interface RelayOutcome {
  ok: boolean;
  detail: string;
}

export function relayIsSupported(mode: RelayMode): boolean {
  if (mode === "web_serial") return getSerial() !== null;
  return true;
}

let cachedPort: SerialPortLike | null = null;
let portIsOpen = false;

/** Must be called from a click handler — Web Serial requires a user gesture. */
export async function connectSerialRelay(config: RelayConfig): Promise<RelayOutcome> {
  const serial = getSerial();
  if (!serial) {
    return { ok: false, detail: "This browser has no Web Serial support. Use Chrome or Edge." };
  }

  try {
    cachedPort = await serial.requestPort();
    await cachedPort.open({ baudRate: config.baud_rate ?? 9600 });
    portIsOpen = true;
    return { ok: true, detail: "Relay connected." };
  } catch (error) {
    cachedPort = null;
    portIsOpen = false;
    return { ok: false, detail: describeError(error) };
  }
}

export async function disconnectSerialRelay(): Promise<void> {
  try {
    if (cachedPort && portIsOpen) await cachedPort.close();
  } catch {
    // Nothing useful to do if the port is already gone.
  } finally {
    cachedPort = null;
    portIsOpen = false;
  }
}

export function serialRelayIsConnected(): boolean {
  return portIsOpen;
}

/** Fires the arm. Safe to call for every allowed scan. */
export async function triggerRelay(
  mode: RelayMode,
  config: RelayConfig,
): Promise<RelayOutcome> {
  switch (mode) {
    case "none":
      return { ok: true, detail: "Monitoring only — no relay configured." };
    case "local_http":
      return pulseHttpRelay(config);
    case "web_serial":
      return pulseSerialRelay(config);
  }
}

async function pulseHttpRelay(config: RelayConfig): Promise<RelayOutcome> {
  if (!config.url) return { ok: false, detail: "No relay URL configured for this gate." };

  try {
    await fetch(config.url, {
      method: "POST",
      // The relay board is not a same-origin service and will not send CORS
      // headers; we only need the request to land, not to read the reply.
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return { ok: true, detail: "Relay pulsed." };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  }
}

async function pulseSerialRelay(config: RelayConfig): Promise<RelayOutcome> {
  if (!cachedPort || !portIsOpen) {
    return { ok: false, detail: "Relay not connected. Tap “Connect relay”." };
  }
  if (!config.open_command) {
    return { ok: false, detail: "No open command configured for this gate." };
  }

  const writable = cachedPort.writable;
  if (!writable) return { ok: false, detail: "Serial port is not writable." };

  const writer = writable.getWriter();
  try {
    await writer.write(parseHexCommand(config.open_command));

    if (config.close_command) {
      await sleep(config.pulse_ms ?? 600);
      await writer.write(parseHexCommand(config.close_command));
    }
    return { ok: true, detail: "Relay pulsed." };
  } catch (error) {
    return { ok: false, detail: describeError(error) };
  } finally {
    writer.releaseLock();
  }
}

/** "A0 01 01 A2" (or "a00101a2") → bytes. */
export function parseHexCommand(command: string): Uint8Array {
  const hex = command.replace(/(0X|[^0-9A-F])/gi, "");
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotFoundError") return "No serial device was selected.";
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "The relay did not respond in time.";
    }
    return error.message;
  }
  return "Unknown relay error.";
}
