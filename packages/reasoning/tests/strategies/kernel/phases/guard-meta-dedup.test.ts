import { describe, it, expect } from "bun:test"
import { isConsecutiveMetaToolSpam } from "../../../../src/kernel/capabilities/act/guard.js"

describe("meta-tool deduplication guard", () => {
  it("returns false on first meta-tool call", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: undefined, consecutiveCount: 0 })).toBe(false)
  })
  it("returns false on second different meta-tool", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "brief", lastMetaToolCall: "pulse", consecutiveCount: 1 })).toBe(false)
  })
  it("returns false on second same meta-tool (first repeat, warn but allow)", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: "pulse", consecutiveCount: 1 })).toBe(false)
  })
  it("returns true on third consecutive same meta-tool call", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: "pulse", consecutiveCount: 2 })).toBe(true)
  })
})
