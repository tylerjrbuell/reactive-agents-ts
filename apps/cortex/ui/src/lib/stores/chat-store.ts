import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type AgentStreamEvent =
  | { _tag: "TextDelta"; text: string }
  | { _tag: "StreamCompleted"; output: string; metadata: Record<string, unknown>; toolSummary?: Array<{ name: string; calls: number; avgMs: number }> }
  | { _tag: "StreamError"; cause: string }
  | { _tag: "IterationProgress"; iteration: number; maxIterations: number; status: string }
  | { _tag: "StreamCancelled"; reason: string; iterationsCompleted: number }
  | Record<string, unknown>; // for other event types

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  ts: number;
  toolsUsed?: string[];
  steps?: number;
  streaming?: boolean;
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

  async function createSession(opts: {
    name?: string;
    provider?: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: string[];
    runId?: string;
    enableTools?: boolean;
    maxIterations?: number;
  }): Promise<string> {
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
      const res = await fetch(
        `${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId!)}/chat/stream`,
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
          activeTurns: s.activeTurns.filter((t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId),
        }));
        return;
      }

      if (!res.body) {
        update((s) => ({
          ...s,
          sending: false,
          error: "No response body",
          activeTurns: s.activeTurns.filter((t) => t.id !== optimisticUserTurn.id && t.id !== assistantTurnId),
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let toolsUsed: string[] = [];
      let tokensUsed = 0;
      let steps = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            if (!jsonStr.trim()) continue;

            try {
              const event = JSON.parse(jsonStr) as AgentStreamEvent;

              if (event._tag === "TextDelta") {
                update((s) => {
                  const idx = s.activeTurns.findIndex((t) => t.id === assistantTurnId);
                  if (idx >= 0) {
                    s.activeTurns[idx].content += event.text;
                  }
                  return s;
                });
              } else if (event._tag === "StreamCompleted") {
                tokensUsed = (event.metadata?.tokensUsed as number) ?? 0;
                steps = (event.metadata?.iterations as number) ?? 0;
                if (event.toolSummary && event.toolSummary.length > 0) {
                  toolsUsed = event.toolSummary.map((t) => t.name);
                }
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }

      update((s) => {
        const idx = s.activeTurns.findIndex((t) => t.id === assistantTurnId);
        if (idx >= 0) {
          s.activeTurns[idx].streaming = false;
          s.activeTurns[idx].tokensUsed = tokensUsed;
          if (steps > 0) s.activeTurns[idx].steps = steps;
          if (toolsUsed.length > 0) s.activeTurns[idx].toolsUsed = toolsUsed;
        }
        return { ...s, sending: false };
      });
    } catch (e) {
      const errorMsg = String(e);
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
    deleteSession,
    renameSession,
    sendMessage,
    sendMessageStream,
  };
}

export const chatStore = createChatStore();
