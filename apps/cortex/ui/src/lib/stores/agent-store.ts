/**
 * Cortex **desk** store: multiple agents, live WebSocket events, REST run history.
 *
 * For single-run HTTP/stream UX, use `createAgent` / `createAgentStream` (or `createCortexAgentRun` /
 * `createCortexAgentStreamRun`) from `./framework.js` — those come from `@reactive-agents/svelte`.
 */
import { writable, derived } from "svelte/store";
import { CORTEX_SERVER_URL } from "../constants.js";

export type AgentCognitiveState =
  | "idle"
  | "running"
  | "exploring"
  | "stressed"
  | "completed"
  | "error";

export interface AgentNode {
  readonly agentId: string;
  readonly runId: string;
  readonly name: string;
  readonly state: AgentCognitiveState;
  readonly entropy: number;
  /** Outer kernel loop — `ReasoningIterationProgress` */
  readonly loopIteration: number;
  /** Reasoning steps — `ReasoningStepCompleted` (can exceed loop) */
  readonly reasoningSteps: number;
  readonly maxIterations: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly connectedAt: number;
  readonly completedAt?: number;
  readonly lastEventAt: number;
  /** Provider name — persisted from DB, survives refresh */
  readonly provider?: string;
  /** Model name — persisted from DB, survives refresh */
  readonly model?: string;
  /** Reasoning strategy — persisted from DB, survives refresh */
  readonly strategy?: string;
}

export interface AgentStoreState {
  /** Keyed by runId (stable per execution). */
  readonly agents: Map<string, AgentNode>;
  readonly loading: boolean;
}

/** Matches `RunSummary` from Cortex server `/api/runs`. */
export interface RunSummaryDto {
  readonly runId: string;
  readonly agentId: string;
  readonly status: string;
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: string;
}

export function entropyToState(entropy: number, isRunning: boolean): AgentCognitiveState {
  if (!isRunning) return "idle";
  if (entropy < 0.5) return "running";
  if (entropy < 0.75) return "exploring";
  return "stressed";
}

function runToSeedNode(run: RunSummaryDto, now: number): AgentNode {
  const state: AgentCognitiveState =
    run.status === "live" ? "running" : run.status === "failed" ? "error" : "completed";
  return {
    agentId: run.agentId,
    runId: run.runId,
    name: run.agentId,
    state,
    entropy: 0,
    loopIteration: run.iterationCount,
    reasoningSteps: run.iterationCount,
    maxIterations: 0,
    tokensUsed: run.tokensUsed,
    cost: run.cost,
    connectedAt: 0,
    lastEventAt: now,
    provider: run.provider,
    model:    run.model,
    strategy: run.strategy,
  };
}

export interface CreateAgentStoreOptions {
  readonly loadOnInit?: boolean;
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly now?: () => number;
}

export function createAgentStore(options?: CreateAgentStoreOptions) {
  const loadOnInit = options?.loadOnInit !== false;
  const fetchFn = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const nowFn = options?.now ?? (() => Date.now());

  const state = writable<AgentStoreState>({ agents: new Map(), loading: false });

  const agents = derived(state, ($s) => Array.from($s.agents.values()));

  async function loadAgents() {
    state.update((s) => ({ ...s, loading: true }));
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`);
      if (!res.ok) throw new Error(String(res.status));
      const runs = (await res.json()) as RunSummaryDto[];
      const trimmed = runs.slice(0, 20);
      const t = nowFn();

      state.update((s) => {
        // Reconcile from server snapshot so deletes/stale runs disappear without hard refresh.
        const prev = s.agents;
        const next = new Map<string, AgentNode>();
        for (const run of trimmed) {
          const seeded = runToSeedNode(run, t);
          const existing = prev.get(run.runId);
          next.set(
            run.runId,
            existing
              ? {
                  ...seeded,
                  // ── Live-WS fields beat REST/DB during an active run ──────────
                  // Never let a periodic REST refresh degrade data that live WS
                  // events have already set more accurately.
                  //
                  // State: if existing is a live cognitive state, keep it.
                  // REST may return "live"→"running" (less precise) or even lag behind.
                  state: (
                    existing.state === "running" ||
                    existing.state === "exploring" ||
                    existing.state === "stressed"
                  ) ? existing.state : seeded.state,
                  entropy:      existing.entropy,
                  loopIteration: Math.max(existing.loopIteration, seeded.loopIteration),
                  reasoningSteps: Math.max(existing.reasoningSteps, seeded.reasoningSteps),
                  maxIterations: existing.maxIterations || seeded.maxIterations,
                  tokensUsed:   Math.max(existing.tokensUsed, seeded.tokensUsed),
                  cost:         Math.max(existing.cost, seeded.cost),
                  connectedAt:  existing.connectedAt,
                  lastEventAt:  Math.max(existing.lastEventAt, seeded.lastEventAt),
                  // Use || not ?? so that empty strings from DB also fall back to
                  // the live WS value (which has the real value).
                  provider: seeded.provider || existing.provider,
                  model:    seeded.model    || existing.model,
                  strategy: seeded.strategy || existing.strategy,
                }
              : seeded,
          );
        }
        return { agents: next, loading: false };
      });
    } catch {
      state.update((s) => ({ ...s, loading: false }));
    }
  }

  function handleLiveMessage(msg: {
    agentId: string;
    runId: string;
    type: string;
    payload: Record<string, unknown>;
  }) {
    state.update((s) => {
      const map = new Map(s.agents);
      const existing = map.get(msg.runId);
      type MutablePatch = { -readonly [K in keyof AgentNode]?: AgentNode[K] };
      const patch: MutablePatch = { lastEventAt: nowFn() };

      switch (msg.type) {
        case "AgentConnected":
          patch.state = "running";
          patch.connectedAt = nowFn();
          break;
        // AgentStarted fires first — capture config immediately for live runs
        case "AgentStarted":
          if (typeof msg.payload.provider === "string" && msg.payload.provider)
            patch.provider = msg.payload.provider as string;
          if (typeof msg.payload.model === "string" && msg.payload.model)
            patch.model = msg.payload.model as string;
          break;
        case "EntropyScored": {
          const entropy = typeof msg.payload.composite === "number" ? msg.payload.composite : 0;
          const isRunning = existing?.state !== "completed" && existing?.state !== "error";
          patch.entropy = entropy;
          patch.state = entropyToState(entropy, Boolean(isRunning));
          break;
        }
        case "LLMRequestCompleted": {
          const tokens =
            typeof msg.payload.tokensUsed === "number"
              ? msg.payload.tokensUsed
              : typeof (msg.payload.tokensUsed as { total?: number } | undefined)?.total === "number"
                ? (msg.payload.tokensUsed as { total: number }).total
                : 0;
          const est =
            typeof msg.payload.estimatedCost === "number" ? msg.payload.estimatedCost : 0;
          patch.tokensUsed = (existing?.tokensUsed ?? 0) + tokens;
          patch.cost = (existing?.cost ?? 0) + est;
          break;
        }
        case "ReasoningStepCompleted": {
          const p = msg.payload as { totalSteps?: number; step?: number };
          const steps =
            typeof p.totalSteps === "number"
              ? p.totalSteps
              : typeof p.step === "number"
                ? p.step
                : (existing?.reasoningSteps ?? 0);
          patch.reasoningSteps = Math.max(existing?.reasoningSteps ?? 0, Math.max(0, steps));
          break;
        }
        case "ReasoningIterationProgress": {
          const iter = typeof (msg.payload as { iteration?: number }).iteration === "number"
            ? (msg.payload as { iteration: number }).iteration
            : existing?.loopIteration ?? 0;
          const max = typeof (msg.payload as { maxIterations?: number }).maxIterations === "number"
            ? (msg.payload as { maxIterations: number }).maxIterations
            : existing?.maxIterations ?? 0;
          patch.loopIteration = Math.max(existing?.loopIteration ?? 0, Math.max(0, iter));
          patch.maxIterations = max;
          if (existing?.state !== "completed" && existing?.state !== "error") {
            patch.state = entropyToState(existing?.entropy ?? 0, true);
          }
          break;
        }
        case "FinalAnswerProduced":
          // Keep Stage card responsive near completion.
          patch.state = "running";
          break;
        case "AgentCompleted":
          patch.state = msg.payload.success === true ? "completed" : "error";
          if (typeof msg.payload.totalTokens === "number") {
            patch.tokensUsed = Math.max(existing?.tokensUsed ?? 0, msg.payload.totalTokens);
          }
          patch.completedAt = nowFn();
          break;
        case "TaskFailed":
          patch.state = "error";
          patch.completedAt = nowFn();
          break;
      }

      const updated: AgentNode = {
        agentId: msg.agentId,
        runId: msg.runId,
        name: existing?.name ?? msg.agentId,
        state: existing?.state ?? "running",
        entropy: existing?.entropy ?? 0,
        loopIteration: existing?.loopIteration ?? 0,
        reasoningSteps: existing?.reasoningSteps ?? 0,
        maxIterations: existing?.maxIterations ?? 0,
        tokensUsed: existing?.tokensUsed ?? 0,
        cost: existing?.cost ?? 0,
        connectedAt: existing?.connectedAt ?? nowFn(),
        lastEventAt: nowFn(),
        ...patch,
      };

      map.set(msg.runId, updated);
      return { ...s, agents: map };
    });
  }

  if (loadOnInit) void loadAgents();

  return {
    subscribe: agents.subscribe,
    state,
    handleLiveMessage,
    refresh: loadAgents,
    /** No-op placeholder for layout teardown symmetry; unsubscribe WS in `onMount` cleanup. */
    destroy: () => {},
  };
}

export type AgentStore = ReturnType<typeof createAgentStore>;
