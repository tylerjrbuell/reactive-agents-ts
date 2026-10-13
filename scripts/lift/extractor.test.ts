// Run: bun test scripts/lift/extractor.test.ts --timeout 15000
/**
 * Task 0 (agent-tdd): unit smoke for the lift baseline metric extractor.
 *
 * Fed a COMMITTED fixture (`packages/replay/tests/fixtures/ci-lane-run.jsonl`,
 * the W0.8 replay CI-lane golden recorded by the real trace recorder) so the
 * extraction logic — kind routing, usage sums, assessment folding, false-
 * success classification — is proven before any live capture burns wall-clock.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { extractRunMetrics } from "./bench.ts"

const FIXTURE = join(import.meta.dir, "../../packages/replay/tests/fixtures/ci-lane-run.jsonl")

describe("lift baseline extractor", () => {
  const m = extractRunMetrics(readFileSync(FIXTURE, "utf8"), "unit-smoke", 1)

  test("routes run-completed + run-started basics", () => {
    expect(m.runId).toBe("01M4SVP0AN006F41XYW7VNJXRH")
    expect(m.runStatus).toBe("success")
    expect(m.success).toBe(true)
    expect(m.terminatedBy).toBe("final_answer")
    expect(m.totalTokens).toBe(62 + 11)
    expect(m.durationMs).toBe(204)
    expect(m.hung).toBe(false)
  })

  test("llm-exchange accounting: purpose split, usage sums, schema names", () => {
    expect(m.llmCalls).toBe(1)
    expect(m.thinkCalls).toBe(1)
    expect(m.classifyCalls).toBe(0)
    expect(m.tokensInSum).toBe(62)
    expect(m.tokensOutSum).toBe(11)
    expect(m.emptyContentThinkExchanges).toBe(0)
    expect(m.emptyContentRate).toBe(0)
    expect(m.maxToolSchemaNamesPerCall).toBe(0)
  })

  test("assessment folding + thrash-signature flags", () => {
    expect(m.assessments.length).toBe(1)
    expect(m.assessments[0]?.evidenceDelta).toBe(0)
    expect(m.evidenceDeltaAllZero).toBe(true)
    expect(m.finalRequirementsOutstanding).toBe(1)
    // Definition (probe-4 signature): success verdict with outstanding
    // requirements ⇒ false-success. The scripted golden hits exactly this
    // (single-shot run, requirement never re-assessed after final answer).
    expect(m.falseSuccess).toBe(true)
  })

  test("guard-fired capture (no loop-detector in this fixture)", () => {
    expect(m.guardFired.some((g) => g.guard === "terminal_decision" && g.outcome === "terminate")).toBe(true)
    expect(m.loopDetectorEvents).toBe(0)
    expect(m.firstActingIter).toBeNull() // no tool-call-start events
  })

  test("W1.5 additive forensics fields (absent on pre-W1 fixture ⇒ zeros, never throws)", () => {
    expect(m.thinkingCharsSum).toBe(0)
    expect(m.thinkingExchangeCount).toBe(0)
    expect(m.maxThinkContentChars).toBe(41) // "FINAL ANSWER: deterministic replay works."
    expect(m.traceBytes).toBeGreaterThan(1000)
  })

  test("tolerates partial/invalid lines (hung-run flushes)", () => {
    const partial = readFileSync(FIXTURE, "utf8") + "\n{\"kind\":\"run-comp"
    const m2 = extractRunMetrics(partial, "unit-smoke", 2)
    expect(m2.runStatus).toBe("success")
    expect(m2.llmCalls).toBe(1)
  })

  test("empty input degrades to null-signal row, never throws", () => {
    const m3 = extractRunMetrics("", "unit-smoke", 3)
    expect(m3.runStatus).toBeNull()
    expect(m3.success).toBeNull()
    expect(m3.evidenceDeltaAllZero).toBe(false)
    expect(m3.llmCalls).toBe(0)
  })
})
