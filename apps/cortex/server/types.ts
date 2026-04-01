import type { AgentEvent } from "@reactive-agents/core";

// ─── Branded IDs ────────────────────────────────────────────────────────────

export type RunId = string & { readonly _brand: "RunId" };
export const makeRunId = (): RunId => crypto.randomUUID() as RunId;

export type AgentId = string & { readonly _brand: "AgentId" };

// ─── Config ─────────────────────────────────────────────────────────────────

export interface CortexConfig {
  readonly port: number;
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
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly status: "live" | "completed" | "failed";
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly hasDebrief: boolean;
}

export interface AgentSummary {
  readonly agentId: string;
  readonly name: string;
  readonly status: "active" | "paused" | "stopped" | "error";
  readonly runCount: number;
  readonly lastRunAt?: number;
  readonly schedule?: string;
}
