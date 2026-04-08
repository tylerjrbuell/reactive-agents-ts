import { describe, it, expect } from "bun:test"
import { applyMessageWindowWithCompact } from "../../src/context/message-window.js"
import type { KernelMessage } from "../../src/strategies/kernel/kernel-state.js"

const BIG = "x".repeat(2000)

function makeAssistant(id: string): KernelMessage {
  return { role: "assistant", content: "calling", toolCalls: [{ id, name: "some-tool", arguments: {} }] }
}
function makeResult(id: string, content: string): KernelMessage {
  return { role: "tool_result", toolCallId: id, toolName: "some-tool", content }
}

describe("applyMessageWindowWithCompact", () => {
  it("strips old tool result content to stub", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"), makeResult("tc1", BIG),
      makeAssistant("tc2"), makeResult("tc2", BIG),
      makeAssistant("tc3"), makeResult("tc3", "small"),
    ]
    const { messages: out } = applyMessageWindowWithCompact(messages, {
      tier: "local", maxTokens: 100000, frozenToolResultIds: new Set(), keepFullTurns: 1,
    })
    const tc1 = out.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc1") as any
    expect(tc1.content).toContain("2000 chars")
    const tc3 = out.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc3") as any
    expect(tc3.content).toBe("small")
  })

  it("never strips frozen IDs", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"), makeResult("tc1", BIG),
      makeAssistant("tc2"), makeResult("tc2", "recent"),
    ]
    const { messages: out } = applyMessageWindowWithCompact(messages, {
      tier: "local", maxTokens: 100000, frozenToolResultIds: new Set(["tc1"]), keepFullTurns: 1,
    })
    const tc1 = out.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc1") as any
    expect(tc1.content).toBe(BIG) // frozen — not stripped
  })

  it("returns newlyFrozenIds with stripped IDs", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"), makeResult("tc1", BIG),
      makeAssistant("tc2"), makeResult("tc2", "recent"),
    ]
    const { newlyFrozenIds } = applyMessageWindowWithCompact(messages, {
      tier: "local", maxTokens: 100000, frozenToolResultIds: new Set(), keepFullTurns: 1,
    })
    expect(newlyFrozenIds.has("tc1")).toBe(true)
    expect(newlyFrozenIds.has("tc2")).toBe(false)
  })

  it("does not strip when content is ≤200 chars", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"), makeResult("tc1", "short result"),
      makeAssistant("tc2"), makeResult("tc2", "recent"),
    ]
    const { newlyFrozenIds } = applyMessageWindowWithCompact(messages, {
      tier: "local", maxTokens: 100000, frozenToolResultIds: new Set(), keepFullTurns: 1,
    })
    expect(newlyFrozenIds.size).toBe(0)
  })
})
