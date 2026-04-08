import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type ChatTurn = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tokensUsed: number;
  ts: number;
  toolsUsed?: string[];
  steps?: number;
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

  return { subscribe, loadSessions, selectSession, createSession, deleteSession, renameSession, sendMessage };
}

export const chatStore = createChatStore();
