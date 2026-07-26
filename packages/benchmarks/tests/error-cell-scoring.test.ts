import { describe, test, expect } from "bun:test"
import { scoreErrorCell } from "../src/judge.js"
import type { BenchmarkTask } from "../src/types.js"

const task = {
    id: "rw-x",
    tier: "real-world",
    name: "t",
    domain: "research",
    strategy: "react",
    prompt: "p",
    requiresTools: true,
    maxIterations: 5,
    successCriteria: { type: "llm-judge", rubric: "r", passThreshold: 0.6 },
    primaryDimensions: ["accuracy", "reasoning"],
} as unknown as BenchmarkTask

describe("error-cell scoring (timeout/crash cells never reach the judge)", () => {
    test("zeroed dimensions with truthful evidence, no judge RPC", () => {
        const dims = scoreErrorCell(task, "timeout", 420_000)
        expect(dims.length).toBeGreaterThanOrEqual(2)
        for (const d of dims) {
            expect(d.score).toBe(0)
            expect(d.evidence).toContain("not judged")
            expect(d.evidence).toContain("timeout")
        }
        const accuracy = dims.find((d) => d.dimension === "accuracy")
        expect(accuracy).toBeDefined()
    })

    // Sibling of the judge-outage fix (cc015306, same day): an execution
    // timeout/crash is just as unmeasured as a judge outage, but scoreErrorCell
    // stamped no scoreState — so report-format's isRunInconclusive/measuredRuns
    // (keyed exclusively on scoreState === "inconclusive") never saw it, and the
    // placeholder 0 entered solve/lift math as a confident measured zero.
    test("a timeout cause is stamped inconclusive/execution-timeout, not a measured 0", () => {
        const dims = scoreErrorCell(task, "timeout", 150_000)
        for (const d of dims) {
            expect(d.scoreState).toBe("inconclusive")
            expect(d.inconclusiveReason).toBe("execution-timeout")
        }
    })

    test("a non-timeout crash cause is stamped inconclusive/execution-error", () => {
        const dims = scoreErrorCell(task, "TypeError: cannot read property of undefined", 3_000)
        for (const d of dims) {
            expect(d.scoreState).toBe("inconclusive")
            expect(d.inconclusiveReason).toBe("execution-error")
        }
    })

    test("timeout detection is case-insensitive and matches substrings (real runner.ts causes)", () => {
        // runner.ts throws `new Error(streamError ?? "timeout")` verbatim on the
        // kill-timer path, and `new Error("Task timed out after Nms")` elsewhere.
        expect(scoreErrorCell(task, "Task timed out after 150000ms", 150_000)[0]?.inconclusiveReason)
            .toBe("execution-timeout")
        expect(scoreErrorCell(task, "TIMEOUT", 150_000)[0]?.inconclusiveReason)
            .toBe("execution-timeout")
    })
})
