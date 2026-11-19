// Pins (2026-11-19, cost honesty): a replay snapshot reads the run's cost from
// the late `run-cost-finalized` record first, never reads an unknown total as a
// measured $0, and the diff flags a cost delta built on a lower bound.
import { describe, test, expect } from "bun:test"
import type { TraceEvent } from "@reactive-agents/trace"
import { snapshotFromAgentResult, snapshotFromRecordedRun } from "../src/snapshot.js"
import { diffTraces } from "../src/diff.js"
import { buildLLMTable } from "../src/llm-table.js"
import type { RecordedRun } from "../src/types.js"

const completed: TraceEvent = {
    kind: "run-completed", runId: "r", timestamp: 1, iter: -1, seq: 1,
    status: "success", output: "ok", totalTokens: 10, totalCostUsd: 0.01, costComplete: true, durationMs: 5,
}

const recorded = (events: readonly TraceEvent[]): RecordedRun => ({
    runId: "r", task: "t", model: "m", provider: "p", config: {},
    trace: { runId: "r", events }, toolTable: new Map(), llmTable: buildLLMTable([]),
})

describe("replay snapshot cost", () => {
    test("prefers the late run-cost-finalized total and carries its completeness", () => {
        const late: TraceEvent = { kind: "run-cost-finalized", runId: "r", timestamp: 2, iter: -1, seq: 2, totalCostUsd: 0.03, costComplete: false }
        const snap = snapshotFromRecordedRun(recorded([completed, late]))
        expect(snap.totalCostUsd).toBe(0.03)
        expect(snap.costComplete).toBe(false)
    })

    test("falls back to run-completed when no finalized record exists", () => {
        const snap = snapshotFromRecordedRun(recorded([completed]))
        expect(snap.totalCostUsd).toBe(0.01)
        expect(snap.costComplete).toBe(true)
    })

    test("no recorded cost is unknown: 0 lower bound, costComplete false", () => {
        expect(snapshotFromRecordedRun(recorded([])).costComplete).toBe(false)
        const replayed = snapshotFromAgentResult({ output: "ok" }, recorded([]))
        expect(replayed.totalCostUsd).toBe(0)
        expect(replayed.costComplete).toBe(false)
    })

    test("a cost delta over a partial side is flagged costPartial", () => {
        const a = snapshotFromRecordedRun(recorded([completed]))
        expect(diffTraces(a, { ...a, runId: "b" }).costPartial).toBeUndefined()
        expect(diffTraces(a, { ...a, runId: "b", costComplete: false }).costPartial).toBe(true)
    })
})
