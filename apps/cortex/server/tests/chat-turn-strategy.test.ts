// A turn's strategy card survives the turn: the recorder folds StepEvents, the stored trace carries the
// settled run, and a reload reads it back. Older rows (no strategyRun) read as before.
import { describe, expect, test } from "bun:test";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { TurnTraceRecorder } from "../services/chat-turn-trace.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { openDatabase } from "../db/schema.js";

const step = (pass: string, extra: Record<string, unknown> = {}): AgentStreamEvent =>
  ({ _tag: "StepEvent", step: { kind: "strategy-step", pass, ...extra } }) as unknown as AgentStreamEvent;

describe("strategy run in the stored turn trace", () => {
  test("a turn with only strategy steps still stores the run, settled", () => {
    const r = new TurnTraceRecorder();
    r.record(step("reflexion:generate"));
    r.record(step("reflexion:critique-1", { critique: "tighten it", accepted: true }));
    const t = r.finish()!;
    expect(t.reasoningSteps).toEqual([]);
    expect(t.strategyRun?.ended).toBe(true);
    expect(t.strategyRun?.rows.map((x) => x.key)).toEqual(["generate", "critique-1"]);
    expect(t.strategyRun?.rows.every((x) => x.status === "done")).toBe(true);
  });

  test("it rides beside thinking and tool calls, and long code is clipped", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "ToolCallCompleted", toolName: "t", callId: "c", durationMs: 0, success: true } as AgentStreamEvent);
    r.record(step("code-action:execute:1", { code: "x".repeat(10_000), stdout: "ok" }));
    const t = r.finish()!;
    expect(t.toolCalls).toHaveLength(1);
    expect(t.strategyRun?.rows[0]!.code!.length).toBeLessThan(2_100);
  });

  test("a turn with no strategy steps stores none", () => {
    const r = new TurnTraceRecorder();
    r.record({ _tag: "ToolCallCompleted", toolName: "t", callId: "c", durationMs: 0, success: true } as AgentStreamEvent);
    expect(r.finish()!.strategyRun).toBeUndefined();
  });

  test("round-trips through the turns table; a row without it reads as before", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    const r = new TurnTraceRecorder();
    r.record(step("tree-of-thought:explore", { node: { id: "a", depth: 1, score: 0.8 } }));
    r.record(step("tree-of-thought:select", { path: ["a"] }));
    appendChatTurn(db, { sessionId, role: "assistant", content: "ok", tokensUsed: 1, trace: r.finish()! });
    appendChatTurn(db, { sessionId, role: "assistant", content: "old", tokensUsed: 1, trace: { reasoningSteps: [], toolCalls: [] } });
    const [withRun, legacy] = getChatTurns(db, sessionId);
    expect(withRun!.trace?.strategyRun?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(withRun!.trace?.strategyRun?.path).toEqual(["a"]);
    expect(withRun!.trace?.strategyRun?.ended).toBe(true);
    expect(legacy!.trace?.strategyRun).toBeUndefined();
  });
});
