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
  /**
   * Outer kernel-loop count (`ReasoningIterationProgress.iteration`, `AgentCompleted.totalIterations`).
   * Compare to `maxIterations`; aligns with trace rows (one step row per loop tick).
   */
  readonly loopIteration: number;
  /**
   * Highest reasoning-step index from `ReasoningStepCompleted` (`step` / `totalSteps`).
   * Can exceed `loopIteration` when strategies emit multiple steps per outer loop.
   */
  readonly reasoningSteps: number;
  readonly maxIterations: number;
  /** LLM provider name (e.g. "anthropic", "openai") — from LLMRequestCompleted */
  readonly provider?: string;
  /** LLM model name (e.g. "claude-sonnet-4-6") — from LLMRequestCompleted */
  readonly model?: string;
  /** Reasoning strategy (e.g. "reactive", "plan-execute-reflect") — from ReasoningIterationProgress */
  readonly strategy?: string;
  /** Provider switched to after fallback — from ProviderFallbackActivated */
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
  /** Accumulated streaming text from TextDeltaReceived events (live only, not persisted).
   *  Resets at each ReasoningIterationProgress boundary. */
  readonly streamText: string;
  /** Error message from AgentCompleted or TaskFailed when run failed. */
  readonly errorMessage: string | null;
}

const DEFAULT_VITALS: RunVitals = {
  entropy: 0,
  trajectory: "EXPLORING",
  tokensUsed: 0,
  cost: 0,
  durationMs: 0,
  loopIteration: 0,
  reasoningSteps: 0,
  maxIterations: 0,  // 0 = unknown; VitalsStrip omits the /N suffix when 0
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
    // AgentStarted fires first — definitive provider + model at run start
    case "AgentStarted":
      return {
        ...v,
        provider: typeof p.provider === "string" && p.provider ? p.provider : v.provider,
        model:    typeof p.model    === "string" && p.model    ? p.model    : v.model,
      };
    case "LLMRequestCompleted":
      return {
        ...v,
        tokensUsed: v.tokensUsed + readTokensUsed(p),
        cost: v.cost + (typeof p.estimatedCost === "number" ? p.estimatedCost : 0),
        durationMs: Math.max(0, msg.ts - runStartMs),
        // LLMRequestCompleted.model may be the "actual" model used (e.g. after routing)
        // Override AgentStarted values with the real model from the first LLM call
        provider: (typeof p.provider === "string" && p.provider && p.provider !== "unknown") ? p.provider : v.provider,
        model:    (typeof p.model    === "string" && p.model    && p.model    !== "unknown") ? p.model    : v.model,
      };
    case "ReasoningStepCompleted": {
      const steps =
        typeof p.totalSteps === "number"
          ? p.totalSteps
          : typeof p.step === "number"
            ? p.step
            : v.reasoningSteps;
      const clamped = Math.max(v.reasoningSteps, Math.max(0, steps));
      return { ...v, reasoningSteps: clamped };
    }
    case "ReasoningIterationProgress": {
      const iter = typeof p.iteration === "number" ? p.iteration : v.loopIteration;
      // maxIterations: use what the framework configured, never let it grow with actual count.
      // If agent runs over, we just show "26" not "26/26" — handled in VitalsStrip display.
      const max =
        typeof p.maxIterations === "number" && p.maxIterations > 0
          ? p.maxIterations
          : v.maxIterations;
      const clampedLoop = Math.max(v.loopIteration, Math.max(0, iter));
      return {
        ...v,
        loopIteration: clampedLoop,
        maxIterations: max,
        // Strategy is consistent across iterations; capture once
        strategy: v.strategy ?? (typeof p.strategy === "string" ? p.strategy : undefined),
      };
    }
    case "AgentCompleted":
      return {
        ...v,
        loopIteration:
          typeof p.totalIterations === "number" ? p.totalIterations : v.loopIteration,
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
  if (msg.type === "AgentPaused") return "paused";
  if (msg.type === "AgentResumed") {
    if (current === "completed" || current === "failed") return current;
    return "live";
  }
  if (msg.type === "AgentCompleted") return pSuccess(msg.payload) ? "completed" : "failed";
  if (msg.type === "TaskFailed") return "failed";
  // Debrief may fire before or after AgentCompleted; never promote a known failure back to completed.
  if (msg.type === "DebriefCompleted") return current === "failed" ? "failed" : "completed";
  if (current === "loading" && msg.type) return "live";
  return current;
}

/** True unless the framework explicitly reported failure (`success === false`). */
function pSuccess(p: Record<string, unknown>): boolean {
  return p.success !== false;
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
    streamText: "",
    errorMessage: null,
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

      // Live streaming text — accumulate TextDeltaReceived, clear on new iteration
      let streamText = s.streamText;
      if (msg.type === "TextDeltaReceived" || msg.type === "TextDelta") {
        const delta = typeof msg.payload.text === "string" ? msg.payload.text
          : typeof msg.payload.delta === "string" ? msg.payload.delta : "";
        streamText = s.streamText + delta;
      } else if (msg.type === "ReasoningIterationProgress") {
        streamText = ""; // new iteration clears the streaming buffer
      }

      // Extract error message from failure events
      let errorMessage = s.errorMessage;
      if (msg.type === "AgentCompleted" && msg.payload.success === false && typeof msg.payload.error === "string") {
        errorMessage = msg.payload.error;
      } else if (msg.type === "TaskFailed") {
        const errStr = typeof msg.payload.error === "string" ? msg.payload.error
          : typeof msg.payload.reason === "string" ? msg.payload.reason : null;
        if (errStr) errorMessage = errStr;
      }

      return {
        ...s,
        events,
        vitals,
        status,
        debrief,
        streamText,
        isChat,
        errorMessage,
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
        errorMessage?: string | null;
      };
      runStartMs = typeof run.startedAt === "number" ? run.startedAt : Date.now();
      const mapped: RunStatus =
        run.status === "live"
          ? "live"
          : run.status === "failed"
            ? "failed"
            : run.status === "paused"
              ? "paused"
              : "completed";

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
        errorMessage: run.errorMessage ?? s.errorMessage,
        vitals: {
          ...s.vitals,
          // DB stores a single merged count until we persist both; replayed events refine this.
          loopIteration: run.iterationCount ?? s.vitals.loopIteration,
          reasoningSteps: run.iterationCount ?? s.vitals.reasoningSteps,
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
      /* network / server error */
    }
  }

  async function resume() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/resume`, {
        method: "POST",
      });
      state.update((s) => {
        if (s.status === "completed" || s.status === "failed") return s;
        return { ...s, status: "live" };
      });
    } catch {
      /* network / server error */
    }
  }

  async function stop() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
      });
    } catch {
      /* network / server error */
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
    resume,
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
