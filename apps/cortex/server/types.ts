import type { AgentEvent } from "@reactive-agents/core";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export type RunId = string & { readonly _brand: "RunId" };
export const makeRunId = (): RunId => crypto.randomUUID() as RunId;

export type AgentId = string & { readonly _brand: "AgentId" };

// ─── Config ─────────────────────────────────────────────────────────────────

export interface CortexConfig {
  readonly port: number;
  /**
   * Interface to bind. Unset: `CORTEX_HOST`, else `127.0.0.1` (this computer only; loopback
   * needs no token). A non-loopback hostname such as `0.0.0.0` exposes Cortex to the network
   * and requires an access token (`token` / `CORTEX_TOKEN`): without one the server refuses
   * to start.
   */
  readonly hostname?: string;
  /**
   * Access token for `/api/*` and `/ws/*` (default: `CORTEX_TOKEN`). Required when `hostname`
   * is not loopback; the server refuses to start without it. Loopback needs none.
   */
  readonly token?: string;
  readonly dbPath: string;
  readonly staticAssetsPath?: string;
  readonly openBrowser: boolean;
}

export const defaultCortexConfig: CortexConfig = {
  port: 4321,
  dbPath: ".cortex/cortex.db",
  openBrowser: true,
};

/** Live WS channel for the Stage desk (duplicate fan-out from ingest). */
export const CORTEX_DESK_LIVE_AGENT_ID = "cortex-broadcast";

// ─── WebSocket Protocol ─────────────────────────────────────────────────────

/** Message sent by agents to /ws/ingest */
export interface CortexIngestMessage {
  readonly v: 1;
  readonly agentId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly event: AgentEvent;
}

/** Message sent by server to UI clients on /ws/live/:agentId */
export interface CortexLiveMessage {
  readonly v: 1;
  readonly ts: number;
  readonly agentId: string;
  readonly runId: string;
  /** Chat session the run is the root of (Cortex chat); absent for every other run. */
  readonly sessionId?: string;
  readonly source: "eventbus" | "stream";
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

// ─── Run Context ────────────────────────────────────────────────────────────

export interface RunContext {
  readonly runId: RunId;
  readonly agentId: AgentId;
  readonly startedAt: number;
  readonly abortController: AbortController;
}

// ─── REST API shapes ────────────────────────────────────────────────────────

export interface RunSummary {
  readonly runId: string;
  readonly agentId: string;
  /** Human label: run `display_name`, else linked `cortex_agents.name`, else unset (UI derives). */
  readonly displayName?: string;
  /** Linked `cortex_agents.name` when that row exists (may duplicate displayName when run label was resolved from agent). */
  readonly agentRecordName?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  /** `stopped`: ended from outside (desk Stop, or a chat turn stopped or left mid-run). `blocked`: a guardrail ended the run. */
  readonly status: "live" | "completed" | "failed" | "stopped" | "blocked";
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly hasDebrief: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: string;
  readonly errorMessage?: string;
  /**
   * How the run ended, from its AgentCompleted (ui-core `TurnEnding`): `abstained`
   * and `partial` runs have status `failed` but are not failures. Unset while live
   * and on runs that never completed.
   */
  readonly ending?: string;
  /** Delegation context from AgentStarted (sub-agent runs only for parentRunId). */
  readonly parentRunId?: string;
  readonly rootRunId?: string;
  /** This run's own RunContext.runId (AgentStarted.runId); absent on root runs and rows persisted before stamping. */
  readonly contextRunId?: string;
  /** The run this one continues (Continue = `resumeRun({ newRun: true })`, stamped on AgentStarted.config); absent on ordinary and older runs. */
  readonly continuedFrom?: string;
  readonly depth?: number;
  /** The chat session that started this run (its own events, or its root run's, carry it); unset once the session is deleted. */
  readonly chatSessionId?: string;
  /** That chat session's name. */
  readonly chatSessionName?: string;
  /** Parsed per-run launch config snapshot (from `launch_params_json`); enables Rerun / Edit & Rerun. */
  readonly launchParams?: Record<string, unknown>;
}

export interface AgentSummary {
  readonly agentId: string;
  readonly name: string;
  readonly status: "active" | "paused" | "stopped" | "error";
  readonly runCount: number;
  readonly lastRunAt?: number;
  readonly schedule?: string;
}
