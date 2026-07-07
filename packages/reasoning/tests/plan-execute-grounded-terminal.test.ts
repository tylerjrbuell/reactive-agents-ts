import { describe, expect, test } from "bun:test"
import { evaluateGroundedSatisfaction } from "../src/strategies/plan-execute.js"

// P3/FM#4 (2026-07-07 failure-mode census): an all-analysis plan (7 steps,
// zero tool calls) narrated "SATISFIED" and shipped status:success — the F1
// grounded-terminal invariant only guarded the react loop. Plan-execute's
// reflect acceptance now runs this gate: redirect once (augment machinery adds
// real tool steps), then honest abstention over fabricated success.
describe("plan-execute grounded-terminal gate", () => {
    const done = new Set(["web-search"])

    test("UNSATISFIED reflections pass through untouched", () => {
        const r = evaluateGroundedSatisfaction({
            satisfied: false,
            requiredTools: ["web-search"],
            completedToolNames: new Set(),
            redirectsSoFar: 0,
        })
        expect(r.verdict).toBe("accept")
    })

    test("SATISFIED with no requiredTools accepts", () => {
        const r = evaluateGroundedSatisfaction({
            satisfied: true,
            requiredTools: undefined,
            completedToolNames: new Set(),
            redirectsSoFar: 0,
        })
        expect(r.verdict).toBe("accept")
    })

    test("SATISFIED with all required tools executed accepts", () => {
        const r = evaluateGroundedSatisfaction({
            satisfied: true,
            requiredTools: ["web-search"],
            completedToolNames: done,
            redirectsSoFar: 0,
        })
        expect(r.verdict).toBe("accept")
    })

    test("SATISFIED with a required tool never executed redirects first", () => {
        const r = evaluateGroundedSatisfaction({
            satisfied: true,
            requiredTools: ["web-search", "file-read"],
            completedToolNames: done,
            redirectsSoFar: 0,
        })
        expect(r.verdict).toBe("redirect")
        expect(r.missing).toEqual(["file-read"])
    })

    test("repeat SATISFIED with grounding still unmet abstains", () => {
        const r = evaluateGroundedSatisfaction({
            satisfied: true,
            requiredTools: ["file-read"],
            completedToolNames: new Set(),
            redirectsSoFar: 1,
        })
        expect(r.verdict).toBe("abstain")
        expect(r.missing).toEqual(["file-read"])
    })
})
