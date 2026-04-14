// packages/reasoning/tests/strategies/kernel/utils/tier-guard-config.test.ts
import { describe, it, expect } from "bun:test"
import {
  shouldExitOnLowDelta,
  shouldForceOracleExit,
  resolveMaxSameTool,
  TIER_GUARD_THRESHOLDS,
} from "../../../../src/strategies/kernel/kernel-runner.js"

describe("TIER_GUARD_THRESHOLDS", () => {
  it("exposes all four tiers", () => {
    expect(TIER_GUARD_THRESHOLDS).toHaveProperty("local")
    expect(TIER_GUARD_THRESHOLDS).toHaveProperty("mid")
    expect(TIER_GUARD_THRESHOLDS).toHaveProperty("large")
    expect(TIER_GUARD_THRESHOLDS).toHaveProperty("frontier")
  })

  it("local tier has the tightest thresholds", () => {
    const cfg = TIER_GUARD_THRESHOLDS["local"]
    expect(cfg.tokenDeltaThreshold).toBe(300)
    expect(cfg.maxSameToolDefault).toBe(2)
    expect(cfg.oracleNudgeLimit).toBe(1)
  })

  it("mid tier preserves original defaults", () => {
    const cfg = TIER_GUARD_THRESHOLDS["mid"]
    expect(cfg.tokenDeltaThreshold).toBe(500)
    expect(cfg.maxSameToolDefault).toBe(3)
    expect(cfg.oracleNudgeLimit).toBe(2)
  })

  it("large tier has moderately relaxed thresholds", () => {
    const cfg = TIER_GUARD_THRESHOLDS["large"]
    expect(cfg.tokenDeltaThreshold).toBe(700)
    expect(cfg.maxSameToolDefault).toBe(4)
    expect(cfg.oracleNudgeLimit).toBe(3)
  })

  it("frontier tier has the most relaxed thresholds", () => {
    const cfg = TIER_GUARD_THRESHOLDS["frontier"]
    expect(cfg.tokenDeltaThreshold).toBe(1000)
    expect(cfg.maxSameToolDefault).toBe(5)
    expect(cfg.oracleNudgeLimit).toBe(3)
  })

  it("thresholds increase monotonically from local to frontier", () => {
    const tiers = ["local", "mid", "large", "frontier"] as const
    for (let i = 1; i < tiers.length; i++) {
      const prev = TIER_GUARD_THRESHOLDS[tiers[i - 1]]
      const curr = TIER_GUARD_THRESHOLDS[tiers[i]]
      expect(curr.tokenDeltaThreshold).toBeGreaterThanOrEqual(prev.tokenDeltaThreshold)
      expect(curr.maxSameToolDefault).toBeGreaterThanOrEqual(prev.maxSameToolDefault)
      expect(curr.oracleNudgeLimit).toBeGreaterThanOrEqual(prev.oracleNudgeLimit)
    }
  })
})

describe("tier-aware shouldExitOnLowDelta", () => {
  it("local tier exits at tokenDelta < 300", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 250, consecutiveLowDeltaCount: 2, tier: "local" })).toBe(true)
  })

  it("local tier does NOT exit at tokenDelta = 350 (above local threshold)", () => {
    // 350 > 300, so this should not trigger
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 350, consecutiveLowDeltaCount: 2, tier: "local" })).toBe(false)
  })

  it("frontier tier does NOT exit at tokenDelta = 800 (below frontier threshold is 1000)", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 800, consecutiveLowDeltaCount: 2, tier: "frontier" })).toBe(true)
  })

  it("frontier tier does NOT exit at tokenDelta = 1050 (above frontier threshold)", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 1050, consecutiveLowDeltaCount: 2, tier: "frontier" })).toBe(false)
  })

  it("mid tier uses default threshold of 500 (backward compatible)", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 400, consecutiveLowDeltaCount: 2, tier: "mid" })).toBe(true)
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 600, consecutiveLowDeltaCount: 2, tier: "mid" })).toBe(false)
  })

  it("no tier defaults to mid behavior", () => {
    // No tier → same as mid (500 threshold)
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 400, consecutiveLowDeltaCount: 2 })).toBe(true)
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 600, consecutiveLowDeltaCount: 2 })).toBe(false)
  })
})

describe("tier-aware shouldForceOracleExit", () => {
  it("local tier force-exits after 1 nudge", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 1, tier: "local" })).toBe(true)
  })

  it("mid tier force-exits after 2 nudges (backward compatible)", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 1, tier: "mid" })).toBe(false)
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 2, tier: "mid" })).toBe(true)
  })

  it("frontier tier requires 3 nudges", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 2, tier: "frontier" })).toBe(false)
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 3, tier: "frontier" })).toBe(true)
  })

  it("no tier defaults to mid (2 nudges)", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 2 })).toBe(true)
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 1 })).toBe(false)
  })

  it("oracle not ready never exits regardless of tier", () => {
    expect(shouldForceOracleExit({ oracleReady: false, readyToAnswerNudgeCount: 5, tier: "local" })).toBe(false)
    expect(shouldForceOracleExit({ oracleReady: false, readyToAnswerNudgeCount: 5, tier: "frontier" })).toBe(false)
  })
})

describe("resolveMaxSameTool", () => {
  it("returns base when no quantities are provided", () => {
    expect(resolveMaxSameTool(3)).toBe(3)
    expect(resolveMaxSameTool(3, undefined)).toBe(3)
    expect(resolveMaxSameTool(3, {})).toBe(3)
  })

  it("raises base to required quantity when quantity exceeds tier default", () => {
    // mid tier default is 3; web-search×4 → must be 4
    expect(resolveMaxSameTool(3, { "web-search": 4 })).toBe(4)
  })

  it("keeps base when all quantities are within tier default", () => {
    // local tier default 2; quantity 2 → stays 2
    expect(resolveMaxSameTool(2, { "web-search": 2 })).toBe(2)
    // mid tier default 3; quantity 1 → stays 3
    expect(resolveMaxSameTool(3, { "web-search": 1 })).toBe(3)
  })

  it("uses the highest quantity across all required tools", () => {
    // http-get×6 dominates web-search×4
    expect(resolveMaxSameTool(3, { "web-search": 4, "http-get": 6 })).toBe(6)
  })

  it("caps at 20 regardless of required quantity", () => {
    expect(resolveMaxSameTool(3, { "web-search": 25 })).toBe(20)
  })

  it("respects a user-supplied loopCfg.maxSameToolCalls that is already higher", () => {
    // User explicitly set 10 via loopDetection config — honour it
    expect(resolveMaxSameTool(10, { "web-search": 4 })).toBe(10)
  })
})
