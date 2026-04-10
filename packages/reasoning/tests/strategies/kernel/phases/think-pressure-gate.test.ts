import { describe, it, expect } from "bun:test"
import { shouldNarrowToFinalAnswerOnly, CONTEXT_PRESSURE_THRESHOLDS } from "../../../../src/strategies/kernel/phases/think.js"

describe("context pressure hard gate", () => {
  it("returns false when under budget", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 3000, maxTokens: 8000 })).toBe(false)
  })
  it("returns false at 84% (just under mid threshold)", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 6700, maxTokens: 8000 })).toBe(false)
  })
  it("returns true at 85% budget (mid default)", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 6800, maxTokens: 8000 })).toBe(true)
  })
  it("returns true above 85%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8000, maxTokens: 8000 })).toBe(true)
  })
})

describe("CONTEXT_PRESSURE_THRESHOLDS", () => {
  it("exposes all four tiers", () => {
    expect(CONTEXT_PRESSURE_THRESHOLDS).toHaveProperty("local")
    expect(CONTEXT_PRESSURE_THRESHOLDS).toHaveProperty("mid")
    expect(CONTEXT_PRESSURE_THRESHOLDS).toHaveProperty("large")
    expect(CONTEXT_PRESSURE_THRESHOLDS).toHaveProperty("frontier")
  })

  it("thresholds increase monotonically from local to frontier", () => {
    const tiers = ["local", "mid", "large", "frontier"] as const
    for (let i = 1; i < tiers.length; i++) {
      expect(CONTEXT_PRESSURE_THRESHOLDS[tiers[i]]).toBeGreaterThanOrEqual(
        CONTEXT_PRESSURE_THRESHOLDS[tiers[i - 1]]
      )
    }
  })

  it("has expected per-tier values", () => {
    expect(CONTEXT_PRESSURE_THRESHOLDS["local"]).toBe(0.80)
    expect(CONTEXT_PRESSURE_THRESHOLDS["mid"]).toBe(0.85)
    expect(CONTEXT_PRESSURE_THRESHOLDS["large"]).toBe(0.90)
    expect(CONTEXT_PRESSURE_THRESHOLDS["frontier"]).toBe(0.95)
  })
})

describe("tier-aware context pressure", () => {
  it("local tier narrows at 80%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8000, maxTokens: 10000, tier: "local" })).toBe(true)
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 7900, maxTokens: 10000, tier: "local" })).toBe(false)
  })

  it("mid tier narrows at 85%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8500, maxTokens: 10000, tier: "mid" })).toBe(true)
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8400, maxTokens: 10000, tier: "mid" })).toBe(false)
  })

  it("large tier narrows at 90%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 9000, maxTokens: 10000, tier: "large" })).toBe(true)
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8900, maxTokens: 10000, tier: "large" })).toBe(false)
  })

  it("frontier tier narrows at 95%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 9500, maxTokens: 10000, tier: "frontier" })).toBe(true)
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 9400, maxTokens: 10000, tier: "frontier" })).toBe(false)
  })

  it("no tier defaults to mid (backward compatible)", () => {
    // 85% threshold with no tier
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8500, maxTokens: 10000 })).toBe(true)
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8400, maxTokens: 10000 })).toBe(false)
  })
})
