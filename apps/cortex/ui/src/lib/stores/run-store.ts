/**
 * Single-run desk: REST bootstrap + live WS (`/ws/live/:agentId?runId=`) with server-side replay.
 */
import { writable } from "svelte/store";
import { createWsClient } from "./ws-client.js";
import { CORTEX_SERVER_URL } from "../constants.js";

export type RunStatus = "live" | "completed" | "failed" | "paused" | "loading";

export interface RunVitals {
  readonly entropy: number;
  readonly trajectory: "CONVERGING" | "EXPLORING" | "STRESSED" | "DIVERGING";
  readonly tokensUsed: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly provider?: string;
  readonly fallbackProvider?: string;
}

export interface CortexLiveMsg {
  readonly v?: number;
  readonly ts: number;
  readonly agentId: string;
  readonly runId: string;
  readonly source?: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

type RunEventRow = {
  ts: number;
  type: string;
  payload: string;
};

export interface RunState {
  readonly runId: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly vitals: RunVitals;
  readonly events: CortexLiveMsg[];
  /** Populated from `DebriefCompleted` — shape matches framework `DebriefPayload`. */
  readonly debrief: unknown | null;
  readonly isChat: boolean;
}

const DEFAULT_VITALS: RunVitals = {
  entropy: 0,
  trajectory: "EXPLORING",
  tokensUsed: 0,
  cost: 0,
  durationMs: 0,
  iteration: 0,
  maxIterations: 10,
};

function readTokensUsed(p: Record<string, unknown>): number {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object" && "total" in raw && typeof (raw as { total: unknown }).total === "number") {
    return (raw as { total: number }).total;
  }
  return 0;
}

function updateVitals(v: RunVitals, msg: CortexLiveMsg, runStartMs: number): RunVitals {
  const p = msg.payload;
  switch (msg.type) {
    case "EntropyScored": {
      const composite = typeof p.composite === "number" ? p.composite : v.entropy;
      const shape =
        p.trajectory && typeof p.trajectory === "object" && "shape" in p.trajectory
          ? String((p.trajectory as { shape: string }).shape)
          : "";
      const trajectory =
        shape === "converging"
          ? "CONVERGING"
          : shape === "diverging"
            ? "DIVERGING"
            : composite > 0.75
              ? "STRESSED"
              : "EXPLORING";
      return { ...v, entropy: composite, trajectory };
    }
    case "LLMRequestCompleted":
      return {
        ...v,
        tokensUsed: v.tokensUsed + readTokensUsed(p),
        cost: v.cost + (typeof p.estimatedCost === "number" ? p.estimatedCost : 0),
        durationMs: Math.max(0, msg.ts - runStartMs),
      };
    case "ReasoningStepCompleted": {
      const iter =
        typeof p.totalSteps === "number"
          ? p.totalSteps
          : typeof p.step === "number"
            ? p.step
            : v.iteration;
      const clampedIter = Math.max(v.iteration, Math.max(0, iter));
      return { ...v, iteration: clampedIter, maxIterations: Math.max(v.maxIterations, clampedIter) };
    }
    case "ReasoningIterationProgress": {
      const iter = typeof p.iteration === "number" ? p.iteration : v.iteration;
      // maxIterations: use what the framework configured, never let it grow with actual count.
      // If agent runs over, we just show "26" not "26/26" — handled in VitalsStrip display.
      const max =
        typeof p.maxIterations === "number" && p.maxIterations > 0
          ? p.maxIterations
          : v.maxIterations;
      const clampedIter = Math.max(v.iteration, Math.max(0, iter));
      return { ...v, iteration: clampedIter, maxIterations: max };
    }
    case "AgentCompleted":
      return {
        ...v,
        iteration: typeof p.totalIterations === "number" ? p.totalIterations : v.iteration,
        tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : v.tokensUsed,
        durationMs: typeof p.durationMs === "number" ? p.durationMs : v.durationMs,
      };
    case "ProviderFallbackActivated":
      return {
        ...v,
        fallbackProvider: typeof p.toProvider === "string" ? p.toProvider : v.fallbackProvider,
      };
    default:
      return v;
  }
}

function deriveStatus(current: RunStatus, msg: CortexLiveMsg): RunStatus {
  if (msg.type === "AgentCompleted") return pSuccess(msg.payload) ? "completed" : "failed";
  if (msg.type === "TaskFailed") return "failed";
  // DebriefCompleted fires after AgentCompleted — belt-and-suspenders stop for EKG animation
  if (msg.type === "DebriefCompleted") return "completed";
  if (current === "loading" && msg.type) return "live";
  return current;
}

function pSuccess(p: Record<string, unknown>): boolean {
  return p.success === true;
}

export interface CreateRunStoreOptions {
  readonly fetchImpl?: typeof fetch;
}

export function createRunStore(runId: string, options?: CreateRunStoreOptions) {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const state = writable<RunState>({
    runId,
    agentId: "",
    status: "loading",
    vitals: DEFAULT_VITALS,
    events: [],
    debrief: null,
    isChat: false,
  });

  let unsubMsg: (() => void) | null = null;
  let liveWs: ReturnType<typeof createWsClient> | null = null;
  let runStartMs = Date.now();
  const seenEventKeys = new Set<string>();

  function eventKey(msg: CortexLiveMsg): string {
    return `${msg.ts}|${msg.type}|${JSON.stringify(msg.payload)}`;
  }

  function applyEvent(msg: CortexLiveMsg) {
    const key = eventKey(msg);
    if (seenEventKeys.has(key)) return;
    seenEventKeys.add(key);
    state.update((s) => {
      if (msg.runId && msg.runId !== runId) return s;
      const events = [...s.events, msg];
      const vitals = updateVitals(s.vitals, msg, runStartMs);
      const status = deriveStatus(s.status, msg);
      let debrief = s.debrief;
      if (msg.type === "DebriefCompleted" && msg.payload.debrief && typeof msg.payload.debrief === "object") {
        debrief = msg.payload.debrief;
      }
      const isChat = s.isChat || msg.type === "ChatTurn";
      return {
        ...s,
        events,
        vitals,
        status,
        debrief,
        isChat,
        agentId: msg.agentId || s.agentId,
      };
    });
  }

  async function init() {
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`);
      if (!res.ok) {
        state.update((s) => ({ ...s, status: "failed" }));
        return;
      }
      const run = (await res.json()) as {
        agentId: string;
        status: string;
        startedAt?: number;
        iterationCount?: number;
        tokensUsed?: number;
        cost?: number;
        debrief?: string | null;
      };
      runStartMs = typeof run.startedAt === "number" ? run.startedAt : Date.now();
      const mapped: RunStatus =
        run.status === "live" ? "live" : run.status === "failed" ? "failed" : "completed";

      // Parse debrief from DB (stored as JSON string)
      let parsedDebrief: unknown = null;
      if (typeof run.debrief === "string" && run.debrief) {
        try { parsedDebrief = JSON.parse(run.debrief); } catch { /* ignore */ }
      }

      state.update((s) => ({
        ...s,
        agentId: run.agentId,
        status: mapped === "live" && s.events.length === 0 ? "loading" : mapped,
        debrief: parsedDebrief ?? s.debrief,
        vitals: {
          ...s.vitals,
          iteration: run.iterationCount ?? s.vitals.iteration,
          tokensUsed: run.tokensUsed ?? s.vitals.tokensUsed,
          cost: run.cost ?? s.vitals.cost,
          durationMs: Date.now() - runStartMs,
        },
      }));

      // Hydrate from persisted events so run detail survives navigation/remount
      // even if live WS reconnect/replay lags or is temporarily unavailable.
      const eventsRes = await fetchFn(
        `${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`,
      );
      if (eventsRes.ok) {
        const rows = (await eventsRes.json()) as RunEventRow[];
        for (const row of rows) {
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(row.payload) as Record<string, unknown>;
          } catch {
            // keep empty payload for malformed legacy rows
          }
          applyEvent({
            ts: row.ts,
            type: row.type,
            payload,
            runId,
            agentId: run.agentId,
            source: "eventbus",
            v: 1,
          });
        }
      }

      liveWs = createWsClient(
        `/ws/live/${encodeURIComponent(run.agentId)}?runId=${encodeURIComponent(runId)}`,
      );
      unsubMsg = liveWs.onMessage((raw) => {
        const msg = raw as CortexLiveMsg;
        if (!msg?.type) return;
        applyEvent(msg);
      });
    } catch {
      state.update((s) => ({ ...s, status: "failed" }));
    }
  }

  void init();

  async function pause() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/pause`, {
        method: "POST",
      });
      state.update((s) => ({ ...s, status: "paused" }));
    } catch {
      /* API may not exist yet */
    }
  }

  async function stop() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      });
    } catch {
      /* API may not exist yet */
    }
  }

  async function deleteRun(): Promise<boolean> {
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`, {
        method: "DELETE",
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return {
    subscribe: state.subscribe,
    pause,
    stop,
    deleteRun,
    destroy: () => {
      unsubMsg?.();
      unsubMsg = null;
      liveWs?.close();
      liveWs = null;
    },
  };
}

export type RunStore = ReturnType<typeof createRunStore>;
