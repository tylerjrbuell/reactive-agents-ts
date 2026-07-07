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
})
