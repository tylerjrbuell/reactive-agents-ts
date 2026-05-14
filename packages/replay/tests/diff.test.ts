import { describe, test, expect } from "bun:test"
import { diffTraces } from "../src/diff.js"
import type { TraceSnapshot } from "../src/types.js"

const base: TraceSnapshot = {
    runId: "a",
    task: "t",
    model: "m",
    iterations: 2,
    toolCalls: [
        { toolName: "search", argsHash: "h1", ok: true },
        { toolName: "calc", argsHash: "h2", ok: true },
    ],
    output: "answer",
    totalTokens: 100,
    totalCostUsd: 0.01,
    durationMs: 1000,
}

describe("diffTraces", () => {
    test("identical snapshots produce identical=true and empty edit script", () => {
        const d = diffTraces(base, { ...base, runId: "b" })
        expect(d.identical).toBe(true)
        expect(d.toolSequenceDiff).toEqual([])
        expect(d.outputDiff.equal).toBe(true)
    })

    test("added tool call produces 'added' edit", () => {
        const replayed: TraceSnapshot = {
            ...base,
            runId: "b",
            toolCalls: [
                { toolName: "search", argsHash: "h1", ok: true },
                { toolName: "calc", argsHash: "h2", ok: true },
                { toolName: "search", argsHash: "h3", ok: true },
            ],
        }
        const d = diffTraces(base, replayed)
        expect(d.identical).toBe(false)
        expect(d.toolSequenceDiff).toEqual([
            { kind: "added", toolName: "search", argsHash: "h3", atIndex: 2 },
        ])
    })

    test("removed tool call produces 'removed' edit", () => {
        const replayed: TraceSnapshot = { ...base, runId: "b", toolCalls: [base.toolCalls[0]] }
        const d = diffTraces(base, replayed)
        expect(d.toolSequenceDiff).toEqual([
            { kind: "removed", toolName: "calc", argsHash: "h2", atIndex: 1 },
        ])
    })

    test("token / cost / duration deltas computed", () => {
        const replayed: TraceSnapshot = {
            ...base,
            runId: "b",
            totalTokens: 150,
            totalCostUsd: 0.02,
            durationMs: 1500,
        }
        const d = diffTraces(base, replayed)
        expect(d.tokensDelta).toBe(50)
        expect(d.costDelta).toBeCloseTo(0.01)
        expect(d.durationDeltaMs).toBe(500)
    })

    test("output divergence produces equal=false", () => {
        const replayed: TraceSnapshot = { ...base, runId: "b", output: "different" }
        const d = diffTraces(base, replayed)
        expect(d.outputDiff.equal).toBe(false)
        expect(d.outputDiff.original).toBe("answer")
        expect(d.outputDiff.replay).toBe("different")
    })
})
