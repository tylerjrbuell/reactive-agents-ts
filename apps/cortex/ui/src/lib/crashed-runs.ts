/**
 * Crashed durable desk runs on Runs (roadmap C13): runs a crash left mid-run
 * whose durable checkpoint the framework can resume (`GET /api/crashed-runs`,
 * server `services/crashed-runs.ts`). Resume calls the framework's `resumeRun`
 * as a new linked Cortex run (server `services/desk-continue.ts`). Rendering: `components/runs/CrashedRuns.svelte`.
 */
import { formatRelativeTime } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";

/** One resumable crashed run (`GET /api/crashed-runs`). */
export interface CrashedRunWire {
  readonly runId: string;
  readonly agentId: string;
  readonly name: string | null;
  readonly startedAt: number;
  readonly durableRunId: string;
  /** 0-based loop of the last checkpoint. */
  readonly checkpointIteration: number;
  readonly updatedAt: number;
}

/** The run's label: its name, else the agent id. */
export const crashedRunLabel = (r: CrashedRunWire): string => r.name?.trim() || r.agentId;

/** The detail line: the loop it resumes from and when it was last saved. */
export function crashedRunDetail(r: CrashedRunWire, now: number = Date.now()): string {
  return `Stopped mid-run · resumes after loop ${r.checkpointIteration + 1} · last saved ${formatRelativeTime(r.updatedAt, now)}`;
}

/** Resumable crashed runs; `[]` on any failure (the strip then shows nothing). */
export async function fetchCrashedRuns(): Promise<CrashedRunWire[]> {
  try {
    const r = await fetch(`${CORTEX_SERVER_URL}/api/crashed-runs`);
    if (!r.ok) return [];
    return ((await r.json()) as { runs?: CrashedRunWire[] }).runs ?? [];
  } catch {
    return [];
  }
}

/** Resume one crashed run as a new linked run (`runId` = the new run); the error text when the server refused. */
export async function resumeCrashedRun(runId: string): Promise<{ ok: true; runId?: string } | { ok: false; error: string }> {
  try {
    const r = await fetch(`${CORTEX_SERVER_URL}/api/crashed-runs/${encodeURIComponent(runId)}/resume`, { method: "POST" });
    if (r.ok) {
      const body = (await r.json().catch(() => ({}))) as { runId?: unknown };
      return { ok: true, ...(typeof body.runId === "string" ? { runId: body.runId } : {}) };
    }
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `Server returned ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
