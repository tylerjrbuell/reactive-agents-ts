/**
 * The local speech server supervisor as Settings · Voice shows it: the status the server reports
 * (`GET /api/voice/local/status`), its label and tone, and how often to ask again. The work itself
 * (docker, models) runs on the server, `server/services/voice/speech-supervisor.ts`.
 */

/** Where the supervisor is. */
export type LocalSpeechPhase = "disabled" | "unavailable" | "checking" | "starting" | "downloading" | "ready" | "stopping" | "stopped" | "failed";

/** Which Speaches image the server runs: `auto` picks the GPU image when Docker has an NVIDIA runtime. */
export type LocalSpeechDevice = "auto" | "cpu" | "cuda";

/** The server's status body. */
export interface LocalSpeechStatus {
  readonly phase: LocalSpeechPhase;
  /** The opt-in. */
  readonly keepRunning: boolean;
  /** A local Speaches endpoint is saved, so the opt-in can be offered. */
  readonly eligible: boolean;
  readonly message: string;
  readonly lastError: string | null;
  readonly attempts: number;
  /** Three failures in a row: nothing runs again until Retry. */
  readonly locked: boolean;
  readonly container: string;
  readonly endpoint: string | null;
  /** Host port the server is (or will be) published on. */
  readonly port: number;
  readonly device: LocalSpeechDevice;
  /** The server answered at the last look; `null` = not looked yet. */
  readonly running: boolean | null;
  /** Free space in the model cache as the container sees it (Docker's disk), at the last measure; `null` = not measured. */
  readonly cache: { readonly freeBytes: number; readonly checkedAt: number } | null;
}

/** Below this the server refuses a model download (`MIN_FREE_FOR_DOWNLOAD_BYTES` in `server/services/voice/speech-disk.ts`). */
export const LOW_CACHE_BYTES = 1024 ** 3;

function cacheOf(v: unknown): LocalSpeechStatus["cache"] {
  if (!isRecord(v)) return null;
  const { freeBytes, checkedAt } = v;
  return typeof freeBytes === "number" && Number.isFinite(freeBytes) && freeBytes >= 0 && typeof checkedAt === "number" ? { freeBytes, checkedAt } : null;
}

/** `1.2 GB`, `350 MB` (decimal units, as Docker Desktop shows them). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1e6))} MB`;
}

/**
 * The model cache line, or `null` when not measured. Names Docker's disk, because on Docker Desktop the
 * models live on Docker's own fixed-size disk, not the computer's. `low` = under the download floor.
 */
export function cacheLine(s: LocalSpeechStatus): { readonly text: string; readonly low: boolean } | null {
  if (s.cache === null) return null;
  const low = s.cache.freeBytes < LOW_CACHE_BYTES;
  const free = formatBytes(s.cache.freeBytes);
  return low
    ? { text: `Model cache: only ${free} free on Docker's disk, so new model downloads are refused. Raise Docker's disk limit or clear unused images (docker system prune keeps volumes).`, low }
    : { text: `Model cache: ${free} free on Docker's disk.`, low };
}

const PHASES: readonly LocalSpeechPhase[] = ["disabled", "unavailable", "checking", "starting", "downloading", "ready", "stopping", "stopped", "failed"];
const isDevice = (v: unknown): v is LocalSpeechDevice => v === "auto" || v === "cpu" || v === "cuda";

/** Hardware choices for kit `Select`. */
export const DEVICE_OPTIONS: readonly { readonly value: LocalSpeechDevice; readonly label: string; readonly description: string }[] = [
  { value: "auto", label: "Auto", description: "GPU image when Docker has an NVIDIA runtime, else CPU." },
  { value: "cpu", label: "CPU", description: "Runs anywhere; slower for large Whisper models." },
  { value: "cuda", label: "GPU (NVIDIA)", description: "Needs the NVIDIA Container Toolkit." },
];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPhase = (v: unknown): v is LocalSpeechPhase => typeof v === "string" && PHASES.some((p) => p === v);

/** The status from untrusted JSON, or `null` when it is not one. */
export function parseLocalSpeechStatus(v: unknown): LocalSpeechStatus | null {
  if (!isRecord(v) || !isPhase(v.phase)) return null;
  return {
    phase: v.phase,
    keepRunning: v.keepRunning === true,
    eligible: v.eligible === true,
    message: typeof v.message === "string" ? v.message : "",
    lastError: typeof v.lastError === "string" ? v.lastError : null,
    attempts: typeof v.attempts === "number" ? v.attempts : 0,
    locked: v.locked === true,
    container: typeof v.container === "string" ? v.container : "",
    endpoint: typeof v.endpoint === "string" ? v.endpoint : null,
    port: typeof v.port === "number" && Number.isInteger(v.port) ? v.port : 8000,
    device: isDevice(v.device) ? v.device : "auto",
    running: typeof v.running === "boolean" ? v.running : null,
    cache: cacheOf(v.cache),
  };
}

/** Why `text` is not a port the server may use, or `null` when it is (1024 to 65535). */
export function portProblem(text: string): string | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return "Use a port number, such as 8000.";
  const n = Number(t);
  return n >= 1024 && n <= 65535 ? null : "Use a port from 1024 to 65535.";
}

/** The server line under the switch: running on which address, stopped, or not looked yet. */
export function serverLine(s: LocalSpeechStatus): string {
  const at = s.endpoint ?? `127.0.0.1:${s.port}`;
  if (s.running === true) return `Running on ${at}.`;
  if (s.running === false) return `Not running on ${at}.`;
  return `Port ${s.port}.`;
}

/** Start is offered when the server is not answering and nothing is in progress. */
export const canStart = (s: LocalSpeechStatus): boolean => s.eligible && !isWorking(s.phase) && s.phase !== "stopping" && s.running !== true;

/** Stop is offered while the server answers or work runs (it stops the Cortex container only). */
export const canStop = (s: LocalSpeechStatus): boolean => s.eligible && s.phase !== "stopping" && (s.running === true || isWorking(s.phase) || s.keepRunning);

/** The pill text. */
export function phaseLabel(phase: LocalSpeechPhase): string {
  switch (phase) {
    case "disabled":
      return "Off";
    case "unavailable":
      return "Needs a local endpoint";
    case "checking":
      return "Checking";
    case "starting":
      return "Starting";
    case "downloading":
      return "Downloading models";
    case "ready":
      return "Ready";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
  }
}

/** Colour family of the pill. */
export function phaseTone(phase: LocalSpeechPhase): "ok" | "warn" | "bad" | "muted" {
  if (phase === "ready") return "ok";
  if (phase === "failed") return "bad";
  if (phase === "checking" || phase === "starting" || phase === "downloading" || phase === "stopping") return "warn";
  return "muted";
}

/** The supervisor is working right now. */
export const isWorking = (phase: LocalSpeechPhase): boolean => phase === "checking" || phase === "starting" || phase === "downloading";

/** Milliseconds until the next status request, or `null` to stop asking (nothing changes by itself). */
export function nextPollMs(s: LocalSpeechStatus | null): number | null {
  if (s === null) return null;
  if (isWorking(s.phase) || s.phase === "stopping") return 2500;
  return s.keepRunning ? 30_000 : null;
}

/** Retry is offered after a failure (with keep-running off it starts the server again). */
export const canRetry = (s: LocalSpeechStatus): boolean => s.eligible && s.phase === "failed";
