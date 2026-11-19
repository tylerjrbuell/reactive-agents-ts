import { get, writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import type { CortexAgentToolConfig } from "$lib/types/agent-config.js";
import { carryContext } from "../chat-context.js";
import { failTurn, requestTurnStop, streamAssistantTurn } from "./chat-stream.js";
import { ATTACH_ACTIVE_TURN, chatStreamEndpoint, fetchActiveTurn, resumedTurns, shouldResume } from "./chat-resume.js";
import type { ChatTotals } from "./chat-cost.js";
import { restoreSubAgents, type ChatSubAgent } from "../sub-agent-view.js";
import { turnModelOf } from "../chat-live-config.js";
import type { ChecklistSnapshotWire, PersistedReasoningStep, PersistedSubAgent, StrategyRunHolder } from "@reactive-agents/ui-core";
import type { AttachmentMeta, RecalledMemoryView, RunSkillsView, TurnDeliverable, TurnStructured, TurnUsage } from "@reactive-agents/ui-core";
import { metaOf, requestOf, taggedDraftsOf, type DraftAttachment } from "../composer-attachments.js";
import { keepThumbs } from "./composer-attachments.js";
import { storedRunEnding, type TurnRunEnding } from "../turn-ending.js";
import { todoFromChecklist, type TodoItem } from "../todo-dock.js";
import type { ChatPendingApprovalWire } from "../chat-approvals.js";
import type { LiveApproval } from "../chat-live-approval.js";
import type { LiveInteraction } from "../chat-live-interaction.js";
import type { ChatPendingInteractionWire } from "../chat-interactions.js";

/**
 * Re-exported for backward compat. The real, single-source-of-truth union
 * lives in `@reactive-agents/ui-core` (`UiStreamEvent`) — this file keeps no
 * duplicate copy (GH #163). The SSE → turn reduction itself is `chat-stream.ts`.
 */
export type { UiStreamEvent as AgentStreamEvent } from "@reactive-agents/ui-core";

export type ReasoningStep = {
  iteration: number;
  maxIterations: number;
  toolsCalledThisStep?: readonly string[];
  /** Thinking + narration as one block (older traces carry only this). */
  thought?: string;
  /** The model's visible prose this iteration. */
  narration?: string;
  /** The provider's own reasoning this iteration (thinking models). */
  thinking?: string;
};

/** One tool invocation inside an assistant turn — inspectable (args + result) once it completes. */
export type ChatToolCall = {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
  /** Kernel iteration the call belongs to; orders the call after that iteration's thinking. */
  iteration?: number;
  durationMs?: number;
  args?: unknown;
  /** Tool output text (server-capped). */
  result?: string;
  error?: string;
  resultTruncated?: boolean;
};

/** How full the model's context window was on the turn's most recent LLM call. */
export type ChatContext = {
  tokensUsed: number;
  /**
   * Total window (used + remaining). Absent when the window size is unknown: a
   * compaction estimate on a session with no earlier reading shows tokens only.
   */
  windowTokens?: number;
  utilizationPct?: number;
  level?: "low" | "medium" | "high" | "critical";
  /** True when the numerator is an estimate (output counted, or a text-delta estimate). */
  estimated?: boolean;
};

export interface LiveTokenSplit {
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** True when the input half is derived rather than provider-reported. */
  readonly estimatedIn: boolean;
  /** True when the output half still contains in-flight characters. */
  readonly estimatedOut: boolean;
}

export type ChatTurn = StrategyRunHolder & {
  id: number;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  ts: number;
  toolsUsed?: string[];
  steps?: number;
  streaming?: boolean;
  streamProgress?: { iteration: number; maxIterations: number };
  reasoningSteps?: ReasoningStep[];
  toolCalls?: ChatToolCall[];
  /** Sub-agents this turn spawned (recursive), in start order. Absent when none. */
  subAgents?: ChatSubAgent[];
  /** Latest live checklist (goal checks + agent to-do) for this turn. Absent when none. */
  checklist?: ChecklistSnapshotWire;
  /** Latest non-accept decision of the shared exit gate this turn (same for every strategy). Absent when none. */
  exitGate?: { decision: "repair" | "handoff" | "accept-unfinished"; outstanding: readonly string[]; iteration: number };
  cancelled?: boolean;
  awaitingApproval?: boolean;
  /**
   * The approval this streaming turn's run is waiting on live (no durable runs,
   * `ApprovalRequested`); cleared once the run moves on. See `chat-live-approval.ts`.
   */
  liveApproval?: LiveApproval;
  /**
   * The question this streaming turn's agent asked and waits on live (no durable runs,
   * `InteractionRequested`); cleared once the run moves on. See `chat-live-interaction.ts`.
   */
  liveInteraction?: LiveInteraction;
  /** Latest context-window reading from this turn's run (the prompt last sent to the model). */
  context?: ChatContext;
  /** Provider / model that produced this answer (persisted per turn, so it survives a mid-chat switch). */
  provider?: string;
  model?: string;
  /** Strategy the run reported (`StreamCompleted.metadata.strategyUsed`); absent when it reported none. */
  strategy?: string;
  /** How long the run took, as it reported (`StreamCompleted.metadata.duration`, ms). */
  durationMs?: number;
  /** Epoch ms the run finished: send time + reported duration live, the stored row time once reloaded. */
  finishedAt?: number;
  /**
   * Live answer preview: the current iteration's streaming text. The final
   * iteration's deltas ARE the final answer in the common case, so this is
   * rendered live in the bubble. When a newer iteration starts, the text is
   * folded into that step's thought; StreamCompleted.output replaces it.
   */
  liveText?: string;
  /**
   * Partial structured-output preview (op E): best-effort JSON parse of the
   * accumulated stream text so far, via ui-core's `reduceRunState`
   * (`objectMode: true`). Only set once the parse yields at least one key —
   * plain-text (non-JSON) chat turns never populate this. Persists after
   * streaming completes as the final deliverable preview.
   */
  liveObject?: Record<string, unknown>;
  /** The typed object of a turn run with an output schema, and how it was obtained (ui-core `foldStructured`). */
  structured?: TurnStructured;
  /** Running totals during streaming — undefined when not streaming. */
  liveTokens?: number;
  liveCost?: number;
  /**
   * Live input/output split while streaming: provider-reported halves for calls
   * that already completed plus a deterministic estimate for the in-flight one.
   * Absent once the turn finishes (the final split lives on `tokensIn`/`tokensOut`).
   */
  liveUsage?: LiveTokenSplit;
  /**
   * Live output-speed estimate (tokens/sec) for the model call streaming now:
   * estimated tokens of its streamed text over the time since its first delta
   * (ui-core `liveTokensPerSecond`). Cleared when the call reports (`usage` then
   * carries the measured speed) and when the turn ends.
   */
  liveRate?: number;
  /** Provider-reported input/output split on the final reply, when the provider reported it. */
  tokensIn?: number;
  tokensOut?: number;
  /** Per-LLM-call token usage evidence for this turn, absent until a call reports. */
  usage?: TurnUsage;
  /** Final cost after streaming completes, from StreamCompleted metadata. */
  costUsd?: number;
  /** `false` when `costUsd` is unpriced (shown "—") or a lower bound (shown "≥ $x"). */
  costKnown?: boolean;
  /** Framework run id of this turn (names its JSONL trace); absent for older or untraced turns. */
  runId?: string;
  /**
   * Set when the turn's run did not succeed (failed, partial or abstained):
   * `content` is then empty, a partial draft, or the model's own last text,
   * never an answer. The cause is `error`; `turn-ending.ts` renders it.
   */
  runFailed?: TurnRunEnding;
  /** Declared deliverables from the run's receipt (its answer when `content` is empty). */
  deliverables?: readonly TurnDeliverable[];
  /** Turn was cancelled or errored before completion; its spend is still counted. */
  incomplete?: boolean;
  /**
   * While streaming: epoch ms since which the turn waits on the model (a call is
   * out, no token back yet; ui-core `foldModelWait`). Absent when not waiting.
   */
  awaitingModelSince?: number;
  /** Skills the turn's run had active and why (ui-core `RunSkillsView`, stored by the server). */
  skills?: RunSkillsView;
  /** Memories the turn's run recalled into its context (stored by the server); absent when it reported none. */
  recalled?: readonly RecalledMemoryView[];
  /** What the user attached to this (user) message: names and sizes, never bytes. */
  attachments?: readonly AttachmentMeta[];
};

/** Server-persisted thinking + tool-call detail for a finished assistant turn. */
type PersistedTrace = {
  reasoningSteps?: ReadonlyArray<PersistedReasoningStep>;
  toolCalls?: ReadonlyArray<Omit<ChatToolCall, "status"> & { status: "done" | "failed" }>;
  subAgents?: ReadonlyArray<PersistedSubAgent>;
  checklist?: ChecklistSnapshotWire;
  /** Present only when the turn's run did not succeed (server `StoredTurnOutcome`). */
  outcome?: { success: false } & TurnRunEnding;
  /** Receipt deliverables, when the run listed any. */
  deliverables?: readonly TurnDeliverable[];
  /** Per-call usage evidence persisted by the recorder fold. */
  usage?: TurnUsage;
  /** Strategy the run reported. */
  strategy?: string;
  /** Reported run duration (ms). */
  durationMs?: number;
  /** Skills the run had active and why. */
  skills?: RunSkillsView;
  /** Memories the run recalled (`MemoryRecalled`); [] = it looked and recalled nothing. */
  recalled?: readonly RecalledMemoryView[];
  /** The typed object and how it was obtained, for a turn run with an output schema. */
  structured?: TurnStructured;
  /** Attachments of a user message (names and sizes). */
  attachments?: readonly AttachmentMeta[];
};

/** Rebuild a ChatTurn from a server row, restoring reasoning steps + tool calls so history is inspectable after reload. */
export function hydrateTurn(row: ChatTurn & { trace?: PersistedTrace }): ChatTurn {
  const { trace, ...turn } = row;
  // A stored assistant row is written when its run ends, so its `ts` is the finish time.
  const finished = turn.role === "assistant" && turn.ts > 0 ? { finishedAt: turn.ts } : {};
  if (!trace) return { ...turn, ...finished };
  return {
    ...turn,
    ...finished,
    ...(typeof trace.durationMs === "number" ? { durationMs: trace.durationMs } : {}),
    ...(trace.reasoningSteps && trace.reasoningSteps.length > 0
      ? {
          reasoningSteps: trace.reasoningSteps.map((r) => ({
            iteration: r.iteration,
            maxIterations: 0,
            thought: r.thought,
            ...(r.narration ? { narration: r.narration } : {}),
            ...(r.thinking ? { thinking: r.thinking } : {}),
          })),
        }
      : {}),
    ...(trace.toolCalls && trace.toolCalls.length > 0 ? { toolCalls: trace.toolCalls.map((c) => ({ ...c })) } : {}),
    ...(trace.subAgents && trace.subAgents.length > 0 ? { subAgents: restoreSubAgents(trace.subAgents) } : {}),
    ...(trace.checklist ? { checklist: trace.checklist } : {}),
    ...(trace.outcome?.success === false ? { runFailed: storedRunEnding(trace.outcome) } : {}),
    // A turn the user stopped reads as stopped after a reload, as it did live.
    ...(trace.outcome?.ending === "interrupted" && trace.outcome.interruptedBy === "user" ? { cancelled: true } : {}),
    ...(trace.deliverables && trace.deliverables.length > 0 ? { deliverables: trace.deliverables } : {}),
    ...(trace.usage ? { usage: trace.usage } : {}),
    ...(trace.strategy ? { strategy: trace.strategy } : {}),
    ...(trace.skills && trace.skills.activations.length > 0 ? { skills: trace.skills } : {}),
    ...(trace.recalled ? { recalled: trace.recalled } : {}),
    ...(trace.structured ? { structured: trace.structured } : {}),
    ...(trace.attachments && trace.attachments.length > 0 ? { attachments: trace.attachments } : {}),
  };
}

export type ChatSession = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  /** The chat agent's stable id: its memory database is keyed by it (Context tab, Memory studio). */
  stableAgentId?: string;
  createdAt: number;
  lastUsedAt: number;
  turns?: ChatTurn[];
  /** Server-summed tokens and cost across the persisted turns. */
  totals?: ChatTotals;
  /** The conversation's persisted to-do list (absent on older servers). */
  todo?: TodoItem[];
  /** Document sources that failed to load on the latest agent build. */
  documentFailures?: { source: string; reason: string }[];
  /** Turns paused on a durable approval gate (absent on older servers). */
  pendingApprovals?: ChatPendingApprovalWire[];
  /** Turns paused on `request_user_input`, waiting for a reply (absent on older servers). */
  pendingInteractions?: ChatPendingInteractionWire[];
  /** Session mode, plan or execute (absent on older servers: execute).
   *  Read it through `chatMode` (chat-mode-store.ts). */
  mode?: "plan" | "execute";
};

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeTurns: ChatTurn[];
  /** Persisted totals of the active session; absent until it loads. */
  activeTotals?: ChatTotals;
  /** The active conversation's to-do list (conversation-level, shown by the dock beside the input). */
  activeTodo: TodoItem[];
  /** Sources the session's documents config could not load (`DocumentIngestFailed`). */
  activeDocumentFailures: { source: string; reason: string }[];
  /** The active session's turns paused on an approval gate (rendered as approval cards). */
  activePendingApprovals: ChatPendingApprovalWire[];
  /** The active session's turns paused on a question (rendered as reply cards). */
  activePendingInteractions: ChatPendingInteractionWire[];
  sending: boolean;
  loadingSession: boolean;
  error: string | null;
  streamReasoningSteps: boolean;
  /** Session has an `outputSchema`: only then is the partial-object preview derived while streaming. */
  structuredOutput: boolean;
};

type ChatSessionConfigInput = {
  provider?: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  runId?: string;
  enableTools?: boolean;
  streamReasoningSteps?: boolean;
  autoName?: boolean;
  maxIterations?: number;
  strategy?: string;
  strategySwitching?: boolean;
  runtimeVerification?: boolean;
  verificationStep?: "none" | "reflect";
  contextSynthesis?: "auto" | "template" | "llm" | "none";
  guardrails?: {
    enabled?: boolean;
    injectionThreshold?: number;
    piiThreshold?: number;
    toxicityThreshold?: number;
  };
  persona?: {
    enabled?: boolean;
    role?: string;
    tone?: string;
    traits?: string;
    responseStyle?: string;
  };
  /** Merged onto default shell allowlist when `shell-execute` is allowed. */
  terminalShellAdditionalCommands?: string;
  /** Replaces default shell allowlist when non-empty (advanced). */
  terminalShellAllowedCommands?: string;
  mcpServerIds?: string[];
  agentTools?: CortexAgentToolConfig[];
  dynamicSubAgents?: { enabled: boolean; maxIterations?: number; maxRecursionDepth?: number };
  additionalToolNames?: string;
  terminalTools?: boolean;
  skills?: { paths: string[] };
};

function createChatStore() {
  const { subscribe, update } = writable<ChatState>({
    sessions: [],
    activeSessionId: null,
    activeTurns: [],
    activeTodo: [],
    activeDocumentFailures: [],
    activePendingApprovals: [],
    activePendingInteractions: [],
    sending: false,
    loadingSession: false,
    error: null,
    streamReasoningSteps: false,
    structuredOutput: false,
  });

  async function loadSessions() {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`);
    const sessions = (await res.json()) as ChatSession[];
    update((s) => ({ ...s, sessions }));
    return sessions;
  }

  async function selectSession(sessionId: string) {
    update((s) => ({ ...s, activeSessionId: sessionId, loadingSession: true, error: null }));
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) {
      update((s) => ({ ...s, loadingSession: false, error: "Session not found" }));
      return;
    }
    const session = (await res.json()) as ChatSession & { turns: ChatTurn[] };
    update((s) => ({ ...s, activeTurns: session.turns.map(hydrateTurn), activeTotals: session.totals, activeTodo: session.todo ?? [], activeDocumentFailures: session.documentFailures ?? [], activePendingApprovals: session.pendingApprovals ?? [], activePendingInteractions: session.pendingInteractions ?? [], loadingSession: false, streamReasoningSteps: session.agentConfig?.streamReasoningSteps === true, structuredOutput: session.agentConfig?.outputSchema != null }));
    // A turn still running server-side (the page was reloaded mid-wait) is attached to, not lost.
    void resumeActiveTurn(sessionId);
  }

  async function createSession(opts: { name?: string } & ChatSessionConfigInput): Promise<string> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    // A refused config (e.g. a workspace that does not exist) must surface, not create "undefined".
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to create session");
    }
    const { sessionId } = (await res.json()) as { sessionId: string };
    await loadSessions();
    await selectSession(sessionId);
    return sessionId;
  }

  async function updateSessionConfig(sessionId: string, config: ChatSessionConfigInput): Promise<void> {
    const res = await fetch(
      `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: "Failed to update session config" }))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Failed to update session config");
    }
    await loadSessions();
    await selectSession(sessionId);
  }

  /**
   * Patch the session's agent config in place (slash commands). Unlike
   * `updateSessionConfig` it does NOT reload the transcript, so the chat does not
   * flash its loading state; the server rebuilds the agent for the next turn.
   */
  async function patchSessionConfig(sessionId: string, patch: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to update session config");
    }
    await loadSessions();
  }

  async function deleteSession(sessionId: string) {
    await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    await loadSessions();
    update((s) => ({
      ...s,
      activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      activeTurns: s.activeSessionId === sessionId ? [] : s.activeTurns,
    }));
  }

  async function renameSession(sessionId: string, newName: string): Promise<void> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      throw new Error("Failed to rename session");
    }
    await loadSessions();
  }

  /** Re-read the active session's turns so ids match the DB (needed by rewind / fork) and persisted traces hydrate. */
  async function refreshTurns(sessionId: string, opts: { onlyIfSameLength?: boolean; afterCompaction?: boolean } = {}): Promise<void> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const session = (await res.json()) as ChatSession & { turns: ChatTurn[] };
    update((s) => {
      if (s.activeSessionId !== sessionId) return s;
      // Totals are server-summed, so they are always safe to adopt.
      const pendingApprovals = session.pendingApprovals ?? [];
      const pendingInteractions = session.pendingInteractions ?? [];
      s = { ...s, activeTotals: session.totals, activeTodo: session.todo ?? [], activeDocumentFailures: session.documentFailures ?? [], activePendingApprovals: pendingApprovals, activePendingInteractions: pendingInteractions };
      // After a stream, only adopt server rows when they line up 1:1 with what we rendered —
      // never replace a richer local view with a shorter / different server view. A turn that
      // paused (approval or a question) is the exception: its streamed "paused" text is not a
      // reply, the server holds the turn instead, so the server view wins.
      const paused = pendingApprovals.length + pendingInteractions.length > 0;
      if (opts.onlyIfSameLength && session.turns.length !== s.activeTurns.length && !paused) return s;
      return { ...s, activeTurns: carryContext(s.activeTurns, session.turns.map(hydrateTurn), { afterCompaction: opts.afterCompaction === true }) };
    });
  }

  const refreshInFlight = new Map<string, Promise<void>>();

  /** POST a history utility; throws the server's message on failure. */
  async function utility<T>(sessionId: string, action: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(payload.error ?? `${action} failed`);
    return payload;
  }

  const activeId = (): string | null => get({ subscribe }).activeSessionId;

  /**
   * Listeners told after the transcript of a session was rewound, cleared or compacted.
   * Records tied to the thread (agent proposals) re-read themselves from the server then.
   */
  const historyListeners = new Set<(sessionId: string) => void>();
  const historyChanged = (sessionId: string): void => {
    for (const fn of historyListeners) fn(sessionId);
  };

  /** Rewind to before `turnId`'s exchange; returns the removed user message (to edit or resend). */
  async function rewind(turnId: number): Promise<string> {
    const sid = activeId();
    if (!sid) return "";
    const { userMessage } = await utility<{ userMessage: string }>(sid, "rewind", { turnId });
    historyChanged(sid);
    await refreshTurns(sid);
    return userMessage;
  }

  /** Regenerate the last answer: rewind the last exchange and resend its prompt. */
  async function rerun(): Promise<void> {
    const lastUser = [...get({ subscribe }).activeTurns].reverse().find((t) => t.role === "user");
    if (!lastUser) return;
    const text = await rewind(lastUser.id);
    if (text) await sendMessageStream(text, { attachments: taggedDraftsOf(lastUser) });
  }

  async function clearContext(): Promise<void> {
    const sid = activeId();
    if (!sid) return;
    await utility(sid, "clear");
    historyChanged(sid);
    await refreshTurns(sid);
  }

  /** Summarise older turns into one exchange; returns how many rows were summarised (0 = nothing to compact). */
  async function compact(keepLast?: number): Promise<number> {
    const sid = activeId();
    if (!sid) return 0;
    const { compacted } = await utility<{ compacted: number }>(sid, "compact", keepLast === undefined ? {} : { keepLast });
    historyChanged(sid);
    // The server's reading (the estimate on the summary row) is what the meter shows; no old reading rides along.
    await refreshTurns(sid, { afterCompaction: true });
    return compacted;
  }

  /** Replace a compaction summary with the user's edited text. */
  async function editSummary(turnId: number, content: string): Promise<void> {
    const sid = activeId();
    if (!sid) return;
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}/summary`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId, content }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not save the summary");
    }
    await refreshTurns(sid);
  }

  /** Fork into a new session (history up to `atTurnId`, or all) and switch to it. */
  async function fork(atTurnId?: number): Promise<string> {
    const sid = activeId();
    if (!sid) return "";
    const { sessionId } = await utility<{ sessionId: string }>(sid, "fork", atTurnId !== undefined ? { atTurnId } : {});
    await loadSessions();
    await selectSession(sessionId);
    return sessionId;
  }

  async function sendMessage(message: string): Promise<void> {
    let sessionId: string | null = null;
    update((s) => {
      sessionId = s.activeSessionId;
      return s;
    });
    if (!sessionId) return;

    const optimisticTurn: ChatTurn = {
      id: Date.now(),
      role: "user",
      content: message,
      tokensUsed: 0,
      ts: Date.now(),
    };
    update((s) => ({
      ...s,
      activeTurns: [...s.activeTurns, optimisticTurn],
      sending: true,
      error: null,
    }));

    const res = await fetch(
      `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      },
    );

    if (!res.ok) {
      const body = (await res.json()) as { error: string };
      update((s) => ({
        ...s,
        sending: false,
        error: body.error ?? "Request failed",
        activeTurns: s.activeTurns.filter((t) => t.id !== optimisticTurn.id),
      }));
      return;
    }

    const payload = (await res.json()) as {
      reply: string;
      tokensUsed: number;
      toolsUsed?: string[];
      steps?: number;
      cost?: number;
    };
    const assistantTurn: ChatTurn = {
      id: Date.now() + 1,
      role: "assistant",
      content: payload.reply,
      tokensUsed: payload.tokensUsed,
      ts: Date.now(),
      ...(payload.toolsUsed && payload.toolsUsed.length > 0 ? { toolsUsed: payload.toolsUsed } : {}),
      ...(payload.steps != null ? { steps: payload.steps } : {}),
    };
    update((s) => ({ ...s, activeTurns: [...s.activeTurns, assistantTurn], sending: false }));
  }

  /** `skills`: skill names pinned for this message only (`/skill`); the session config is not changed. */
  async function sendMessageStream(message: string, opts: { readonly posture?: "execute" | "plan"; readonly skills?: readonly string[]; readonly attachments?: readonly DraftAttachment[] } = {}): Promise<void> {
    let sessionId: string | null = null;
    let structuredOutput = false;
    let runModel: { provider?: string; model?: string } = {};
    update((s) => {
      sessionId = s.activeSessionId;
      structuredOutput = s.structuredOutput;
      runModel = turnModelOf(s.sessions.find((x) => x.sessionId === s.activeSessionId)?.agentConfig);
      return s;
    });
    if (!sessionId) return;

    const attached = opts.attachments ?? [];
    keepThumbs(attached);
    const optimisticUserTurn: ChatTurn = {
      id: Date.now(),
      role: "user",
      content: message,
      tokensUsed: 0,
      ts: Date.now(),
      ...(attached.length > 0 ? { attachments: metaOf(attached) } : {}),
    };

    const assistantTurnId = Date.now() + 1;
    const assistantTurn: ChatTurn = {
      id: assistantTurnId,
      role: "assistant",
      content: "",
      tokensUsed: 0,
      ts: Date.now(),
      streaming: true,
      // The request is out and no token is back yet (B11).
      awaitingModelSince: Date.now(),
      // Pinned at send: a config change during the run applies to the NEXT turn, so this header must not follow it.
      ...runModel,
    };

    update((s) => ({
      ...s,
      activeTurns: [...s.activeTurns, optimisticUserTurn, assistantTurn],
      sending: true,
      error: null,
    }));

    await consumeTurnStream(sessionId!, assistantTurnId, structuredOutput, {
      body: {
        message,
        ...(opts.posture !== undefined ? { posture: opts.posture } : {}),
        ...(opts.skills && opts.skills.length > 0 ? { skills: [...opts.skills] } : {}),
        ...(requestOf(attached) ? { attachments: requestOf(attached) } : {}),
      },
    });
  }

  /**
   * Stream one turn into the assistant turn `assistantTurnId` and settle it. With a `body` the turn is
   * sent (POST); without one it attaches to the turn already running on the server (a resumed page).
   * Either way a dropped connection re-attaches from the last event seen: the turn is detached from
   * the connection server-side, so it kept running.
   */
  async function consumeTurnStream(
    sessionId: string,
    assistantTurnId: number,
    structuredOutput: boolean,
    source: { readonly body?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const controller = new AbortController();
      activeController = controller;
      const outcome = await streamAssistantTurn({
        endpoint: chatStreamEndpoint(sessionId),
        ...(source.body !== undefined ? { body: source.body } : {}),
        attach: ATTACH_ACTIVE_TURN,
        signal: controller.signal,
        assistantTurnId,
        structuredOutput,
        apply: (f) => update((s) => ({ ...s, activeTurns: f(s.activeTurns) })),
        onChecklist: (c) => update((s) => (s.activeSessionId === sessionId ? { ...s, activeTodo: todoFromChecklist(c) } : s)),
      });
      activeController = null;

      if (outcome.preStreamFailure !== undefined) {
        if (source.body === undefined) {
          // A resumed turn that cannot be attached to ended while the page was away: its stored
          // exchange is in the history, so drop the placeholder bubbles and read it.
          update((s) => ({ ...s, sending: false, activeTurns: s.activeTurns.filter((t) => t.id !== assistantTurnId && t.id !== assistantTurnId - 1) }));
          await refreshTurns(sessionId);
          return;
        }
        // Nothing streamed: the message stays and the reply ends as a failed turn with the
        // cause and Retry (B1), never an empty bubble or a banner that loses the text.
        const failed = outcome.preStreamFailure;
        update((s) => ({ ...s, sending: false, activeTurns: failTurn(s.activeTurns, assistantTurnId, failed) }));
        return;
      }
      update((s) => ({ ...s, sending: false, ...(outcome.streamError !== undefined ? { error: outcome.streamError } : {}) }));
      // A completed turn is persisted server-side: re-sync so row ids (rewind / fork) and the stored trace line up.
      // Cancelled / errored turns persist nothing, so keep the local partial instead.
      const finished = get({ subscribe }).activeTurns.find((t) => t.id === assistantTurnId)?.cancelled !== true;
      if (outcome.streamError === undefined && finished) await refreshTurns(sessionId, { onlyIfSameLength: true });
      // Auto-naming lands server-side just after the first exchange (instant title, then a model-written one).
      if (outcome.streamError === undefined && get({ subscribe }).activeTurns.length <= 2) {
        for (const delay of [0, 5_000, 12_000]) setTimeout(() => { void loadSessions().catch(() => {}); }, delay);
      }
    } catch (e) {
      const errorMsg = String(e);
      console.error("[Chat Stream] Exception:", errorMsg, e);
      activeController = null;
      update((s) => ({ ...s, sending: false, activeTurns: failTurn(s.activeTurns, assistantTurnId, e) }));
    }
  }

  /**
   * Re-attach to the session's turn if one is still running on the server (the page was reloaded or
   * closed while it ran, e.g. waiting on an approval or a question). The turn's events replay from the
   * start, which brings back its pending card, then follow it live to its end. A no-op when nothing
   * runs or this page is already streaming.
   */
  async function resumeActiveTurn(sessionId: string): Promise<boolean> {
    const info = await fetchActiveTurn(sessionId);
    const snapshot = get({ subscribe });
    if (snapshot.activeSessionId !== sessionId || !shouldResume(info, { sending: snapshot.sending, turns: snapshot.activeTurns })) return false;
    const { user, assistant } = resumedTurns(info, Date.now(), turnModelOf(snapshot.sessions.find((x) => x.sessionId === sessionId)?.agentConfig));
    update((s) => ({ ...s, activeTurns: [...s.activeTurns, user, assistant], sending: true, error: null }));
    void consumeTurnStream(sessionId, assistant.id, snapshot.structuredOutput, {});
    return true;
  }

  /** Replace the conversation's to-do list (user edit); the next turn is seeded from it. Reverts on failure. */
  async function setTodo(items: TodoItem[]): Promise<void> {
    const sid = activeId();
    if (!sid) return;
    const previous = get({ subscribe }).activeTodo;
    update((s) => ({ ...s, activeTodo: items }));
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sid)}/todo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = (await res.json()) as { todo?: TodoItem[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save the to-do list");
      if (body.todo) update((s) => (s.activeSessionId === sid ? { ...s, activeTodo: body.todo! } : s));
    } catch (e) {
      update((s) => (s.activeSessionId === sid ? { ...s, activeTodo: previous, error: e instanceof Error ? e.message : String(e) } : s));
    }
  }

  let activeController: AbortController | null = null;

  /**
   * Stop the running turn. The server is asked first, so it stops the run itself
   * and stores the turn as stopped by the user (a dropped stream alone reads as a
   * disconnect); the stream is then dropped whatever the answer.
   */
  async function stop(): Promise<void> {
    const controller = activeController;
    if (!controller) return;
    activeController = null;
    const sid = activeId();
    if (sid) await requestTurnStop(sid);
    controller.abort();
  }

  return {
    subscribe,
    loadSessions,
    selectSession,
    createSession,
    updateSessionConfig,
    patchSessionConfig,
    editSummary,
    deleteSession,
    renameSession,
    sendMessage,
    sendMessageStream,
    stop,
    rewind,
    rerun,
    clearContext,
    setTodo,
    /** Attach to a turn the server started (goal segment, schedule fire) when one is running and this page is not streaming. */
    resumeActiveTurn,
    /** Re-read the active session's turns (a goal segment or schedule fire added turns server-side). */
    refreshActive: (): Promise<void> => {
      const sid = activeId();
      if (!sid || get({ subscribe }).sending) return Promise.resolve();
      // Coalesce: callers that arrive while a read for this session is in flight share it instead of piling on.
      const running = refreshInFlight.get(sid);
      if (running) return running;
      const p = refreshTurns(sid).finally(() => refreshInFlight.delete(sid));
      refreshInFlight.set(sid, p);
      return p;
    },
    compact,
    fork,
    /** Subscribe to rewind / clear / compact of a session; returns the unsubscribe. */
    onHistoryChange: (fn: (sessionId: string) => void): (() => void) => {
      historyListeners.add(fn);
      return () => void historyListeners.delete(fn);
    },
  };
}

export const chatStore = createChatStore();
