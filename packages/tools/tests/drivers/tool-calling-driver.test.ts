import { describe, it, expect } from "bun:test"
import type { ToolCallingDriver, ExtractedCall, HealingAction } from "../../src/drivers/tool-calling-driver.js"

describe("ToolCallingDriver interface types", () => {
  it("ExtractedCall has required fields", () => {
    const call: ExtractedCall = {
      name: "file-read",
      arguments: { path: "/foo.ts" },
      parseMode: "tier-1",
      confidence: 0.95,
    }
    expect(call.name).toBe("file-read")
    expect(call.parseMode).toBe("tier-1")
    expect(call.confidence).toBeGreaterThan(0)
  })

  it("HealingAction captures from/to mapping", () => {
    const action: HealingAction = {
      stage: "param-name",
      from: "input",
      to: "path",
    }
    expect(action.stage).toBe("param-name")
  })

  it("ToolCallingDriver mode is a literal union", () => {
    const modes: Array<ToolCallingDriver["mode"]> = ["native-fc", "text-parse"]
    expect(modes).toHaveLength(2)
  })
})
