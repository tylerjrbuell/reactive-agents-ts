import { describe, it, expect } from "bun:test"
import { shouldNarrowToFinalAnswerOnly } from "../../../../src/strategies/kernel/phases/think.js"

describe("context pressure hard gate", () => {
  it("returns false when under budget", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 3000, maxTokens: 8000 })).toBe(false)
  })
  it("returns false at 94% (just under threshold)", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 7500, maxTokens: 8000 })).toBe(false)
  })
  it("returns true at 95% budget", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 7600, maxTokens: 8000 })).toBe(true)
  })
  it("returns true above 95%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8000, maxTokens: 8000 })).toBe(true)
  })
})
