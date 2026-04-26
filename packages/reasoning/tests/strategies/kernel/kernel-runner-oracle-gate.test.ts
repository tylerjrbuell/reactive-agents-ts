import { describe, it, expect } from "bun:test"
import { shouldForceOracleExit } from "../../../src/kernel/loop/runner.js"

describe("oracle hard gate", () => {
  it("returns false when oracle not ready", () => {
    expect(shouldForceOracleExit({ oracleReady: false, readyToAnswerNudgeCount: 0 })).toBe(false)
  })
  it("returns false on first oracle-ready signal (stage 1: nudge first)", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 0 })).toBe(false)
  })
  it("returns true after 2 nudges with oracle still ready", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 2 })).toBe(true)
  })
})
