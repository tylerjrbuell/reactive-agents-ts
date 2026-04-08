// packages/reasoning/tests/strategies/kernel/utils/token-delta-guard.test.ts
import { describe, it, expect } from "bun:test"
import { shouldExitOnLowDelta } from "../../../../src/strategies/kernel/kernel-runner.js"

describe("token-delta diminishing-returns guard", () => {
  it("returns false when iteration < 3", () => {
    expect(shouldExitOnLowDelta({ iteration: 2, tokenDelta: 100, consecutiveLowDeltaCount: 2 })).toBe(false)
  })
  it("returns false when delta >= 500", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 600, consecutiveLowDeltaCount: 2 })).toBe(false)
  })
  it("returns false on first low delta (count must be >= 2)", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 100, consecutiveLowDeltaCount: 1 })).toBe(false)
  })
  it("returns true on 2nd consecutive low delta at iteration >= 3", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 100, consecutiveLowDeltaCount: 2 })).toBe(true)
  })
})
