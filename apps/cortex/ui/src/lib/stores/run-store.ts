/**
 * Single-run desk: REST bootstrap + live WS (`/ws/live/:agentId?runId=`) with server-side replay.
 */
import { writable } from "svelte/store";
import { createWsClient } from "./ws-client.js";
import { CORTEX_SERVER_URL } from "../constants.js";
import { foldRunStrategy, initialRunStrategy, runStrategyOf, type RunStrategyState, type StructuredOutputReportWire, type ThroughputSample } from "@reactive-agents/ui-core";
import { throughputSampleOf } from "../llm-throughput.js";
import { effectiveBound, planBudgetEffective } from "../plan-budget.js";
import { abortStatusOf } from "../run-live-status.js";
import { deskInterruptToast, interruptAnswerOf, type InterruptAnswer } from "../run-controls.js";
import { toast } from "./toast-store.js";

/**
 * `stopped`: ended from outside (desk Stop, or a chat turn stopped or left mid-run).
 * `blocked`: a guardrail ended it (`AgentAborted` reason `guardrail`).
 */
export type RunStatus = "live" | "completed" | "failed" | "paused" | "stopped" | "blocked" | "loading";

/** A finished run: nothing more will happen to it. */
export function isRunSettled(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "blocked";
}

/**
 * The run view's status for a `GET /api/runs/:runId` row. `stopped` stays
 * stopped (B3: it used to read as completed, so a stopped run showed Finished).
 */
export function runStatusOfSummary(status: string): RunStatus {
  switch (status) {
    case "live":
      return "live";
    case "failed":
      return "failed";
    case "paused":
      return "paused";
    case "stopped":
    case "cancelled":
      return "stopped";
    case "blocked":
      return "blocked";
    default:
      return "completed";
  }
}

export interface RunVitals {
  readonly entropy: number;
  readonly trajectory: "CONVERGING" | "EXPLORING" | "STRESSED" | "DIVERGING";
  readonly tokensUsed: number;
  /** Provider-reported input half, accumulated across LLM calls; absent when never reported. */
  readonly tokensIn?: number;
  /** Provider-reported output half, accumulated across LLM calls; absent when never reported. */
  readonly tokensOut?: number;
  /** Cache-adjusted billed tokens, accumulated; absent when never reported. */
  readonly billedTokens?: number;
  /** Hidden-reasoning tokens, accumulated; absent when never reported. */
  readonly reasoningTokens?: number;
  readonly cost: number;
  readonly durationMs: number;
  /**
   * Every LLM call's throughput fields (`LLMRequestCompleted` durationMs / tokensOut /
   * firstTokenMs), in order; the run's average speed is ui-core `throughputOfCalls` over them.
   */
  readonly llmCalls?: readonly ThroughputSample[];
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
  /** The plan-raised iteration bound (`plan_budget_raised`), once announced; progress events keep the configured bound. */
  readonly planBudgetMax?: number;
  /** LLM provider name (e.g. "anthropic", "openai") — from LLMRequestCompleted */
  readonly provider?: string;
  /** LLM model name (e.g. "claude-sonnet-4-6") — from LLMRequestCompleted */
  readonly model?: string;
  /**
   * Reasoning strategy the run started with (e.g. "reactive") — ui-core `foldRunStrategy`,
   * the rule the server's stored run row uses too (resolved config > kernel loop > step event).
   */
  readonly strategy?: string;
  /** The strategy fold behind `strategy` / `switchedStrategy`. */
  readonly strategyFold?: RunStrategyState;
  /** Provider switched to after fallback — from ProviderFallbackActivated */
  readonly fallbackProvider?: string;
  /**
   * Strategy the run ended on after a mid-run switch — from the last `StrategySwitched.to`.
   * `strategy` stays the one the run started with, so the pill reads `reactive → plan-execute-reflect`.
   */
  readonly switchedStrategy?: string;
  /** Resolved tool disclosure and the layer that decided it — from `AgentStarted.config.disclosure` (run-started.config). */
  readonly disclosure?: { readonly mode: string; readonly source: string };
  /** `AgentCompleted.outcome.toleratedBy` — set only when the runtime shipped success over a kernel `partial`. */
  readonly toleratedBy?: string;
  /** `AgentCompleted.outcome.statusReason` — why the runtime shipped its final status. */
  readonly statusReason?: string;
}

/** Tolerance facts from `AgentCompleted.outcome`; empty when the run was not tolerated. */
/** A stored event's report field is a real report (has an outcome), not a stray value. */
function reportOf(v: unknown): boolean {
  return typeof v === "object" && v !== null && ((v as { outcome?: unknown }).outcome === "success" || (v as { outcome?: unknown }).outcome === "failure");
}

function readTolerance(p: Record<string, unknown>): Pick<RunVitals, "toleratedBy" | "statusReason"> {
  const o = p.outcome;
  if (!o || typeof o !== "object") return {};
  const { tolerated, toleratedBy, statusReason } = o as { tolerated?: unknown; toleratedBy?: unknown; statusReason?: unknown };
  if (tolerated !== true) return {};
  return {
    toleratedBy: typeof toleratedBy === "string" && toleratedBy ? toleratedBy : "tolerance lane",
    ...(typeof statusReason === "string" && statusReason ? { statusReason } : {}),
  };
}

/** `AgentStarted.config.disclosure` → `{ mode, source }`; empty on emitters that predate it. */
function readDisclosure(p: Record<string, unknown>): Pick<RunVitals, "disclosure"> {
  const c = p.config;
  const d = c && typeof c === "object" ? (c as { disclosure?: unknown }).disclosure : undefined;
  if (!d || typeof d !== "object") return {};
  const { mode, source } = d as { mode?: unknown; source?: unknown };
  return typeof mode === "string" && typeof source === "string" ? { disclosure: { mode, source } } : {};
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
  /** Accumulated streaming text from TextDelta events (live only, not persisted).
   *  Resets at each ReasoningIterationProgress boundary. */
  readonly streamText: string;
  /** Error message from AgentCompleted or TaskFailed when run failed. */
  readonly errorMessage: string | null;
  /** Typed structured output (`.withOutputSchema`) — from `StructuredOutputExtracted`. */
  readonly structuredObject: unknown | null;
  /** Lenient parse-fail message when extraction failed. */
  readonly structuredError: string | null;
  /** How the typed object was obtained: the framework's `StructuredOutputReported` (or the runner's `StructuredOutputExtracted.objectReport`). */
  readonly structuredReport: StructuredOutputReportWire | null;
  /** Per-run launch config snapshot (from `launch_params_json`); enables Rerun / Edit & Rerun. */
  readonly launchParams: Record<string, unknown> | null;
  /** Run label (`display_name`, else the saved agent's name). */
  readonly displayName?: string;
  /** The chat session that started this run (or its root run), when it still exists. */
  readonly chatSessionId?: string;
  readonly chatSessionName?: string;
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

/** Fold one live message into the run vitals. Exported for tests. */
export function updateVitals(v: RunVitals, msg: CortexLiveMsg, runStartMs: number): RunVitals {
  const prior = v.strategyFold ?? initialRunStrategy;
  const fold = foldRunStrategy(prior, msg.type, msg.payload);
  return fold === prior ? foldVitals(v, msg, runStartMs) : foldVitals(withStrategy(v, fold), msg, runStartMs);
}

/** `strategy` / `switchedStrategy` from the shared strategy fold. */
function withStrategy(v: RunVitals, fold: RunStrategyState): RunVitals {
  const { strategy, switchedTo } = runStrategyOf(fold);
  const { strategy: _s, switchedStrategy: _w, ...rest } = v;
  return { ...rest, strategyFold: fold, ...(strategy ? { strategy } : {}), ...(switchedTo ? { switchedStrategy: switchedTo } : {}) };
}

function foldVitals(v: RunVitals, msg: CortexLiveMsg, runStartMs: number): RunVitals {
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
        ...readDisclosure(p),
      };
    case "LLMRequestCompleted": {
      const inHalf = typeof p.tokensIn === "number" ? p.tokensIn : undefined;
      const outHalf = typeof p.tokensOut === "number" ? p.tokensOut : undefined;
      const billed = typeof p.billedTokens === "number" ? p.billedTokens : undefined;
      const reasoning = typeof p.reasoningTokens === "number" ? p.reasoningTokens : undefined;
      const sample = throughputSampleOf(p);
      return {
        ...v,
        ...(sample ? { llmCalls: [...(v.llmCalls ?? []), sample] } : {}),
        tokensUsed: v.tokensUsed + readTokensUsed(p),
        ...(inHalf !== undefined ? { tokensIn: (v.tokensIn ?? 0) + inHalf } : {}),
        ...(outHalf !== undefined ? { tokensOut: (v.tokensOut ?? 0) + outHalf } : {}),
        ...(billed !== undefined ? { billedTokens: (v.billedTokens ?? 0) + billed } : {}),
        ...(reasoning !== undefined ? { reasoningTokens: (v.reasoningTokens ?? 0) + reasoning } : {}),
        cost: v.cost + (typeof p.estimatedCost === "number" ? p.estimatedCost : 0),
        durationMs: Math.max(0, msg.ts - runStartMs),
        // LLMRequestCompleted.model may be the "actual" model used (e.g. after routing)
        // Override AgentStarted values with the real model from the first LLM call
        provider: (typeof p.provider === "string" && p.provider && p.provider !== "unknown") ? p.provider : v.provider,
        model:    (typeof p.model    === "string" && p.model    && p.model    !== "unknown") ? p.model    : v.model,
      };
    }
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
    case "GuardFiredEmitted": {
      const raised = planBudgetEffective(msg.type, p);
      return raised === undefined ? v : { ...v, planBudgetMax: raised, maxIterations: effectiveBound(v.maxIterations, raised) };
    }
    case "ReasoningIterationProgress": {
      const iter = typeof p.iteration === "number" ? p.iteration : v.loopIteration;
      // maxIterations: use what the framework configured, never let it grow with actual count.
      // If agent runs over, we just show "26" not "26/26" — handled in VitalsStrip display.
      const max =
        typeof p.maxIterations === "number" && p.maxIterations > 0
          ? effectiveBound(p.maxIterations, v.planBudgetMax)
          : v.maxIterations;
      const clampedLoop = Math.max(v.loopIteration, Math.max(0, iter));
      return {
        ...v,
        loopIteration: clampedLoop,
        maxIterations: max,
      };
    }
    // A stopped or cancelled run may never send AgentCompleted (a terminate
    // during a model call): its end is the stop event's time, never the
    // duration of its last finished model call.
    case "AgentAborted":
      if (typeof p.durationMs === "number" && p.durationMs > 0) return { ...v, durationMs: p.durationMs };
      return runStartMs > 0 && msg.ts > runStartMs ? { ...v, durationMs: Math.max(v.durationMs, msg.ts - runStartMs) } : v;
    case "AgentStopped":
    case "AgentTerminated":
    case "ExecutionCancelled":
    case "TaskFailed":
      return runStartMs > 0 && msg.ts > runStartMs ? { ...v, durationMs: Math.max(v.durationMs, msg.ts - runStartMs) } : v;
    case "AgentCompleted":
      return {
        ...v,
        loopIteration:
          typeof p.totalIterations === "number" ? p.totalIterations : v.loopIteration,
        tokensUsed: typeof p.totalTokens === "number" ? p.totalTokens : v.tokensUsed,
        durationMs: typeof p.durationMs === "number" ? p.durationMs : v.durationMs,
        ...readTolerance(p),
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

/**
 * The run's status after one live message. Same rules as the server and the
 * Runs list (`run-live-status.ts`): `ExecutionCancelled`, `AgentStopped` (desk
 * Stop) and `AgentTerminated` stop the run, and a
 * stopped run that then reports a failure (or a debrief) stays stopped.
 * Exported for tests.
 */
export function deriveStatus(current: RunStatus, msg: CortexLiveMsg): RunStatus {
  if (msg.type === "AgentPaused") return current === "stopped" ? current : "paused";
  if (msg.type === "AgentResumed") {
    if (isRunSettled(current)) return current;
    return "live";
  }
  if (msg.type === "ExecutionCancelled" || msg.type === "AgentStopped" || msg.type === "AgentTerminated") return "stopped";
  if (current === "blocked" && (msg.type === "TaskFailed" || msg.type === "AgentCompleted" || msg.type === "DebriefCompleted")) {
    return current;
  }
  if (current === "stopped" && (msg.type === "TaskFailed" || msg.type === "AgentCompleted" || msg.type === "DebriefCompleted")) {
    return current;
  }
  if (msg.type === "AgentCompleted") return pSuccess(msg.payload) ? "completed" : "failed";
  if (msg.type === "TaskFailed") return "failed";
  // The run's effect failed without AgentCompleted (e.g. an output guardrail block).
  if (msg.type === "AgentAborted") return isRunSettled(current) ? current : abortStatusOf(msg.payload);
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
    structuredObject: null,
    structuredError: null,
    structuredReport: null,
    launchParams: null,
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

      // Typed structured output (.withOutputSchema) — surfaced by the runner.
      let structuredObject = s.structuredObject;
      let structuredError = s.structuredError;
      let structuredReport = s.structuredReport;
      if (msg.type === "StructuredOutputExtracted") {
        if ("object" in msg.payload) structuredObject = msg.payload.object;
        if (typeof msg.payload.objectError === "string") structuredError = msg.payload.objectError;
        if (reportOf(msg.payload.objectReport)) structuredReport = msg.payload.objectReport as StructuredOutputReportWire;
      } else if (msg.type === "StructuredOutputReported" && reportOf(msg.payload.report)) {
        structuredReport = msg.payload.report as StructuredOutputReportWire;
      }

      // Live streaming text — accumulate TextDelta, clear on new iteration
      let streamText = s.streamText;
      if (msg.type === "TextDelta") {
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
      } else if (msg.type === "AgentAborted" && typeof msg.payload.error === "string" && msg.payload.error && errorMessage === null) {
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
        structuredObject,
        structuredError,
        structuredReport,
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
        launchParams?: Record<string, unknown>;
        displayName?: string;
        chatSessionId?: string;
        chatSessionName?: string;
      };
      runStartMs = typeof run.startedAt === "number" ? run.startedAt : Date.now();
      const mapped = runStatusOfSummary(run.status);

      // Parse debrief from DB (stored as JSON string)
      let parsedDebrief: unknown = null;
      if (typeof run.debrief === "string" && run.debrief) {
        try { parsedDebrief = JSON.parse(run.debrief); } catch { /* ignore */ }
      }

      state.update((s) => ({
        ...s,
        agentId: run.agentId,
        status: mapped === "live" && s.events.length === 0 ? "loading" : mapped,
        launchParams: run.launchParams ?? s.launchParams,
        ...(run.displayName ? { displayName: run.displayName } : {}),
        ...(run.chatSessionId ? { chatSessionId: run.chatSessionId, isChat: true } : {}),
        ...(run.chatSessionName ? { chatSessionName: run.chatSessionName } : {}),
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

  /** Tell the person what a Pause / Stop did (a durable run was saved so Continue works, or only stopped). */
  function announce(kind: "pause" | "stop", answer: InterruptAnswer): void {
    const t = deskInterruptToast(kind, answer);
    if (t.tone === "success") toast.success(t.title, t.detail);
    else toast.warning(t.title, t.detail);
  }

  async function pause() {
    try {
      const answer = await interruptAnswerOf(await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/pause`, { method: "POST" }));
      // A durable run ends at its next step and reads stopped from its own events; an in-process
      // pause (no Durable runs) holds the run, and Resume releases it.
      if (!(answer.ok && answer.persisted)) state.update((s) => ({ ...s, status: "paused" }));
      announce("pause", answer);
    } catch {
      /* network / server error */
    }
  }

  async function resume() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/resume`, {
        method: "POST",
      });
      state.update((s) => (isRunSettled(s.status) ? s : { ...s, status: "live" }));
    } catch {
      /* network / server error */
    }
  }

  async function stop() {
    try {
      const answer = await interruptAnswerOf(await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }));
      // Only a saved stop earns a toast: a plain stop of a run without Durable runs is what Stop always did.
      if (answer.ok && answer.persisted) announce("stop", answer);
    } catch {
      /* network / server error */
    }
  }

  /** Immediate abort — interrupts the in-flight LLM call (vs stop()'s graceful
   * halt at the next phase boundary). */
  async function terminate() {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/terminate`, {
        method: "POST",
      });
    } catch {
      /* network / server error */
    }
  }

  /** Relaunch a new run from this run's stored config snapshot. Returns the new
   * run id (or null on failure — e.g. no snapshot / server error). */
  async function rerun(): Promise<string | null> {
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/rerun`, {
        method: "POST",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { runId?: string };
      return body.runId ?? null;
    } catch {
      return null;
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

  // ── Durable HITL (Phase E) ── approve/deny a run paused on an approval gate.
  async function approve(reason?: string) {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      state.update((s) => (isRunSettled(s.status) ? s : { ...s, status: "live" }));
    } catch {
      /* network / server error */
    }
  }

  async function deny(reason: string) {
    try {
      await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    } catch {
      /* network / server error */
    }
  }

  return {
    subscribe: state.subscribe,
    pause,
    resume,
    stop,
    terminate,
    rerun,
    approve,
    deny,
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
