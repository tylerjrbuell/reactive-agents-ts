// Run: bun run repo test apps/cortex/server/tests/chat-run-errors.test.ts
import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import type { AgentEvent } from "@reactive-agents/core";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { recordRunErrors, storedRunError, type RunErrorLog } from "../services/chat-run-errors.js";

/** The cause observed live (2026-11-10) on a failed Anthropic turn. */
const PROVIDER_ERROR =
  "LLM stream failed at iteration 0: anthropic call failed (anthropic:claude-sonnet-4-6): anthropic request failed: 400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

function fakeAgent() {
  let handler: ((e: AgentEvent) => void) | undefined;
  return {
    agent: {
      subscribe: async (h: (e: AgentEvent) => void) => {
        handler = h;
        return () => {
          handler = undefined;
        };
      },
    },
    emit: (e: Record<string, unknown>) => handler?.(e as unknown as AgentEvent),
  };
}

describe("recordRunErrors", () => {
  it("records a failed AgentCompleted's error by task id", async () => {
    const { agent, emit } = fakeAgent();
    const { log } = await recordRunErrors(agent);
    emit({ _tag: "AgentCompleted", taskId: "t1", success: false, error: PROVIDER_ERROR });
    expect(log.errorOf("t1")).toBe(PROVIDER_ERROR);
  });
  it("ignores successful runs, events without an error, and unknown ids", async () => {
    const { agent, emit } = fakeAgent();
    const { log } = await recordRunErrors(agent);
    emit({ _tag: "AgentCompleted", taskId: "ok", success: true, error: "ignored" });
    emit({ _tag: "AgentCompleted", taskId: "none", success: false });
    expect(log.errorOf("ok")).toBeUndefined();
    expect(log.errorOf("none")).toBeUndefined();
    expect(log.errorOf(undefined)).toBeUndefined();
  });
  it("records TaskFailed too, and keeps the first cause reported for a run", async () => {
    const { agent, emit } = fakeAgent();
    const { log } = await recordRunErrors(agent);
    emit({ _tag: "TaskFailed", taskId: "t2", error: "first" });
    emit({ _tag: "AgentCompleted", taskId: "t2", success: false, error: "second" });
    expect(log.errorOf("t2")).toBe("first");
  });
  it("stops recording after unsubscribe", async () => {
    const { agent, emit } = fakeAgent();
    const { log, unsubscribe } = await recordRunErrors(agent);
    unsubscribe();
    emit({ _tag: "AgentCompleted", taskId: "t3", success: false, error: "x" });
    expect(log.errorOf("t3")).toBeUndefined();
  });
});

describe("storedRunError", () => {
  it("keeps the first non-blank line, trimmed", () => {
    expect(storedRunError("\n  boom  \nstack line")).toBe("boom");
    expect(storedRunError("   ")).toBeUndefined();
    expect(storedRunError(42)).toBeUndefined();
  });
  it("caps a very long line", () => {
    const out = storedRunError("x".repeat(5_000))!;
    expect(out.length).toBeLessThanOrEqual(1_001);
    expect(out.endsWith("…")).toBe(true);
  });
});

type Internal = { sessions: Map<string, { session: { runStream: unknown }; runErrors?: RunErrorLog }> };

/** Run one chat turn whose stream is replaced by `completion` (narration streamed first); returns events + the stored reply. */
async function turnWith(
  completion: Record<string, unknown>,
  busError?: string,
): Promise<{ done: Record<string, unknown>; last: ReturnType<typeof getChatTurns>[number] | undefined; history: string }> {
  const path = `/tmp/cortex-chat-run-error-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  try {
    const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
    await svc.chat(id, "warm");
    const sessions = (svc as unknown as Internal).sessions;
    const entry = sessions.get(id)!;
    entry.session.runStream = async function* (): AsyncGenerator<Record<string, unknown>> {
      yield { _tag: "TextDelta", text: "Let me look that up." };
      yield { _tag: "StreamCompleted", metadata: { tokensUsed: 0 }, taskId: "run-1", ...completion };
    };
    sessions.set(id, { ...entry, runErrors: { errorOf: (runId) => (runId === "run-1" ? busError : undefined) } });

    const events: Record<string, unknown>[] = [];
    for await (const e of svc.chatStream(id, "go")) events.push(e as unknown as Record<string, unknown>);
    const turns = getChatTurns(db, id);
    const last = turns.filter((t) => t.role === "assistant").at(-1);
    const { historyContentOf } = await import("../services/chat-turn-trace.js");
    await svc.disposeAll();
    return { done: events.find((e) => e._tag === "StreamCompleted")!, last, history: last ? historyContentOf(last) : "" };
  } finally {
    db.close();
    rmSync(path, { force: true });
  }
}

describe("chatStream on a failed run", () => {
  // Framework shape since 2026-11-10: a failed run ships `output: ""`, the cause on `error`.
  it("keeps the event's own cause, persists the turn with empty content and a failed outcome", async () => {
    const cause = "Strategy execution failed (reactive): llm_error";
    const { done, last, history } = await turnWith(
      { output: "", success: false, terminatedBy: "llm_error", error: cause },
      PROVIDER_ERROR,
    );
    expect(done.error).toBe(cause);
    expect(last?.content).toBe(""); // the streamed narration is not stored as an answer
    expect(last?.trace?.outcome).toEqual({ success: false, ending: "failed", terminatedBy: "llm_error", error: cause });
    expect(history).toBe(`[The previous run failed (llm_error): ${cause}. No answer was given.]`);
  });

  it("falls back to the bus cause when the completion reports none", async () => {
    const { done, last } = await turnWith({ output: "", success: false, terminatedBy: "llm_error" }, PROVIDER_ERROR);
    expect(done.error).toBe(PROVIDER_ERROR);
    expect(last?.trace?.outcome).toEqual({ success: false, ending: "failed", terminatedBy: "llm_error", error: PROVIDER_ERROR });
  });

  it("an abstained run is stored as abstained with its reason, and history says so", async () => {
    const { last, history } = await turnWith({
      output: "",
      success: false,
      terminatedBy: "abstained",
      error: "The agent abstained: no grounded answer.",
      abstention: { reason: "no grounded answer", missing: ["web-search"] },
    });
    expect(last?.content).toBe("");
    expect(last?.trace?.outcome).toMatchObject({
      ending: "abstained",
      abstention: { reason: "no grounded answer", missing: ["web-search"] },
    });
    expect(history).toBe("[The previous run abstained: no grounded answer. No answer was given.]");
  });

  it("a partial run keeps its draft and the unfinished items", async () => {
    const output = "Draft summary.\n\nUnfinished:\n- write the file ./report.md";
    const { last } = await turnWith({ output, success: false, terminatedBy: "end_turn", error: "Unfinished: write the file ./report.md" });
    expect(last?.content).toBe(output);
    expect(last?.trace?.outcome).toMatchObject({ ending: "partial", unfinished: ["write the file ./report.md"] });
  });

  it("a successful run whose answer is a file is kept, with its deliverables", async () => {
    const { last, history } = await turnWith({
      output: "",
      success: true,
      receipt: { deliverables: [{ spec: "produce the file ./report.md", produced: true }] },
    });
    expect(last?.trace?.outcome).toBeUndefined();
    expect(last?.trace?.deliverables).toEqual([{ spec: "produce the file ./report.md", produced: true }]);
    expect(history).toBe("[The previous run produced: produce the file ./report.md.]");
  });
});
