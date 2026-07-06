import { describe, test, expect } from "bun:test";
import { analyzeRun } from "../src/analyze.js";
import type { TraceEvent } from "../src/events.js";

const events = [
  {
    kind: "run-started",
    runId: "r1",
    timestamp: 1,
    iter: -1,
    seq: 0,
    task: "t",
    model: "m",
    provider: "p",
    config: {},
  },
  {
    kind: "llm-exchange",
    runId: "r1",
    timestamp: 2,
    iter: 0,
    seq: 1,
    provider: "p",
    model: "m",
    requestKind: "stream",
    messages: [{ role: "user", content: "hi" }],
    toolSchemaNames: [],
    response: {
      content: "",
      toolCalls: [{ name: "calculator", arguments: { expression: "1+1" } }],
    },
  },
  {
    kind: "run-completed",
    runId: "r1",
    timestamp: 3,
    iter: 0,
    seq: 2,
    status: "success",
    totalTokens: 100,
    totalCostUsd: 0.001,
    durationMs: 1000,
  },
] as unknown as TraceEvent[];

describe("analyzeRun llm exchanges", () => {
  test("counts llm-exchange events", () => {
    const analysis = analyzeRun({ runId: "r1", events });
    expect(analysis.llmExchangeCount).toBe(1);
  });
});
