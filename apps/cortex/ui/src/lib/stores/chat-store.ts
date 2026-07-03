import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import type { CortexAgentToolConfig } from "$lib/types/agent-config.js";
import {
  connectRunStream,
  reduceRunState,
  initialRunState,
  type RunState,
} from "@reactive-agents/ui-core";

/**
 * Re-exported for backward compat: `RunChatTab.svelte` still imports this
 * name for its own (separate, out-of-scope-for-this-refactor) SSE loop.
 * The real, single-source-of-truth union now lives in
 * `@reactive-agents/ui-core` (`UiStreamEvent`) — this file no longer keeps
 * its own duplicate copy (GH #163).
 */
export type { UiStreamEvent as AgentStreamEvent } from "@reactive-agents/ui-core";

export type ReasoningStep = {
  iteration: number;
  maxIterations: number;
  toolsCalledThisStep?: readonly string[];
  thought?: string;
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

function mergeThoughtText(previous: string | undefined, incoming: string): string {
  const prev = (previous ?? "").trim();
  const next = incoming.trim();

  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev) || prev === next) return next;
  if (prev.endsWith(next)) return prev;

  return `${prev}\n${next}`;
}

function appendThoughtDelta(previous: string | undefined, delta: string): string {
  return `${previous ?? ""}${delta}`;
}

function createChatStore() {
  const { subscribe, update } = writable<ChatState>({
    sessions: [],
    activeSessionId: null,
    activeTurns: [],
    sending: false,
    loadingSession: false,
    error: null,
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
    update((s) => ({ ...s, activeTurns: session.turns, loadingSession: false }));
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
    update((s) => {
      sessionId = s.activeSessionId;
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
      const url = `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`;

      let toolsUsed: string[] = [];
      let tokensUsed = 0;
      let costUsd = 0;
      let steps = 0;
      // Op E: run the ui-core reducer alongside the existing per-event
      // dispatch below, objectMode-on, purely to derive a partial structured
      // object for the deliverable preview. It does not drive any of the
      // liveText/reasoningSteps/content behavior — that logic (unchanged)
      // still switches on the raw event's `_tag` beneath.
      let rs: RunState = initialRunState();
      // Fix 2: `connectRunStream` synthesizes a `StreamError` for BOTH a
      // pre-stream connection failure (fetch throws / non-ok / no body,
      // before any content ever arrived) and a genuine mid-stream drop.
      // Pre-`bd8f7949` these were handled very differently (pre-stream:
      // clean removal of the optimistic user+assistant turns + a friendly
      // error; mid-stream: keep the partial content, just surface the
      // error). `receivedContent` recovers that distinction: it flips true
      // the moment any content-bearing event lands for this turn.
      let receivedContent = false;
      let preStreamFailureMsg: string | undefined;

      for await (const event of connectRunStream({ endpoint: url, body: { message } })) {
        rs = reduceRunState(rs, event, { objectMode: true });

        if (event._tag === "TextDelta") {
          receivedContent = true;
          const partial =
            rs.object !== undefined &&
            rs.object !== null &&
            typeof rs.object === "object" &&
            Object.keys(rs.object as Record<string, unknown>).length > 0
              ? (rs.object as Record<string, unknown>)
              : undefined;
          // All deltas land in liveText — the visible answer preview.
          // The final iteration's deltas are the final answer; earlier
          // iterations' text gets folded into its step when superseded.
          update((s) => ({
            ...s,
            activeTurns: s.activeTurns.map((t) =>
              t.id === assistantTurnId
                ? {
                    ...t,
                    liveText: appendThoughtDelta(t.liveText, event.text),
                    ...(partial !== undefined ? { liveObject: partial } : {}),
                  }
                : t,
            ),
          }));
        } else if (event._tag === "IterationProgress") {
          receivedContent = true;
          const iter = event.iteration;
          const max = event.maxIterations;
          const tools = event.toolsCalledThisStep;
          const step: ReasoningStep = {
            iteration: iter,
            maxIterations: max,
            ...(tools && tools.length > 0 ? { toolsCalledThisStep: tools } : {}),
          };
          update((s) => ({
            ...s,
            activeTurns: s.activeTurns.map((t) => {
              if (t.id !== assistantTurnId) return t;
              const existing = t.reasoningSteps ?? [];
              const idx = existing.findIndex((r) => r.iteration === iter);
              let steps = idx >= 0
                ? existing.map((r, i) =>
                    i === idx
                      ? {
                          ...step,
                          ...(r.thought && r.thought.trim().length > 0 ? { thought: r.thought } : {}),
                        }
                      : r,
                  )
                : [...existing, step];

              // New iteration started: the previous iteration's liveText was
              // reasoning, not the final answer — fold it into that step.
              const prevIter = t.streamProgress?.iteration;
              let liveText = t.liveText;
              if (prevIter != null && iter > prevIter && liveText && liveText.trim().length > 0) {
                const folded = liveText;
                const pIdx = steps.findIndex((r) => r.iteration === prevIter);
                steps = pIdx >= 0
                  ? steps.map((r, i) =>
                      i === pIdx ? { ...r, thought: mergeThoughtText(r.thought, folded) } : r,
                    )
                  : [
                      { iteration: prevIter, maxIterations: max, thought: folded },
                      ...steps,
                    ];
                liveText = undefined;
              }

              return {
                ...t,
                streamProgress: { iteration: iter, maxIterations: max },
                reasoningSteps: steps,
                liveText,
              };
            }),
          }));
        } else if (event._tag === "ThoughtEmitted") {
          receivedContent = true;
          const iter = event.iteration;
          const thought = event.content;
          update((s) => ({
            ...s,
            activeTurns: s.activeTurns.map((t) => {
              if (t.id !== assistantTurnId) return t;
              const existing = t.reasoningSteps ?? [];
              const idx = existing.findIndex((r) => r.iteration === iter);
              if (idx >= 0) {
                const prev = existing[idx]!;
                const next: ReasoningStep = {
                  ...prev,
                  thought: mergeThoughtText(prev.thought, thought),
                };
                return {
                  ...t,
                  reasoningSteps: existing.map((r, i) => (i === idx ? next : r)),
                };
              }
              return {
                ...t,
                reasoningSteps: [...existing, { iteration: iter, maxIterations: 0, thought }],
              };
            }),
          }));
        } else if (event._tag === "StreamCompleted") {
          receivedContent = true;
          tokensUsed = (event.metadata?.tokensUsed as number) ?? 0;
          costUsd = (event.metadata?.cost as number | undefined) ?? (event.metadata?.estimatedCost as number | undefined) ?? 0;
          steps =
            (event.metadata?.iterations as number | undefined) ??
            (event.metadata?.stepsCount as number | undefined) ??
            0;
          if (event.toolSummary && event.toolSummary.length > 0) {
            toolsUsed = event.toolSummary.map((t) => t.name);
          }
          // StreamCompleted.output is authoritative final output after verification/retries.
          const output: string | undefined = event.output;
          update((s) => ({
            ...s,
            activeTurns: s.activeTurns.map((t) => {
              if (t.id !== assistantTurnId) return t;
              // Prefer authoritative output; fall back to the live preview text
              const content = output?.trim() ? output : (t.liveText ?? t.content);
              return { ...t, content, liveText: undefined };
            }),
          }));
        } else if (event._tag === "StreamError") {
          // Handle stream errors
          console.error("[Chat Stream] Stream error:", event.cause);
          if (!receivedContent) {
            // Pre-stream connection failure (fetch threw / non-ok / no body,
            // nothing ever rendered): restore the pre-bd8f7949 clean outcome
            // below the loop instead of leaving a stale empty assistant
            // bubble alongside the error banner.
            preStreamFailureMsg = event.cause ?? "Request failed";
          } else {
            // Mid-stream drop: keep whatever partial content already
            // rendered and just surface the error.
            update((s) => ({
              ...s,
              error: event.cause ?? "Stream error",
            }));
          }
        }
      }

      if (preStreamFailureMsg !== undefined) {
        update((s) => ({
          ...s,
          sending: false,
          error: preStreamFailureMsg!,
          activeTurns: s.activeTurns.filter(
            (t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId,
          ),
        }));
        return;
      }

      update((s) => ({
        ...s,
        sending: false,
        activeTurns: s.activeTurns.map((t) =>
          t.id === assistantTurnId
            ? {
                ...t,
                streaming: false,
                streamProgress: undefined,
                // reasoningSteps intentionally kept for post-stream inspection
                // Safety net: stream ended without StreamCompleted output
                content: t.content || (t.liveText ?? ""),
                liveText: undefined,
                tokensUsed,
                liveTokens: undefined,
                liveCost: undefined,
                ...(costUsd > 0 ? { costUsd } : {}),
                ...(steps > 0 ? { steps } : {}),
                ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
              }
            : t,
        ),
      }));
    } catch (e) {
      const errorMsg = String(e);
      console.error("[Chat Stream] Exception:", errorMsg, e);
      update((s) => ({
        ...s,
        sending: false,
        error: errorMsg,
        activeTurns: s.activeTurns.filter((t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId),
      }));
    }
  }

  return {
    subscribe,
    loadSessions,
    selectSession,
    createSession,
    updateSessionConfig,
    deleteSession,
    renameSession,
    sendMessage,
    sendMessageStream,
  };
}

export const chatStore = createChatStore();
