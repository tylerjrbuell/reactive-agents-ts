/**
 * The local speech server supervisor as Settings · Voice shows it: the status the server reports
 * (`GET /api/voice/local/status`), its label and tone, and how often to ask again. The work itself
 * (docker, models) runs on the server, `server/services/voice/speech-supervisor.ts`.
 */

/** Where the supervisor is. */
export type LocalSpeechPhase = "disabled" | "unavailable" | "checking" | "starting" | "downloading" | "ready" | "failed";

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
}

const PHASES: readonly LocalSpeechPhase[] = ["disabled", "unavailable", "checking", "starting", "downloading", "ready", "failed"];
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
  };
}

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
    case "failed":
      return "Failed";
  }
}

/** Colour family of the pill. */
export function phaseTone(phase: LocalSpeechPhase): "ok" | "warn" | "bad" | "muted" {
  if (phase === "ready") return "ok";
  if (phase === "failed") return "bad";
  if (phase === "checking" || phase === "starting" || phase === "downloading") return "warn";
  return "muted";
}

/** The supervisor is working right now. */
export const isWorking = (phase: LocalSpeechPhase): boolean => phase === "checking" || phase === "starting" || phase === "downloading";

/** Milliseconds until the next status request, or `null` to stop asking (nothing changes by itself). */
export function nextPollMs(s: LocalSpeechStatus | null): number | null {
  if (s === null || !s.keepRunning) return null;
  return isWorking(s.phase) ? 2500 : 30_000;
}

/** Retry is offered after a failure, and when the server stopped on its own after three of them. */
export const canRetry = (s: LocalSpeechStatus): boolean => s.keepRunning && s.phase === "failed";
