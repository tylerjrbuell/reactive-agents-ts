import { test, expect } from "bun:test"
import { loadTrace, traceStats } from "../src/replay"
import { writeFile, mkdir } from "node:fs/promises"

test("loads JSONL trace file and computes summary stats", async () => {
  const dir = `/tmp/trace-load-${Date.now()}`
  await mkdir(dir, { recursive: true })
  const lines = [
    { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} },
    { kind: "entropy-scored", runId: "r", timestamp: 2, iter: 0, seq: 1, composite: 0.7, sources: { token: 0, structural: 0, semantic: 0, behavioral: 0, contextPressure: 0 } },
    { kind: "intervention-dispatched", runId: "r", timestamp: 3, iter: 0, seq: 2, decisionType: "early-stop", patchKind: "early-stop", cost: { tokensEstimated: 0, latencyMsEstimated: 0 }, telemetry: {} },
    { kind: "run-completed", runId: "r", timestamp: 4, iter: 0, seq: 3, status: "success", totalTokens: 10, totalCostUsd: 0, durationMs: 3 },
  ]
  await writeFile(`${dir}/r.jsonl`, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
  const trace = await loadTrace(`${dir}/r.jsonl`)
  expect(trace.events).toHaveLength(4)
  const stats = traceStats(trace)
  expect(stats.totalEvents).toBe(4)
  expect(stats.interventionsDispatched).toBe(1)
  expect(stats.maxEntropy).toBeCloseTo(0.7)
})

test("rejects malformed lines instead of casting them (FF-2)", async () => {
  const dir = `/tmp/trace-load-malformed-${Date.now()}`
  await mkdir(dir, { recursive: true })
  const lines = [
    // valid: has kind + runId
    { kind: "run-started", runId: "r", timestamp: 1, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} },
    // malformed: valid JSON, but not a TraceEvent shape (no kind, no runId)
    { foo: 1 },
    // malformed: missing runId only
    { kind: "run-completed", timestamp: 2 },
    // malformed: not even an object
    "just a string",
  ]
  await writeFile(`${dir}/r.jsonl`, lines.map((l) => JSON.stringify(l)).join("\n") + "\ninvalid json{{{\n")
  const trace = await loadTrace(`${dir}/r.jsonl`)
  // Only the one genuinely valid line survives; malformed lines are dropped,
  // not silently cast through as TraceEvent.
  expect(trace.events).toHaveLength(1)
  expect(trace.events[0]!.kind).toBe("run-started")
})
