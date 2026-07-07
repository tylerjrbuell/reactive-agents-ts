import { describe, test, expect } from "bun:test"
import { buildWeaknessQueue } from "../src/weakness-queue.js"

const report = {
    taskReports: [
        {
            taskId: "rw-1", modelVariantId: "m", variantId: "ra-full",
            runs: [
                { status: "error", diagnosis: { honestyLabel: "dishonest-success-suspected", failureModes: ["runaway-tokens"] }, dimensions: [{ dimension: "accuracy", score: 0, evidence: "no output produced (timeout after 420s) — cell not judged" }], traceId: "T1" },
            ],
            meanScores: [{ dimension: "accuracy", score: 0 }],
        },
        {
            taskId: "rw-1", modelVariantId: "m", variantId: "manual-react",
            runs: [{ status: "pass", dimensions: [] }],
            meanScores: [{ dimension: "accuracy", score: 0.8 }],
        },
        {
            taskId: "rw-9", modelVariantId: "m", variantId: "ra-full",
            runs: [{ status: "pass", dimensions: [] }],
            meanScores: [{ dimension: "accuracy", score: 1 }],
        },
        {
            taskId: "rw-9", modelVariantId: "m", variantId: "manual-react",
            runs: [{ status: "pass", dimensions: [] }],
            meanScores: [{ dimension: "accuracy", score: 0.2 }],
        },
    ],
}

describe("weakness queue", () => {
    test("ranks losing cells by severity; parity/winning cells excluded", () => {
        const q = buildWeaknessQueue(report)
        expect(q).toHaveLength(1)
        const w = q[0]!
        expect(w.taskId).toBe("rw-1")
        // gap 0.8*0.5 + failures 1.0*0.3 + dishonest 1.0*0.2 = 0.9
        expect(w.severity).toBeCloseTo(0.9, 3)
        expect(w.bestVariant).toBe("manual-react")
        expect(w.failureModes).toContain("runaway-tokens")
        expect(w.traceIds).toContain("T1")
    })
})
