/**
 * `/btw <question>`: a side question about the run in progress. The composer snapshots the
 * streaming turn (task, tool calls so far, answer draft), the server answers it with a
 * separate read-only call (`server/services/chat-btw.ts`), and the answer shows as a
 * collapsible aside in the thread. Nothing here touches the chat store's turns, so the
 * running turn cannot be altered. Pure rules plus one small client.
 */
import { CORTEX_SERVER_URL } from "./constants.js";
import { prettyArgs } from "./stores/chat-timeline.js";
import { redactSecrets } from "./run-error.js";
import type { ChatTurn } from "./stores/chat-store.js";

/** The snapshot sent with the question (credential-shaped values already redacted). */
export interface BtwContextBody {
  readonly task: string;
  readonly running: boolean;
  readonly draft: string;
  readonly steps: readonly { readonly tool: string; readonly args?: string; readonly result?: string; readonly failed?: boolean }[];
}

/** One side question and its answer, shown in the thread. */
export interface BtwAside {
  readonly id: number;
  readonly question: string;
  /** The run was still going when asked. */
  readonly whileRunning: boolean;
  readonly status: "pending" | "answered" | "failed";
  readonly answer?: string;
  readonly error?: string;
}

/**
 * The context of the chat's latest exchange: the last user message, the assistant turn's
 * tool calls and its text (`liveText` while streaming). `null` when the chat has no
 * exchange to ask about (the server then answers from the stored last turn, or refuses).
 */
export function btwContextOf(turns: readonly ChatTurn[]): BtwContextBody | null {
  const assistant = [...turns].reverse().find((t) => t.role === "assistant");
  const user = [...turns].reverse().find((t) => t.role === "user");
  if (!assistant && !user) return null;
  const running = assistant?.streaming === true;
  const draft = running ? (assistant?.liveText ?? assistant?.content ?? "") : (assistant?.content ?? "");
  return {
    task: redactSecrets(user?.content ?? ""),
    running,
    draft: redactSecrets(draft),
    steps: (assistant?.toolCalls ?? []).map((c) => ({
      tool: c.name,
      ...(c.args !== undefined ? { args: prettyArgs(c.args) } : {}),
      ...(c.result !== undefined || c.error !== undefined ? { result: redactSecrets(c.result ?? c.error ?? "") } : {}),
      ...(c.status === "failed" ? { failed: true } : {}),
    })),
  };
}

/** Header of an aside in the thread: what was asked and when. */
export function asideTitle(a: BtwAside): string {
  return `Side question${a.whileRunning ? " while it ran" : ""}: ${a.question}`;
}

/** An aside after the server replied. */
export function settleAside(a: BtwAside, result: { readonly answer: string } | { readonly error: string }): BtwAside {
  return "answer" in result ? { ...a, status: "answered", answer: result.answer } : { ...a, status: "failed", error: result.error };
}

/** `POST /api/chat/sessions/:id/btw`; resolves to the answer or the server's error, never throws. */
export async function askBtw(
  sessionId: string,
  question: string,
  context: BtwContextBody | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ readonly answer: string } | { readonly error: string }> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/btw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, ...(context ? { context } : {}) }),
    });
    const j = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
    if (res.ok && typeof j.answer === "string") return { answer: j.answer };
    return { error: j.error ?? `Side question failed (${res.status})` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
