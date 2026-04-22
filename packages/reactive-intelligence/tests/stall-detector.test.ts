import { describe, it, expect } from "bun:test"
import { jaccardSimilarity, detectStall } from "../src/controller/handlers/stall-detector.js"

describe("jaccardSimilarity", () => {
  it("identical text returns 1.0", () => {
    expect(jaccardSimilarity("hello world foo", "hello world foo")).toBe(1)
  })

  it("completely different text returns 0.0", () => {
    expect(jaccardSimilarity("cat dog bird", "apple orange mango")).toBe(0)
  })

  it("both empty strings return 0.0", () => {
    expect(jaccardSimilarity("", "")).toBe(0)
  })

  it("one empty string returns 0.0", () => {
    expect(jaccardSimilarity("", "hello")).toBe(0)
  })

  it("partial overlap returns value between 0 and 1", () => {
    const sim = jaccardSimilarity("the quick brown fox", "the slow brown bear")
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })
})

describe("detectStall", () => {
  const makeStep = (thought: string, hasToolCalls: boolean) => ({
    type: hasToolCalls ? "action" : "thought" as const,
    content: thought,
  })

  it("returns false when tool calls are made", () => {
    const steps = [makeStep("thinking", true), makeStep("thinking", true)]
    expect(detectStall(steps, "local", 2)).toBe(false)
  })

  it("returns true when no tool calls and high similarity for local tier (window=2)", () => {
    const text = "I need to analyze the problem carefully and think about the solution"
    const steps = [makeStep(text, false), makeStep(text + " indeed", false)]
    expect(detectStall(steps, "local", 2)).toBe(true)
  })

  it("returns false below window threshold", () => {
    const text = "same text here"
    const steps = [makeStep(text, false)]  // only 1 step, window=2 needs 2
    expect(detectStall(steps, "local", 2)).toBe(false)
  })
})
