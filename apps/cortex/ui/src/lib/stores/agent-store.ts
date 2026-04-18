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
  /** Explicit human label from API / WS (not composed with provider·model). */
  readonly displayName?: string;
  /** Linked `cortex_agents.name` from REST when present (stable association label). */
  readonly savedAgentName?: string;
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
  /** Parent run ID for sub-agent hierarchy — populated from AgentStarted event context */
  readonly parentRunId?: string;
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
  /** Saved label at launch or resolved linked agent name — from server. */
  readonly displayName?: string;
  /** Linked saved agent profile name (`cortex_agents.name`) when present. */
  readonly agentRecordName?: string;
  readonly status: string;
  readonly iterationCount: number;
  readonly tokensUsed: number;
  readonly cost: number;
  readonly provider?: string;
  readonly model?: string;
  readonly strategy?: string;
  readonly completedAt?: number;
}

/** Card / Beacon label: human name, else provider·model, else short “Run …”. */
export function beaconDeskRunLabel(input: {
  displayName?: string;
  /** Linked saved agent name — used when run display label is unset. */
  savedAgentName?: string;
  agentId: string;
  runId: string;
  provider?: string;
  model?: string;
}): string {
  const dn = input.displayName?.trim();
  if (dn) return dn;
  const sn = input.savedAgentName?.trim();
  if (sn) return sn;
  const p = input.provider?.trim();
  const m = input.model?.trim();
  if (p && m) return `${p} · ${m}`;
  if (p) return p;
  if (m) return m;
  const rid = input.runId;
  if (rid.length <= 14) return `Run ${rid}`;
  return `Run ${rid.slice(0, 10)}…${rid.slice(-4)}`;
}

/** Multi-line tooltip for Beacon desk cards / canvas (respects Settings → tooltips). */
export function agentRunDeskTooltipText(agent: AgentNode): string {
  const lines: string[] = [];
  const p = agent.provider?.trim();
  const m = agent.model?.trim();
  if (p && m) lines.push(`Model: ${p} · ${m}`);
  else if (p) lines.push(`Provider: ${p}`);
  else if (m) lines.push(`Model: ${m}`);
  if (agent.strategy?.trim()) lines.push(`Strategy: ${agent.strategy.trim()}`);
  if (lines.length > 0) lines.push("");
  lines.push(`Label: ${agent.name}`);
  lines.push(`Run ID: ${agent.runId}`);
  lines.push(`Agent ID: ${agent.agentId}`);
  lines.push(`State: ${agent.state}`);
  if (agent.parentRunId) lines.push(`Parent run: ${agent.parentRunId}`);
  if (agent.savedAgentName?.trim()) {
    const sn = agent.savedAgentName.trim();
    if (sn !== agent.name.trim()) {
      lines.push(`Saved agent: ${sn}`);
    }
  }
  if (agent.maxIterations > 0) {
    lines.push(`Loop: ${agent.loopIteration} / ${agent.maxIterations}`);
    if (agent.reasoningSteps > 0) lines.push(`Reasoning steps: ${agent.reasoningSteps}`);
  }
  if (agent.tokensUsed > 0) lines.push(`Tokens: ${agent.tokensUsed.toLocaleString()}`);
  if (agent.cost > 0) lines.push(`Cost (USD): $${agent.cost.toFixed(4)}`);
  if (agent.entropy > 0) lines.push(`Entropy: ${agent.entropy.toFixed(3)}`);
  if (agent.connectedAt > 0) {
    lines.push(`Connected: ${new Date(agent.connectedAt).toLocaleString()}`);
  }
  if (agent.completedAt != null) {
    lines.push(`Completed: ${new Date(agent.completedAt).toLocaleString()}`);
  }
  if (
    isLiveCognitiveState(agent.state) &&
    agent.lastEventAt > 0 &&
    agent.lastEventAt !== agent.connectedAt
  ) {
    lines.push(`Last event: ${new Date(agent.lastEventAt).toLocaleString()}`);
  }
  lines.push("", "Click to open this run.");
  return lines.join("\n");
}

function isLiveCognitiveState(state: AgentCognitiveState): boolean {
  return state === "running" || state === "exploring" || state === "stressed";
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
  const displayName = run.displayName?.trim() || undefined;
  const savedAgentName = run.agentRecordName?.trim() || undefined;
  const terminal = state === "completed" || state === "error";
  const completedAt = terminal && run.completedAt != null ? run.completedAt : undefined;
  const lastEventAtSeed = terminal ? (run.completedAt ?? 0) : now;
  return {
    agentId: run.agentId,
    runId: run.runId,
    displayName,
    savedAgentName,
    name: beaconDeskRunLabel({
      displayName,
      savedAgentName,
      agentId: run.agentId,
      runId: run.runId,
      provider: run.provider,
      model: run.model,
    }),
    state,
    entropy: 0,
    loopIteration: run.iterationCount,
    reasoningSteps: run.iterationCount,
    maxIterations: 0,
    tokensUsed: run.tokensUsed,
    cost: run.cost,
    connectedAt: 0,
    completedAt,
    lastEventAt: lastEventAtSeed,
    provider: run.provider,
    model:    run.model,
    strategy: run.strategy,
    parentRunId: undefined,
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
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs?ts=${nowFn()}`, {
        cache: "no-store",
      });
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
              ? (() => {
                  const resolvedDisplayName = seeded.displayName ?? existing.displayName;
                  const resolvedSavedAgentName = seeded.savedAgentName ?? existing.savedAgentName;
                  const prov = seeded.provider || existing.provider;
                  const mod = seeded.model || existing.model;
                  return {
                    ...seeded,
                    // ── Live-WS fields beat REST/DB during an active run ──────────
                    // Never let a periodic REST refresh degrade data that live WS
                    // events have already set more accurately.
                    //
                    // Preserve richer live cognitive states only while REST still
                    // reports the run as live. Once REST reaches a terminal
                    // state, trust the server snapshot so missed WS completions
                    // do not leave cards stuck as running.
                    state:
                      seeded.state === "completed" || seeded.state === "error"
                        ? seeded.state
                        : isLiveCognitiveState(existing.state)
                          ? existing.state
                          : seeded.state,
                    entropy:      existing.entropy,
                    loopIteration: Math.max(existing.loopIteration, seeded.loopIteration),
                    reasoningSteps: Math.max(existing.reasoningSteps, seeded.reasoningSteps),
                    maxIterations: existing.maxIterations || seeded.maxIterations,
                    tokensUsed:   Math.max(existing.tokensUsed, seeded.tokensUsed),
                    cost:         Math.max(existing.cost, seeded.cost),
                    connectedAt:  existing.connectedAt,
                    // REST poll must not advance lastEventAt (WS is authoritative; avoids
                    // "Last event" in tooltips ticking after a run has settled).
                    lastEventAt: existing.lastEventAt > 0 ? existing.lastEventAt : seeded.lastEventAt,
                    // Use || not ?? so that empty strings from DB also fall back to
                    // the live WS value (which has the real value).
                    provider: prov,
                    model:    mod,
                    strategy: seeded.strategy || existing.strategy,
                    displayName: resolvedDisplayName,
                    savedAgentName: resolvedSavedAgentName,
                    name: beaconDeskRunLabel({
                      displayName: resolvedDisplayName,
                      savedAgentName: resolvedSavedAgentName,
                      agentId: run.agentId,
                      runId: run.runId,
                      provider: prov,
                      model: mod,
                    }),
                  };
                })()
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
      const patch: MutablePatch = {};

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
          // Capture parent context for sub-agent hierarchy
          if (typeof msg.payload.parentAgentId === "string" && msg.payload.parentAgentId)
            patch.parentRunId = msg.payload.parentAgentId as string;
          else if (typeof msg.payload.parentRunId === "string" && msg.payload.parentRunId)
            patch.parentRunId = msg.payload.parentRunId as string;
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

      const wsDisplayName =
        typeof msg.payload.agentDisplayName === "string" && msg.payload.agentDisplayName.trim()
          ? (msg.payload.agentDisplayName as string).trim()
          : undefined;
      const mergedProvider =
        (typeof msg.payload.provider === "string" ? msg.payload.provider : undefined) ??
        existing?.provider;
      const mergedModel =
        (typeof msg.payload.model === "string" ? msg.payload.model : undefined) ?? existing?.model;

      const resolvedDisplayName = wsDisplayName ?? existing?.displayName;
      const resolvedSavedAgentName = existing?.savedAgentName;
      const resolvedName = beaconDeskRunLabel({
        displayName: resolvedDisplayName,
        savedAgentName: resolvedSavedAgentName,
        agentId: msg.agentId,
        runId: msg.runId,
        provider: mergedProvider,
        model: mergedModel,
      });

      const mergedState = (patch.state !== undefined
        ? patch.state
        : (existing?.state ?? "running")) as AgentCognitiveState;
      const prevTerminal =
        existing?.state === "completed" || existing?.state === "error";
      const nextTerminal =
        mergedState === "completed" || mergedState === "error";
      let nextLastEventAt: number;
      if (!nextTerminal) {
        nextLastEventAt = nowFn();
      } else if (!prevTerminal && nextTerminal) {
        nextLastEventAt = nowFn();
      } else {
        nextLastEventAt = existing?.lastEventAt ?? nowFn();
      }

      const updated: AgentNode = {
        agentId: msg.agentId,
        runId: msg.runId,
        displayName: resolvedDisplayName,
        savedAgentName: resolvedSavedAgentName,
        name: resolvedName,
        state: existing?.state ?? "running",
        entropy: existing?.entropy ?? 0,
        loopIteration: existing?.loopIteration ?? 0,
        reasoningSteps: existing?.reasoningSteps ?? 0,
        maxIterations: existing?.maxIterations ?? 0,
        tokensUsed: existing?.tokensUsed ?? 0,
        cost: existing?.cost ?? 0,
        connectedAt: existing?.connectedAt ?? nowFn(),
        completedAt: existing?.completedAt,
        lastEventAt: existing?.lastEventAt ?? 0,
        parentRunId: existing?.parentRunId,
        ...patch,
        lastEventAt: nextLastEventAt,
        completedAt: patch.completedAt ?? existing?.completedAt,
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
