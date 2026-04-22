import { describe, it, expect } from "bun:test"
import { healToolName } from "../../src/healing/tool-name-healer.js"

const registeredTools = ["file-read", "file-write", "code-execute", "web-search"]
const aliases = { "typescript/compile": "code-execute", "file_read": "file-read" }

describe("healToolName", () => {
  it("exact match returns the name unchanged", () => {
    expect(healToolName("file-read", registeredTools, aliases)).toEqual({
      resolved: "file-read",
      action: null,
    })
  })

  it("alias map resolves known hallucination", () => {
    expect(healToolName("typescript/compile", registeredTools, aliases)).toEqual({
      resolved: "code-execute",
      action: { stage: "tool-name", from: "typescript/compile", to: "code-execute" },
    })
  })

  it("underscore variant resolved via alias", () => {
    expect(healToolName("file_read", registeredTools, aliases)).toEqual({
      resolved: "file-read",
      action: { stage: "tool-name", from: "file_read", to: "file-read" },
    })
  })

  it("edit-distance match fixes minor typo", () => {
    const result = healToolName("file-reed", registeredTools, {})
    expect(result.resolved).toBe("file-read")
    expect(result.action?.stage).toBe("tool-name")
  })

  it("unresolvable name returns null", () => {
    const result = healToolName("totally-unknown-xyzzy", registeredTools, {})
    expect(result.resolved).toBeNull()
    expect(result.action).toBeNull()
  })
})
