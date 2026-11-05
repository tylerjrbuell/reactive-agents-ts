import { describe, expect, test } from "bun:test";
import { finishTurnTrace, foldTurnTrace, initialTurnTrace, visibleThoughts, type UiStreamEvent } from "../src/index.js";

const run = (events: UiStreamEvent[]) => events.reduce(foldTurnTrace, initialTurnTrace());

describe("turn trace fold", () => {
  // The shared exit gate's decision is one event for every strategy; the latest wins.
  test("exit-gate decisions fold to the latest one", () => {
    const s = run([
      { _tag: "ExitGateDecision", decision: "repair", outstanding: ["write the file ./totals.json"], iteration: 2 },
      { _tag: "ExitGateDecision", decision: "handoff", outstanding: ["write the file ./totals.json"], iteration: 4 },
    ]);
    expect(s.exitGate).toEqual({ decision: "handoff", outstanding: ["write the file ./totals.json"], iteration: 4 });
    expect(initialTurnTrace().exitGate).toBeUndefined();
  });

  test("pre-tool text is thinking; last-iteration text stays pending (the answer)", () => {
    const s = run([
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "running" },
      { _tag: "TextDelta", text: "I should search." },
      { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1" },
      { _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 12, success: true, args: { q: "x" }, result: "hit" },
      { _tag: "IterationProgress", iteration: 2, maxIterations: 5, status: "running" },
      { _tag: "TextDelta", text: "Final answer" },
    ]);
    expect(s.pending).toBe("Final answer");
    expect(finishTurnTrace(s)).toEqual({
      reasoningSteps: [{ iteration: 1, thought: "I should search." }],
      toolCalls: [{ id: "c1", name: "web-search", status: "done", iteration: 1, durationMs: 12, args: { q: "x" }, result: "hit" }],
    });
  });

  // Repro (Cortex chat, cogito:8b, posture plan): the kernel streams TextDelta, then
  // ThoughtEmitted(n), then IterationProgress(n). The text landed under n (thought) AND
  // under n-1 (pending fold), so each thinking block repeated the next one.
  test("text already classified by ThoughtEmitted is not folded again as pending", () => {
    const s = run([
      { _tag: "TextDelta", text: "Plan A." },
      { _tag: "ThoughtEmitted", iteration: 1, content: "Plan A." },
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "r" },
      { _tag: "TextDelta", text: "Plan B." },
      { _tag: "ThoughtEmitted", iteration: 2, content: "Plan B." },
      { _tag: "IterationProgress", iteration: 2, maxIterations: 5, status: "r" },
    ]);
    expect(s.thoughts).toEqual({ 1: "Plan A.", 2: "Plan B." });
    expect(s.pending).toBe("");
  });

  test("a thought that does not match pending text leaves pending alone", () => {
    const s = run([
      { _tag: "TextDelta", text: "streaming answer" },
      { _tag: "ThoughtEmitted", iteration: 1, content: "something else" },
    ]);
    expect(s.pending).toBe("streaming answer");
  });

  test("leftover text folds into the previous iteration when the next starts", () => {
    const s = run([
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "r" },
      { _tag: "TextDelta", text: "thinking aloud" },
      { _tag: "IterationProgress", iteration: 2, maxIterations: 5, status: "r" },
    ]);
    expect(s.thoughts[1]).toBe("thinking aloud");
    expect(s.pending).toBe("");
  });

  test("empty turn → undefined; failure keeps error; results are capped and flagged", () => {
    expect(finishTurnTrace(run([{ _tag: "TextDelta", text: "hi" }]))).toBeUndefined();
    const s = run([
      { _tag: "ToolCallCompleted", toolName: "t", callId: "c", durationMs: 0, success: false, error: "x".repeat(10) },
    ]);
    const t = finishTurnTrace(s, { resultCap: 4 })!;
    expect(t.toolCalls[0]).toMatchObject({ status: "failed", error: "xxxx", resultTruncated: true });
  });

  test("a call still running when the turn ends is stored as done, not left spinning", () => {
    const s = run([{ _tag: "ToolCallStarted", toolName: "t", callId: "c" }]);
    expect(finishTurnTrace(s)!.toolCalls[0]!.status).toBe("done");
  });
});

describe("visibleThoughts (duplicate thinking)", () => {
  const table = "| Coin | Price |\n| BTC | $80,646 |\n| XRP | $1.32 |";

  test("a thought restating the final answer, or repeated per iteration, is not shown", () => {
    const s = run([
      { _tag: "IterationProgress", iteration: 2, maxIterations: 5, status: "r" },
      { _tag: "ThoughtEmitted", iteration: 2, content: table },
      { _tag: "IterationProgress", iteration: 3, maxIterations: 5, status: "r" },
      { _tag: "ThoughtEmitted", iteration: 3, content: table },
      { _tag: "StreamCompleted", output: table, metadata: { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 } } as UiStreamEvent,
    ]);
    expect(finishTurnTrace(s)).toBeUndefined();
  });

  test("real thinking before a tool call survives; identical repeats collapse to one", () => {
    const s = run([
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "r" },
      { _tag: "ThoughtEmitted", iteration: 1, content: "I need prices, so I will call the tool." },
      { _tag: "ThoughtEmitted", iteration: 2, content: "I need prices, so I will call the tool." },
      { _tag: "StreamCompleted", output: "done", metadata: { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 } } as UiStreamEvent,
    ]);
    expect(finishTurnTrace(s)!.reasoningSteps).toEqual([{ iteration: 1, thought: "I need prices, so I will call the tool." }]);
  });

  test("a thought equal to the live answer preview is hidden while streaming", () => {
    const s = run([
      { _tag: "ThoughtEmitted", iteration: 1, content: table },
      { _tag: "TextDelta", text: table },
    ]);
    expect(Object.keys(visibleThoughts(s))).toHaveLength(0);
  });
});

describe("provider thinking (ThinkingEmitted)", () => {
  test("is always shown — never filtered as an answer restatement — ahead of pre-tool prose", () => {
    const s = run([
      { _tag: "IterationProgress", iteration: 1, maxIterations: 5, status: "r" },
      { _tag: "ThinkingEmitted", iteration: 1, content: "The user wants prices; I should call crypto-price." },
      { _tag: "ThoughtEmitted", iteration: 1, content: "Fetching prices now." },
      { _tag: "StreamCompleted", output: "The user wants prices; I should call crypto-price.", metadata: { duration: 1, cost: 0, tokensUsed: 1, stepsCount: 1 } } as UiStreamEvent,
    ]);
    expect(finishTurnTrace(s)!.reasoningSteps).toEqual([
      { iteration: 1, thought: "The user wants prices; I should call crypto-price.\n\nFetching prices now." },
    ]);
  });
});
