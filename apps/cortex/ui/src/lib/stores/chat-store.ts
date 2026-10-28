import { get, writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import type { CortexAgentToolConfig } from "$lib/types/agent-config.js";
import { streamAssistantTurn } from "./chat-stream.js";

/**
 * Re-exported for backward compat. The real, single-source-of-truth union
 * lives in `@reactive-agents/ui-core` (`UiStreamEvent`) — this file keeps no
 * duplicate copy (GH #163). The SSE → turn reduction itself is `chat-stream.ts`,
 * shared with `RunChatTab.svelte`.
 */
export type { UiStreamEvent as AgentStreamEvent } from "@reactive-agents/ui-core";

export type ReasoningStep = {
  iteration: number;
  maxIterations: number;
  toolsCalledThisStep?: readonly string[];
  thought?: string;
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
  /** Total window (used + remaining). */
  windowTokens: number;
  utilizationPct: number;
  level: "low" | "medium" | "high" | "critical";
};

export type ChatTurn = {
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
  cancelled?: boolean;
  awaitingApproval?: boolean;
  /** Latest context-window reading from this turn's run (the prompt last sent to the model). */
  context?: ChatContext;
  /** Provider / model that produced this answer (persisted per turn, so it survives a mid-chat switch). */
  provider?: string;
  model?: string;
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
  /** Running totals during streaming — undefined when not streaming. */
  liveTokens?: number;
  liveCost?: number;
  /** Final cost after streaming completes, from StreamCompleted metadata. */
  costUsd?: number;
};

/** Server-persisted thinking + tool-call detail for a finished assistant turn. */
type PersistedTrace = {
  reasoningSteps?: ReadonlyArray<{ iteration: number; thought: string }>;
  toolCalls?: ReadonlyArray<Omit<ChatToolCall, "status"> & { status: "done" | "failed" }>;
};

/** Rebuild a ChatTurn from a server row, restoring reasoning steps + tool calls so history is inspectable after reload. */
export function hydrateTurn(row: ChatTurn & { trace?: PersistedTrace }): ChatTurn {
  const { trace, ...turn } = row;
  if (!trace) return turn;
  return {
    ...turn,
    ...(trace.reasoningSteps && trace.reasoningSteps.length > 0
      ? { reasoningSteps: trace.reasoningSteps.map((r) => ({ iteration: r.iteration, maxIterations: 0, thought: r.thought })) }
      : {}),
    ...(trace.toolCalls && trace.toolCalls.length > 0 ? { toolCalls: trace.toolCalls.map((c) => ({ ...c })) } : {}),
  };
}

export type ChatSession = {
  sessionId: string;
  name: string;
  agentConfig: Record<string, unknown>;
  createdAt: number;
  lastUsedAt: number;
  turns?: ChatTurn[];
};

type ChatState = {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeTurns: ChatTurn[];
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
  dynamicSubAgents?: { enabled: boolean; maxIterations?: number };
  additionalToolNames?: string;
  terminalTools?: boolean;
  skills?: { paths: string[] };
};

function createChatStore() {
  const { subscribe, update } = writable<ChatState>({
    sessions: [],
    activeSessionId: null,
    activeTurns: [],
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
    update((s) => ({ ...s, activeTurns: session.turns.map(hydrateTurn), loadingSession: false, streamReasoningSteps: session.agentConfig?.streamReasoningSteps === true, structuredOutput: session.agentConfig?.outputSchema != null }));
  }

  async function createSession(opts: { name?: string } & ChatSessionConfigInput): Promise<string> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
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
  async function refreshTurns(sessionId: string, opts: { onlyIfSameLength?: boolean } = {}): Promise<void> {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return;
    const session = (await res.json()) as ChatSession & { turns: ChatTurn[] };
    update((s) => {
      if (s.activeSessionId !== sessionId) return s;
      // After a stream, only adopt server rows when they line up 1:1 with what we rendered —
      // never replace a richer local view with a shorter / different server view.
      if (opts.onlyIfSameLength && session.turns.length !== s.activeTurns.length) return s;
      return { ...s, activeTurns: session.turns.map(hydrateTurn) };
    });
  }

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

  /** Rewind to before `turnId`'s exchange; returns the removed user message (to edit or resend). */
  async function rewind(turnId: number): Promise<string> {
    const sid = activeId();
    if (!sid) return "";
    const { userMessage } = await utility<{ userMessage: string }>(sid, "rewind", { turnId });
    await refreshTurns(sid);
    return userMessage;
  }

  /** Regenerate the last answer: rewind the last exchange and resend its prompt. */
  async function rerun(): Promise<void> {
    const lastUser = [...get({ subscribe }).activeTurns].reverse().find((t) => t.role === "user");
    if (!lastUser) return;
    const text = await rewind(lastUser.id);
    if (text) await sendMessageStream(text);
  }

  async function clearContext(): Promise<void> {
    const sid = activeId();
    if (!sid) return;
    await utility(sid, "clear");
    await refreshTurns(sid);
  }

  /** Summarise older turns into one exchange; returns how many rows were summarised (0 = nothing to compact). */
  async function compact(keepLast?: number): Promise<number> {
    const sid = activeId();
    if (!sid) return 0;
    const { compacted } = await utility<{ compacted: number }>(sid, "compact", keepLast === undefined ? {} : { keepLast });
    await refreshTurns(sid);
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

  async function sendMessageStream(message: string): Promise<void> {
    let sessionId: string | null = null;
    let structuredOutput = false;
    update((s) => {
      sessionId = s.activeSessionId;
      structuredOutput = s.structuredOutput;
      return s;
    });
    if (!sessionId) return;

    const optimisticUserTurn: ChatTurn = {
      id: Date.now(),
      role: "user",
      content: message,
      tokensUsed: 0,
      ts: Date.now(),
    };

    const assistantTurnId = Date.now() + 1;
    const assistantTurn: ChatTurn = {
      id: assistantTurnId,
      role: "assistant",
      content: "",
      tokensUsed: 0,
      ts: Date.now(),
      streaming: true,
    };

    update((s) => ({
      ...s,
      activeTurns: [...s.activeTurns, optimisticUserTurn, assistantTurn],
      sending: true,
      error: null,
    }));

    try {
      const controller = new AbortController();
      activeController = controller;
      const outcome = await streamAssistantTurn({
        endpoint: `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`,
        body: { message },
        signal: controller.signal,
        assistantTurnId,
        structuredOutput,
        apply: (f) => update((s) => ({ ...s, activeTurns: f(s.activeTurns) })),
      });
      activeController = null;

      if (outcome.preStreamFailure !== undefined) {
        // Nothing ever rendered: drop the optimistic user+assistant turns, show the banner.
        update((s) => ({
          ...s,
          sending: false,
          error: outcome.preStreamFailure!,
          activeTurns: s.activeTurns.filter((t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId),
        }));
        return;
      }
      update((s) => ({ ...s, sending: false, ...(outcome.streamError !== undefined ? { error: outcome.streamError } : {}) }));
      // A completed turn is persisted server-side: re-sync so row ids (rewind / fork) and the stored trace line up.
      // Cancelled / errored turns persist nothing, so keep the local partial instead.
      const finished = get({ subscribe }).activeTurns.find((t) => t.id === assistantTurnId)?.cancelled !== true;
      if (outcome.streamError === undefined && finished) await refreshTurns(sessionId!, { onlyIfSameLength: true });
      // Auto-naming lands server-side just after the first exchange (instant title, then a model-written one).
      if (outcome.streamError === undefined && get({ subscribe }).activeTurns.length <= 2) {
        for (const delay of [0, 5_000, 12_000]) setTimeout(() => { void loadSessions().catch(() => {}); }, delay);
      }
    } catch (e) {
      const errorMsg = String(e);
      console.error("[Chat Stream] Exception:", errorMsg, e);
      activeController = null;
      update((s) => ({
        ...s,
        sending: false,
        error: errorMsg,
        activeTurns: s.activeTurns.filter((t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId),
      }));
    }
  }

  let activeController: AbortController | null = null;

  function stop() {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
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
    compact,
    fork,
  };
}

export const chatStore = createChatStore();
