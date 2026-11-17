import { describe, expect, test } from "bun:test";
import { TurnTraceRecorder, historyContentOf, readStoredOutcome, turnOutcomeOf, withTurnOutcome } from "../services/chat-turn-trace.js";
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
    expect(t.reasoningSteps).toEqual([{ iteration: 1, thought: "I should search.", narration: "I should search." }]);
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

  test("the reported strategy and duration survive the turns table", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    appendChatTurn(db, {
      sessionId,
      role: "assistant",
      content: "ok",
      tokensUsed: 1,
      trace: { reasoningSteps: [], toolCalls: [], strategy: "reactive", durationMs: 42_000 },
    });
    expect(getChatTurns(db, sessionId)[0]!.trace).toMatchObject({ strategy: "reactive", durationMs: 42_000 });
  });

  // Repro (cogito:8b): a failed run persisted as an ordinary answer; after reload nothing marked
  // the turn as failed. Since 2026-11-10 the framework ships a failed run with `output: ""` and the
  // cause on `error` ("… What was attempted: …").
  test("a failed run's outcome is captured and survives the turns table", () => {
    expect(turnOutcomeOf({ success: true })).toBeUndefined();
    expect(turnOutcomeOf({})).toBeUndefined();
    const outcome = turnOutcomeOf({
      success: false,
      output: "",
      terminatedBy: "max_iterations",
      error: "budget exhausted\nWhat was attempted: 3 tool call(s) attempted (web-search), 1 succeeded.",
    });
    expect(outcome).toEqual({ success: false, ending: "failed", terminatedBy: "max_iterations", error: "budget exhausted" });
    // A turn with no thinking/tool calls still gets a trace to carry the outcome.
    expect(withTurnOutcome(undefined, outcome)).toEqual({ reasoningSteps: [], toolCalls: [], outcome: outcome! });
    expect(withTurnOutcome(undefined, undefined)).toBeUndefined();

    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    appendChatTurn(db, { sessionId, role: "assistant", content: "", tokensUsed: 1, trace: withTurnOutcome(undefined, outcome)! });
    expect(getChatTurns(db, sessionId)[0]!.trace?.outcome).toEqual(outcome!);
  });

  test("abstained and partial outcomes keep their detail through the turns table", () => {
    const abstained = turnOutcomeOf({
      success: false,
      output: "",
      terminatedBy: "abstained",
      error: "The agent abstained: required tool missing.",
      abstention: { reason: "required tool missing", missing: ["web-search"] },
    });
    expect(abstained).toMatchObject({ ending: "abstained", abstention: { reason: "required tool missing", missing: ["web-search"] } });
    const partial = turnOutcomeOf({ success: false, output: "Draft.\n\nUnfinished:\n- write ./a.json", error: "Unfinished: write ./a.json" });
    expect(partial).toMatchObject({ ending: "partial", unfinished: ["write ./a.json"] });
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    for (const o of [abstained, partial]) {
      appendChatTurn(db, { sessionId, role: "assistant", content: "", tokensUsed: 1, trace: withTurnOutcome(undefined, o)! });
    }
    expect(getChatTurns(db, sessionId).map((t) => t.trace?.outcome)).toEqual([abstained!, partial!]);
  });

  test("a row written before ending kinds existed reads back as failed", () => {
    expect(readStoredOutcome({ success: false, terminatedBy: "max_iterations" })).toEqual({
      success: false,
      ending: "failed",
      terminatedBy: "max_iterations",
    });
    expect(readStoredOutcome({ success: true })).toBeUndefined();
  });

  test("receipt deliverables are kept on the recorded trace", () => {
    const r = new TurnTraceRecorder();
    r.record({
      _tag: "StreamCompleted",
      output: "",
      metadata: { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 },
      success: true,
      receipt: { deliverables: [{ spec: "./r.md", produced: true }] },
    } as unknown as Parameters<TurnTraceRecorder["record"]>[0]);
    // The run's reported duration rides along (the chat action row shows "Ran 1s").
    expect(r.finish()).toEqual({ reasoningSteps: [], toolCalls: [], durationMs: 1, deliverables: [{ spec: "./r.md", produced: true }] });
  });

  test("a plain answer still records the strategy and duration the run reported", () => {
    const r = new TurnTraceRecorder();
    r.record({
      _tag: "StreamCompleted",
      output: "4",
      metadata: { duration: 42_000, strategyUsed: "plan-execute-reflect" },
      success: true,
    } as unknown as Parameters<TurnTraceRecorder["record"]>[0]);
    expect(r.finish()).toEqual({ reasoningSteps: [], toolCalls: [], strategy: "plan-execute-reflect", durationMs: 42_000 });
  });
});

describe("a user-stopped turn is a partial by the user", () => {
  const stopped = {
    success: false,
    output: "Half the answer.",
    error: "The run was stopped on request before it finished.",
    outcome: { status: "partial", outstanding: ["stopped_by_request"] },
  };
  test("stored as partial with interruptedBy user and no cause, even with a bus error", () => {
    const stored = turnOutcomeOf(stopped, "bus generic note");
    expect(stored).toEqual({ success: false, ending: "partial", interruptedBy: "user" });
    expect(readStoredOutcome(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
  test("history keeps the answer so far with the stop marker, not a failure note", () => {
    const outcome = turnOutcomeOf(stopped)!;
    const text = historyContentOf({ content: "Half the answer.", trace: { reasoningSteps: [], toolCalls: [], outcome } });
    expect(text).toBe("Half the answer.\n\n[The user stopped this reply here; the answer above is the work so far.]");
    expect(text).not.toContain("failed");
  });
  test("a stop that wrote nothing still says so", () => {
    const outcome = turnOutcomeOf({ ...stopped, output: "" })!;
    expect(historyContentOf({ content: "", trace: { reasoningSteps: [], toolCalls: [], outcome } })).toContain("stopped the previous reply");
  });
});
