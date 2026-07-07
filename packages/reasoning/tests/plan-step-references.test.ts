import { describe, test, expect } from "bun:test"
import { resolveStepReferences } from "../src/types/plan.js"
import type { PlanStep } from "../src/types/plan.js"

const preview =
    "[web-search result — compressed preview] 1. 10 Best Vector Databases You Should Consider in 2025 ⤵️⤵️⤵️: https://www.example.com/best-vector-dbs  2. Top Edge Databases: https://spam.example/listicle  " +
    "x".repeat(800)

const step = (id: string, result: string): PlanStep =>
    ({ id, instruction: "search", toolName: "web-search", status: "completed", retries: 0, tokensUsed: 0, result }) as unknown as PlanStep

const toolStepWithFull = (id: string, preview: string, full: string): PlanStep =>
    ({ id, instruction: "read", toolName: "file-read", status: "completed", retries: 0, tokensUsed: 0, result: preview, fullResult: full }) as unknown as PlanStep

const analysisStep = (id: string, result: string): PlanStep =>
    ({ id, instruction: "analyze", status: "completed", retries: 0, tokensUsed: 0, result }) as unknown as PlanStep

// FM#3 (2026-07-07 failure-mode census): bare {{from_step:sN}} spliced the FULL
// compressed-preview blob into chained tool args — a downstream web-search
// `query` embedded ~1000 chars of banner/URL junk and Tavily's 400-char query
// cap rejected it with HTTP 400, deterministically, in 3/3 rw-1 traces.
describe("resolveStepReferences — reference projections (FM#3)", () => {
    test("bare ref → cleaned distillate capped at 380 chars (arg-safe)", () => {
        const out = resolveStepReferences({ query: "{{from_step:s1}} typescript support" }, [step("s1", preview)])
        const q = out.query as string
        expect(q.length).toBeLessThanOrEqual(380 + " typescript support".length)
        expect(q).not.toContain("[web-search result — compressed preview]")
        expect(q).toContain("typescript support")
    })

    // rw-1 rerun (2026-07-07, trace 01KWYBZQ1VZWQEPXCHK94DS8QM): the model
    // templated {{from_step:s1:summary}} into a web-search query; the raw
    // 500-char slice kept the preview banner and still blew Tavily's 400 cap.
    test(":summary → distilled (banner stripped) then 500-char slice", () => {
        const out = resolveStepReferences({ content: "{{from_step:s1:summary}}" }, [step("s1", preview)])
        const c = out.content as string
        expect(c.length).toBeLessThanOrEqual(500)
        expect(c).not.toContain("[web-search result — compressed preview]")
    })

    test(":full → verbatim result for content-transfer args", () => {
        const out = resolveStepReferences({ content: "{{from_step:s1:full}}" }, [step("s1", preview)])
        expect(out.content).toBe(preview)
    })

    // Hotfix 0.5-2 (2026-07-07): for tool steps whose `result` is the compressed
    // preview, :full must return the uncompressed `fullResult` — returning the
    // preview silently truncated the exact content-transfer case :full exists for.
    test(":full prefers fullResult over the compressed preview (tool steps)", () => {
        const full = "line\n".repeat(500)
        const out = resolveStepReferences(
            { content: "{{from_step:s1:full}}" },
            [toolStepWithFull("s1", "[file-read result — compressed preview] first 40 lines…", full)],
        )
        expect(out.content).toBe(full)
        expect(out.content).not.toContain("compressed preview")
    })

    test("analysis-step output passes through whole (authored content, not preview junk)", () => {
        const long = "deliberate analysis output ".repeat(40)
        const out = resolveStepReferences({ content: "{{from_step:s1}}" }, [analysisStep("s1", long)])
        expect(out.content).toBe(long)
    })

    test("unresolved ref left intact", () => {
        const out = resolveStepReferences({ q: "{{from_step:s9}}" }, [step("s1", preview)])
        expect(out.q).toBe("{{from_step:s9}}")
    })
})
