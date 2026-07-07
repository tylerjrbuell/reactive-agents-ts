import { describe, expect, test } from "bun:test"
import { buildGuidanceText } from "../src/context/guidance.js"

// Hotfix 0.5-1 (2026-07-07): GuidanceContext was assembled every think turn
// and pendingGuidance cleared — but the rendered text never reached the
// model (the dead ContextManager owned the renderer). think.ts now appends
// buildGuidanceText output to the system prompt's dynamic tail.
describe("buildGuidanceText (live guidance rendering)", () => {
    test("no active signals → null (zero prompt cost)", () => {
        expect(buildGuidanceText({ requiredToolsPending: [], loopDetected: false })).toBeNull()
    })

    test("required tools + loop nudge render as a Guidance block", () => {
        const text = buildGuidanceText({
            requiredToolsPending: ["web-search"],
            loopDetected: true,
            loopDetectedMessage: "custom nudge",
        })
        expect(text).toContain("Guidance:")
        expect(text).toContain("REQUIRED tools not yet called: web-search")
        expect(text).toContain("custom nudge")
    })

    test("evidence gap renders the revision instruction", () => {
        const text = buildGuidanceText({
            requiredToolsPending: [],
            loopDetected: false,
            evidenceGap: "invented price",
        })
        expect(text).toContain("invented price")
        expect(text).toContain("Revise using only data")
    })
})
