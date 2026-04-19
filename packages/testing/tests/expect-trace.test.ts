import { test, expect } from "bun:test"
import { expectTrace } from "../src/harness/expect-trace.js"
import type { Trace } from "@reactive-agents/trace"

const trace: Trace = {
  runId: "r",
  events: [
    { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} },
    { kind: "entropy-scored", runId: "r", timestamp: 2, iter: 1, seq: 1, composite: 0.9, sources: { token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 } },
    { kind: "intervention-dispatched", runId: "r", timestamp: 3, iter: 1, seq: 2, decisionType: "temp-adjust", patchKind: "set-temperature", cost: { tokensEstimated: 0, latencyMsEstimated: 50 }, telemetry: {} },
    { kind: "run-completed", runId: "r", timestamp: 4, iter: 1, seq: 3, status: "success", totalTokens: 100, totalCostUsd: 0, durationMs: 3 },
  ],
}

test("asserts entropy spike above threshold", () => {
  expect(() => expectTrace(trace).toHaveEntropySpike({ above: 0.7 })).not.toThrow()
  expect(() => expectTrace(trace).toHaveEntropySpike({ above: 0.95 })).toThrow()
})

test("asserts intervention dispatched by type", () => {
  expect(() => expectTrace(trace).toHaveInterventionDispatched("temp-adjust")).not.toThrow()
  expect(() => expectTrace(trace).toHaveInterventionDispatched("switch-strategy")).toThrow()
})

test("asserts run completed with status", () => {
  expect(() => expectTrace(trace).toHaveCompleted("success")).not.toThrow()
  expect(() => expectTrace(trace).toHaveCompleted("failure")).toThrow()
})

test("chains multiple assertions", () => {
  expect(() =>
    expectTrace(trace)
      .toHaveEntropySpike({ above: 0.7 })
      .toHaveInterventionDispatched("temp-adjust")
      .toHaveCompleted("success")
  ).not.toThrow()
})
