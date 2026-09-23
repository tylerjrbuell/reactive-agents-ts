// Run: bun test packages/runtime/tests/judgment-context.test.ts --timeout 15000
//
// Phase D Task 1 - includeContext auto-merge building blocks
// (buildAutoContext / mergeJudgmentState), tested as pure functions in
// isolation from agent.judge() (see builder-judgment-context.test.ts for the
// end-to-end wiring through a live ReactiveAgent).

import { describe, it, expect } from "bun:test";
import {
  buildAutoContext,
  mergeJudgmentState,
  truncateToolResult,
} from "../src/judgment-context.js";
import type { ChatMessage } from "../src/chat.js";
import type { ReasoningStep } from "@reactive-agents/reasoning";

const chatHistory: ChatMessage[] = [
  { role: "user", content: "hello", timestamp: 1 },
  { role: "assistant", content: "hi there", timestamp: 2 },
];

const reasoningSteps: ReasoningStep[] = [
  {
    id: "s1" as ReasoningStep["id"],
    type: "thought",
    content: "thinking about it",
    timestamp: new Date(0),
  },
  {
    id: "s2" as ReasoningStep["id"],
    type: "observation",
    content: "tool returned 42",
    timestamp: new Date(1),
  },
];

describe("buildAutoContext", () => {
  it("is a strict no-op when includeContext is omitted or false", () => {
    expect(buildAutoContext({ chatHistory, reasoningSteps }, {})).toEqual({});
    expect(
      buildAutoContext({ chatHistory, reasoningSteps }, { includeContext: false })
    ).toEqual({});
  });

  it("folds windowed history + recent tool observations when includeContext is true", () => {
    const context = buildAutoContext(
      { chatHistory, reasoningSteps },
      { includeContext: true }
    );
    expect(typeof context.recentMessages).toBe("string");
    expect(context.recentMessages as string).toContain("hello");
    expect(context.recentMessages as string).toContain("hi there");
    expect(Array.isArray(context.toolResults)).toBe(true);
    expect((context.toolResults as string[])[0]).toContain("tool returned 42");
  });

  it("omits toolResults when includeToolResults is false", () => {
    const context = buildAutoContext(
      { chatHistory, reasoningSteps },
      { includeContext: true, includeToolResults: false }
    );
    expect(context.toolResults).toBeUndefined();
    expect(context.recentMessages).toBeDefined();
  });

  it("respects a messageWindow override", () => {
    const manyTurns: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "turn-" + i,
      timestamp: i,
    }));
    const context = buildAutoContext(
      { chatHistory: manyTurns, reasoningSteps: [] },
      { includeContext: true, messageWindow: 2 }
    );
    const rendered = context.recentMessages as string;
    expect(rendered).toContain("turn-9");
    expect(rendered).toContain("turn-8");
    expect(rendered).not.toContain("turn-0");
  });
});

describe("buildAutoContext tool-result truncation", () => {
  it("truncates an over-budget observation honestly - no STORED/recall(...) leak", () => {
    const longSteps: ReasoningStep[] = [
      {
        id: "s1" as ReasoningStep["id"],
        type: "observation",
        content: "y".repeat(2000),
        timestamp: new Date(0),
        metadata: { toolUsed: "http-get" },
      },
    ];
    const context = buildAutoContext(
      { chatHistory: [], reasoningSteps: longSteps },
      { includeContext: true },
    );
    const results = context.toolResults as string[];
    expect(results).toHaveLength(1);
    expect(results[0]!.length).toBeLessThan(2000);
    // Fix round 1, Important #2: the judgment backend has no scratchpad and
    // no recall tool, so the truncated content must never claim otherwise -
    // compressToolResult's "[STORED: ...] ... recall(...)" phrasing would be
    // a false capability claim here.
    expect(results[0]).not.toContain("recall(");
    expect(results[0]).not.toContain("STORED");
    expect(results[0]).toContain("truncated");
  });
});

describe("truncateToolResult", () => {
  it("passes short content through unchanged", () => {
    expect(truncateToolResult("short")).toBe("short");
  });

  it("truncates over-budget content with an honest marker, no STORED/recall(...) claim", () => {
    const long = "x".repeat(500);
    const result = truncateToolResult(long, 100);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("truncated");
    expect(result).toContain("500");
    expect(result).not.toContain("recall(");
    expect(result).not.toContain("STORED");
  });
});

describe("mergeJudgmentState", () => {
  it("returns the auto-context bag when no manual state is given", () => {
    const auto = { recentMessages: "hi" };
    expect(mergeJudgmentState(undefined, auto)).toEqual(auto);
  });

  it("returns {} when neither manual state nor auto-context is present", () => {
    expect(mergeJudgmentState(undefined, {})).toEqual({});
  });

  it("returns manual state unchanged when auto-context is empty", () => {
    expect(mergeJudgmentState({ x: 1 }, {})).toEqual({ x: 1 });
    expect(mergeJudgmentState(null, {})).toBeNull();
  });

  it("manual state wins on key collision, auto-context fills gaps", () => {
    const merged = mergeJudgmentState(
      { recentMessages: "manual wins" },
      { recentMessages: "auto value", toolResults: ["r1"] }
    );
    expect(merged).toEqual({ recentMessages: "manual wins", toolResults: ["r1"] });
  });

  it("a non-object manual state (string/array/null) wins outright over auto-context", () => {
    expect(mergeJudgmentState("just a string", { recentMessages: "auto" })).toBe(
      "just a string"
    );
    expect(mergeJudgmentState(null, { recentMessages: "auto" })).toBeNull();
    expect(mergeJudgmentState([1, 2, 3], { recentMessages: "auto" })).toEqual([1, 2, 3]);
  });
});
