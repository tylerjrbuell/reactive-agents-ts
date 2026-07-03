// packages/svelte/tests/observe.test.ts
import { describe, expect, test } from "bun:test";
import { initialRunState, reduceRunState, type RunState, type SeqStamped, type UiStreamEvent } from "@reactive-agents/ui-core";
import { runCost, runSteps } from "../src/observe.js";

const build = (events: SeqStamped<UiStreamEvent>[]): RunState =>
  events.reduce((s, e) => reduceRunState(s, e), initialRunState());

describe("observe", () => {
  const state = build([
    { _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 120, success: true, seq: 1 },
    { _tag: "CostDelta", tokens: 42, usd: 0.01, seq: 2 },
  ]);
  test("runCost reads cost", () => expect(runCost(state)).toEqual({ tokens: 42, usd: 0.01 }));
  test("runSteps derives a tool entry", () => {
    const tool = runSteps(state).find((e) => e.kind === "tool");
    expect(tool?.success).toBe(true);
  });
});
