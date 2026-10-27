import { describe, expect, test } from "bun:test";
import { TurnTraceRecorder } from "../services/chat-turn-trace.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { openDatabase } from "../db/schema.js";

describe("TurnTraceRecorder", () => {
  test("pre-tool text becomes thinking; final-iteration text stays the answer; tool detail kept", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "running" });
    r.record({ _tag: "TextDelta", text: "I should search." });
    r.record({ _tag: "ToolCallStarted", toolName: "web-search", callId: "c1" });
    r.record({ _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 12, success: true, args: { q: "x" }, result: "hit" });
    r.record({ _tag: "IterationProgress", iteration: 2, maxIterations: 5, status: "running" });
    r.record({ _tag: "TextDelta", text: "Final answer" });
    const t = r.finish()!;
    expect(t.reasoningSteps).toEqual([{ iteration: 1, thought: "I should search." }]);
    expect(t.toolCalls).toEqual([
      { id: "c1", name: "web-search", status: "done", iteration: 1, durationMs: 12, args: { q: "x" }, result: "hit" },
    ]);
  });

  test("a turn with no thinking and no tools records nothing; failures keep the error", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "TextDelta", text: "hi" });
    expect(r.finish()).toBeUndefined();
    r.record({ _tag: "ToolCallCompleted", toolName: "t", callId: "c", durationMs: 0, success: false, error: "boom" });
    expect(r.finish()!.toolCalls[0]).toMatchObject({ status: "failed", error: "boom" });
  });

  test("trace round-trips through the turns table", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    appendChatTurn(db, {
      sessionId,
      role: "assistant",
      content: "ok",
      tokensUsed: 1,
      trace: { reasoningSteps: [{ iteration: 1, thought: "t" }], toolCalls: [] },
    });
    expect(getChatTurns(db, sessionId)[0]!.trace?.reasoningSteps[0]?.thought).toBe("t");
  });
});
