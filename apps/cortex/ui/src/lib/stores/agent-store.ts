/**
 * Cortex **desk** store: multiple agents, live WebSocket events, REST run history.
 *
 * For single-run HTTP/stream UX, use `createAgent` / `createAgentStream` (or `createCortexAgentRun` /
 * `createCortexAgentStreamRun`) from `./framework.js` — those come from `@reactive-agents/svelte`.
 */
import { writable, derived } from "svelte/store";
import { CORTEX_SERVER_URL } from "../constants.js";
import { buildRunHierarchy } from "../run-hierarchy.js";
import { runStatusAfter } from "../run-live-status.js";
import { isIdLike, taskHeadline } from "../run-view.js";
import { effectiveBound, planBudgetEffective } from "../plan-budget.js";
import { formatCost, turnOutcomeOf } from "@reactive-agents/ui-core";

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
  /** The plan-raised iteration bound, once announced (`plan_budget_raised`). */
  readonly planBudgetMax?: number;
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
  /**
   * The spawner's RunContext run id, from `AgentStarted.parentRunId`. A RunContext id is
   * NOT a store key (`runId` is the engine task id); resolve it with `buildRunHierarchy`.
   */
  readonly parentRunId?: string;
  /** This run's own RunContext id (`AgentStarted.runId` / `RunSummary.contextRunId`); absent on legacy rows. */
  readonly contextRunId?: string;
  /** Root of this delegation tree (`AgentStarted.rootRunId`; equals the root's own `runId`). */
  readonly rootRunId?: string;
  /** Delegation depth from `AgentStarted.depth` (0 root, 1 direct child). */
  readonly depth?: number;
  /** Chat session this run is the root of, when it was started from Cortex chat. */
  readonly chatSessionId?: string;
  /** Current action label — set on ToolCallStarted, cleared on completion/new-iter. */
  readonly currentStepLabel?: string;
  /** The tool being called now (`ToolCallStarted`), cleared like `currentStepLabel`. */
  readonly currentTool?: string;
  /** Tool calls started in this run (live socket only). */
  readonly toolCalls?: number;
  /**
   * The run summary status (`live`, `completed`, `failed`, `stopped`): REST, then
   * the live socket through `runStatusAfter`. Beacon paints it with ui-core
   * `statusOfRun`, so a stopped run reads Stopped, not settled.
   */
  readonly runStatus?: string;
  /**
   * How the run ended (REST `ending`, else the live `AgentCompleted` through ui-core
   * `turnOutcomeOf`): an `abstained` or `partial` run is `failed` by status but
   * reads Abstained / Partial on Beacon (`runRowStatus`).
   */
  readonly runEnding?: string;
  /** Run start (ms epoch): REST `startedAt`, else the first live event. */
  readonly startedAt?: number;
  /** The task the run was given: `AgentStarted.task`, else the desk launch prompt. */
  readonly task?: string;
  /** Why the run failed or stopped (REST `errorMessage`). */
  readonly errorMessage?: string;
  /** The chat session's name, when a chat started the run. */
  readonly chatSessionName?: string;
  /** Started from the Cortex desk (Lab or Beacon), so it has a launch snapshot. */
  readonly launched?: boolean;
  /** Entropy per scored step (`EntropyScored.composite`), oldest first, capped. */
  readonly entropyHistory?: readonly number[];
}

/** How many entropy samples a node keeps (the Beacon card line is 96px wide). */
export const ENTROPY_HISTORY_CAP = 48;

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
  /** Delegation context persisted from AgentStarted; lets reload rebuild the hierarchy. */
  readonly parentRunId?: string;
  readonly contextRunId?: string;
  readonly rootRunId?: string;
  readonly depth?: number;
  readonly startedAt?: number;
  readonly errorMessage?: string;
  /** How the run ended (server `cortex_runs.ending`). */
  readonly ending?: string;
  readonly chatSessionId?: string;
  readonly chatSessionName?: string;
  /** Desk launch snapshot; its `prompt` is the run's task. */
  readonly launchParams?: Readonly<Record<string, unknown>>;
}

/**
 * Card / Beacon label: the run's own label (never a bare ULID or the agent id),
 * else the saved agent, else the chat it came from, else the first line of its
 * task, else provider·model, else a short “Run …”.
 */
export function beaconDeskRunLabel(input: {
  displayName?: string;
  /** Linked saved agent name — used when run display label is unset. */
  savedAgentName?: string;
  /** Chat session name, when a chat started the run. */
  chatSessionName?: string;
  /** The run's task. */
  task?: string;
  agentId: string;
  runId: string;
  provider?: string;
  model?: string;
}): string {
  const dn = input.displayName?.trim();
  if (dn && !isIdLike(dn) && dn !== input.agentId) return dn;
  const sn = input.savedAgentName?.trim();
  if (sn) return sn;
  const chat = input.chatSessionName?.trim();
  if (chat) return chat;
  const task = input.task ? taskHeadline(input.task) : "";
  if (task) return task;
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
  if (agent.parentRunId) lines.push(`Sub-agent at depth ${agent.depth ?? "?"} of ${agent.rootRunId ?? "unknown root"}`);
  if (agent.chatSessionId) lines.push(`Started from chat ${agent.chatSessionId}`);
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
  if (agent.cost > 0) lines.push(`Cost (USD): ${formatCost(agent.cost)}`);
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

/** Cognitive state of a run that ended: completed, error, or idle once stopped. */
function settledState(runStatus: string): AgentCognitiveState {
  return runStatus === "failed" ? "error" : runStatus === "stopped" || runStatus === "blocked" ? "idle" : "completed";
}

const isTerminalRunStatus = (s: string | undefined): boolean =>
  s === "completed" || s === "failed" || s === "stopped" || s === "blocked";

function launchTaskOf(launchParams: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const prompt = launchParams?.prompt;
  return typeof prompt === "string" && prompt.trim() ? prompt.trim() : undefined;
}

function runToSeedNode(run: RunSummaryDto, now: number): AgentNode {
  const state: AgentCognitiveState = run.status === "live" ? "running" : settledState(run.status);
  const displayName = run.displayName?.trim() || undefined;
  const savedAgentName = run.agentRecordName?.trim() || undefined;
  const chatSessionName = run.chatSessionName?.trim() || undefined;
  const task = launchTaskOf(run.launchParams);
  const terminal = run.status !== "live";
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
      chatSessionName,
      task,
      agentId: run.agentId,
      runId: run.runId,
      provider: run.provider,
      model: run.model,
    }),
    runStatus: run.status,
    ...(run.ending ? { runEnding: run.ending } : {}),
    ...(run.startedAt != null ? { startedAt: run.startedAt } : {}),
    ...(task ? { task } : {}),
    ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    ...(chatSessionName ? { chatSessionName } : {}),
    ...(run.launchParams ? { launched: true } : {}),
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
    parentRunId: run.parentRunId,
    contextRunId: run.contextRunId,
    rootRunId: run.rootRunId,
    depth: run.depth,
  };
}

/** One stored run event (`GET /api/runs/:runId/events`); `payload` is JSON text or an object. */
export interface StoredRunEvent {
  readonly type: string;
  readonly payload: unknown;
}

/** The live fields a stored event history gives a node that joined mid-run. */
export interface ReplayedLiveFields {
  readonly entropyHistory: readonly number[];
  readonly loopIteration: number;
  readonly maxIterations: number;
  readonly toolCalls: number;
  readonly currentTool?: string;
  readonly task?: string;
}

function payloadOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const v: unknown = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/**
 * Fold a run's stored events into the fields the live socket would have built
 * (entropy per step, loop and cap, tool calls, the open tool, the task), for a
 * run that was already live when the page loaded. Pure.
 */
export function liveFieldsFromEvents(events: readonly StoredRunEvent[]): ReplayedLiveFields {
  const entropy: number[] = [];
  let loop = 0;
  let max = 0;
  let raisedMax: number | undefined;
  let calls = 0;
  let tool: string | undefined;
  let task: string | undefined;
  for (const e of events) {
    const p = payloadOf(e.payload);
    switch (e.type) {
      case "AgentStarted":
        if (!task && typeof p.task === "string" && p.task.trim()) task = p.task.trim();
        break;
      case "EntropyScored":
        if (typeof p.composite === "number") entropy.push(p.composite);
        break;
      case "ReasoningIterationProgress":
        if (typeof p.iteration === "number") loop = Math.max(loop, p.iteration);
        if (typeof p.maxIterations === "number") max = effectiveBound(p.maxIterations, raisedMax);
        tool = undefined;
        break;
      case "GuardFiredEmitted": {
        const raised = planBudgetEffective(e.type, p);
        if (raised !== undefined) {
          raisedMax = raised;
          max = effectiveBound(max, raised);
        }
        break;
      }
      case "ToolCallStarted":
        calls++;
        tool = typeof p.toolName === "string" ? p.toolName : "tool";
        break;
      case "ToolCallCompleted":
        tool = undefined;
        break;
    }
  }
  return {
    entropyHistory: entropy.slice(-ENTROPY_HISTORY_CAP),
    loopIteration: loop,
    maxIterations: max,
    toolCalls: calls,
    ...(tool ? { currentTool: tool } : {}),
    ...(task ? { task } : {}),
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
                  // The socket can end a run before the DB row says so: a REST row
                  // that still reads live must not revive it.
                  const socketEnded =
                    !isTerminalRunStatus(seeded.runStatus) && isTerminalRunStatus(existing.runStatus);
                  const task = existing.task ?? seeded.task;
                  const chatSessionName = seeded.chatSessionName ?? existing.chatSessionName;
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
                    state: socketEnded
                      ? existing.state
                      : isTerminalRunStatus(seeded.runStatus)
                        ? seeded.state
                        : isLiveCognitiveState(existing.state)
                          ? existing.state
                          : seeded.state,
                    runStatus: socketEnded ? existing.runStatus : seeded.runStatus,
                    ...((socketEnded ? existing.runEnding : seeded.runEnding ?? existing.runEnding)
                      ? { runEnding: socketEnded ? existing.runEnding : seeded.runEnding ?? existing.runEnding }
                      : {}),
                    ...(task ? { task } : {}),
                    ...(chatSessionName ? { chatSessionName } : {}),
                    ...(seeded.startedAt === undefined && existing.startedAt !== undefined
                      ? { startedAt: existing.startedAt }
                      : {}),
                    ...(existing.entropyHistory ? { entropyHistory: existing.entropyHistory } : {}),
                    ...(existing.currentTool && !isTerminalRunStatus(seeded.runStatus) && !socketEnded
                      ? { currentTool: existing.currentTool, currentStepLabel: existing.currentStepLabel }
                      : {}),
                    ...(existing.toolCalls !== undefined ? { toolCalls: existing.toolCalls } : {}),
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
                    completedAt: seeded.completedAt ?? (socketEnded ? existing.completedAt : undefined),
                    // Use || not ?? so that empty strings from DB also fall back to
                    // the live WS value (which has the real value).
                    provider: prov,
                    model:    mod,
                    strategy: seeded.strategy || existing.strategy,
                    // Hierarchy: live AgentStarted wins; REST rows (persisted) fill the gap after reload.
                    parentRunId: existing.parentRunId ?? seeded.parentRunId,
                    contextRunId: existing.contextRunId ?? seeded.contextRunId,
                    rootRunId: existing.rootRunId ?? seeded.rootRunId,
                    depth: existing.depth ?? seeded.depth,
                    chatSessionId: existing.chatSessionId ?? seeded.chatSessionId,
                    displayName: resolvedDisplayName,
                    savedAgentName: resolvedSavedAgentName,
                    name: beaconDeskRunLabel({
                      displayName: resolvedDisplayName,
                      savedAgentName: resolvedSavedAgentName,
                      chatSessionName,
                      task,
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
    /** Set on events of a run that is the root of a Cortex chat session. */
    sessionId?: string;
    payload: Record<string, unknown>;
  }) {
    state.update((s) => {
      const map = new Map(s.agents);
      const existing = map.get(msg.runId);
      type MutablePatch = { -readonly [K in keyof AgentNode]?: AgentNode[K] };
      const patch: MutablePatch = {};
      /** The run already ended (socket or REST): late events must not revive it. */
      const ended =
        isTerminalRunStatus(existing?.runStatus) ||
        existing?.state === "completed" ||
        existing?.state === "error";

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
          // Delegation context. `parentAgentId` is an AGENT id and is deliberately not
          // read here: edges are keyed by run id (see run-hierarchy.ts).
          if (typeof msg.payload.parentRunId === "string" && msg.payload.parentRunId)
            patch.parentRunId = msg.payload.parentRunId;
          if (typeof msg.payload.runId === "string" && msg.payload.runId)
            patch.contextRunId = msg.payload.runId;
          if (typeof msg.payload.rootRunId === "string" && msg.payload.rootRunId)
            patch.rootRunId = msg.payload.rootRunId;
          if (typeof msg.payload.depth === "number" && Number.isFinite(msg.payload.depth))
            patch.depth = msg.payload.depth;
          if (typeof msg.payload.task === "string" && msg.payload.task.trim())
            patch.task = msg.payload.task.trim();
          break;
        case "EntropyScored": {
          const entropy = typeof msg.payload.composite === "number" ? msg.payload.composite : 0;
          patch.entropy = entropy;
          patch.entropyHistory = [...(existing?.entropyHistory ?? []), entropy].slice(-ENTROPY_HISTORY_CAP);
          if (!ended) patch.state = entropyToState(entropy, true);
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
        case "ToolCallStarted": {
          const toolName = typeof msg.payload.toolName === "string" ? msg.payload.toolName : "tool";
          patch.currentStepLabel = `Calling ${toolName}…`;
          patch.currentTool = toolName;
          patch.toolCalls = (existing?.toolCalls ?? 0) + 1;
          break;
        }
        case "ToolCallCompleted":
          patch.currentStepLabel = undefined;
          patch.currentTool = undefined;
          break;
        case "GuardFiredEmitted": {
          const raised = planBudgetEffective(msg.type, msg.payload);
          if (raised !== undefined) {
            patch.planBudgetMax = raised;
            patch.maxIterations = effectiveBound(existing?.maxIterations, raised);
          }
          break;
        }
        case "ReasoningIterationProgress": {
          const iter = typeof (msg.payload as { iteration?: number }).iteration === "number"
            ? (msg.payload as { iteration: number }).iteration
            : existing?.loopIteration ?? 0;
          const max = typeof (msg.payload as { maxIterations?: number }).maxIterations === "number"
            ? effectiveBound((msg.payload as { maxIterations: number }).maxIterations, existing?.planBudgetMax)
            : existing?.maxIterations ?? 0;
          patch.loopIteration = Math.max(existing?.loopIteration ?? 0, Math.max(0, iter));
          patch.maxIterations = max;
          patch.currentStepLabel = undefined;
          patch.currentTool = undefined;
          if (!ended) {
            patch.state = entropyToState(existing?.entropy ?? 0, true);
          }
          break;
        }
        case "FinalAnswerProduced":
          // Keep Stage card responsive near completion.
          if (!ended) patch.state = "running";
          break;
        case "AgentCompleted":
          if (typeof msg.payload.totalTokens === "number") {
            patch.tokensUsed = Math.max(existing?.tokensUsed ?? 0, msg.payload.totalTokens);
          }
          // Same classifier the server stores on `cortex_runs.ending`.
          patch.runEnding = turnOutcomeOf(msg.payload).ending;
          break;
      }

      // Summary status: live until an ending event; the ending rules are the
      // server's (`runStatusAfter`: a stopped run that then fails stays stopped).
      const prevRunStatus = existing?.runStatus ?? "live";
      const endedAs = runStatusAfter(prevRunStatus, msg.type, msg.payload);
      if (endedAs !== undefined) {
        patch.runStatus = endedAs;
        patch.state = settledState(endedAs);
        patch.completedAt = ended ? existing?.completedAt ?? nowFn() : nowFn();
        patch.currentStepLabel = undefined;
        patch.currentTool = undefined;
      } else if (existing?.runStatus === undefined) {
        patch.runStatus = ended ? (existing?.state === "error" ? "failed" : "completed") : "live";
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
        chatSessionName: existing?.chatSessionName,
        task: patch.task ?? existing?.task,
        agentId: msg.agentId,
        runId: msg.runId,
        provider: mergedProvider,
        model: mergedModel,
      });

      const mergedState = (patch.state !== undefined
        ? patch.state
        : (existing?.state ?? "running")) as AgentCognitiveState;
      const prevTerminal = ended;
      const nextTerminal =
        mergedState === "completed" ||
        mergedState === "error" ||
        isTerminalRunStatus(patch.runStatus ?? existing?.runStatus);
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
        parentRunId: existing?.parentRunId,
        contextRunId: existing?.contextRunId,
        rootRunId: existing?.rootRunId,
        depth: existing?.depth,
        chatSessionId: msg.sessionId ?? existing?.chatSessionId,
        currentStepLabel: existing?.currentStepLabel,
        currentTool: existing?.currentTool,
        toolCalls: existing?.toolCalls,
        runStatus: existing?.runStatus,
        runEnding: existing?.runEnding,
        startedAt: existing?.startedAt ?? (existing && existing.connectedAt > 0 ? existing.connectedAt : nowFn()),
        task: existing?.task,
        errorMessage: existing?.errorMessage,
        chatSessionName: existing?.chatSessionName,
        launched: existing?.launched,
        entropyHistory: existing?.entropyHistory,
        ...patch,
        lastEventAt: nextLastEventAt,
        completedAt: patch["completedAt"] ?? existing?.completedAt,
      };

      map.set(msg.runId, updated);
      return { ...s, agents: map };
    });
  }

  /** Runs already hydrated (or being hydrated) from their stored events. */
  const hydrated = new Set<string>();

  /**
   * Fill a live run's socket-only fields (entropy line, loop cap, tool calls)
   * from its stored events, once per run: a page that loads mid-run otherwise
   * shows a blank live card until the next event. The merge is idempotent
   * (longest history, max counters), so an event that arrives both live and
   * in the history is never counted twice.
   */
  async function hydrateLive(runId: string): Promise<void> {
    if (hydrated.has(runId)) return;
    hydrated.add(runId);
    let events: StoredRunEvent[];
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`, { cache: "no-store" });
      if (!res.ok) return;
      events = (await res.json()) as StoredRunEvent[];
    } catch {
      return;
    }
    const replay = liveFieldsFromEvents(events);
    state.update((s) => {
      const node = s.agents.get(runId);
      if (!node) return s;
      const history = node.entropyHistory ?? [];
      const next: AgentNode = {
        ...node,
        ...(replay.entropyHistory.length > history.length
          ? {
              entropyHistory: replay.entropyHistory,
              entropy: replay.entropyHistory[replay.entropyHistory.length - 1] ?? node.entropy,
            }
          : {}),
        loopIteration: Math.max(node.loopIteration, replay.loopIteration),
        maxIterations: node.maxIterations || replay.maxIterations,
        toolCalls: Math.max(node.toolCalls ?? 0, replay.toolCalls),
        ...(node.currentTool === undefined && replay.currentTool && isLiveCognitiveState(node.state)
          ? { currentTool: replay.currentTool, currentStepLabel: `Calling ${replay.currentTool}…` }
          : {}),
        ...(node.task === undefined && replay.task ? { task: replay.task } : {}),
      };
      const map = new Map(s.agents);
      map.set(runId, next);
      return { ...s, agents: map };
    });
  }

  if (loadOnInit) void loadAgents();

  return {
    subscribe: agents.subscribe,
    /** Delegation forest of the desk's runs, edges keyed by run id. */
    hierarchy: derived(agents, ($a) => buildRunHierarchy($a)),
    state,
    handleLiveMessage,
    hydrateLive,
    refresh: loadAgents,
    /** No-op placeholder for layout teardown symmetry; unsubscribe WS in `onMount` cleanup. */
    destroy: () => {},
  };
}

export type AgentStore = ReturnType<typeof createAgentStore>;
