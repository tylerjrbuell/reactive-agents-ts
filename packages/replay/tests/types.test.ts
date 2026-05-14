import { describe, test, expect } from "bun:test"
import type { ReplayDiff, ReplayOverrides } from "../src/types.js"

describe("replay types", () => {
    test("ReplayOverrides accepts all optional fields", () => {
        const o: ReplayOverrides = {
            systemPrompt: "x",
            model: "m",
            temperature: 0,
            onMissingToolResult: "strict",
        }
        expect(o.systemPrompt).toBe("x")
        expect(o.onMissingToolResult).toBe("strict")
    })

    test("ReplayDiff identical flag works", () => {
        const d: ReplayDiff = {
            identical: true,
            iterationsDelta: 0,
            toolSequenceDiff: [],
            outputDiff: { original: "a", replay: "a", equal: true },
            tokensDelta: 0,
            costDelta: 0,
            durationDeltaMs: 0,
        }
        expect(d.identical).toBe(true)
        expect(d.outputDiff.equal).toBe(true)
    })
})
