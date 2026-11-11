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

describe("healToolName — short-name guard", () => {
  const names = ["todo", "find", "pulse", "web-search", "file-read"]

  it("does not heal an unrelated short word onto a short tool (task -> todo)", () => {
    expect(healToolName("task", names, {}).resolved).toBeNull()
    expect(healToolName("tool", names, {}).resolved).toBeNull()
  })
  it("does not heal one-edit typos onto 4-letter tools", () => {
    expect(healToolName("fine", names, {}).resolved).toBeNull()
  })
  it("still heals case differences on short names", () => {
    expect(healToolName("TODO", names, {}).resolved).toBe("todo")
  })
  it("ambiguous equal-distance candidates stay unresolved", () => {
    expect(healToolName("file-reax", ["file-read", "file-reap"], {}).resolved).toBeNull()
  })
  it("long names still heal within 2 edits", () => {
    expect(healToolName("web-serach", names, {}).resolved).toBe("web-search")
  })
})

// 2026-11-10: healToolName and resolveToolName are one resolver. A name that
// collapses to two registered tools (separators/case only) heals to NEITHER;
// the old first-match rewrite picked `a-b` and could run the wrong tool.
describe("healToolName — separator variants share the ambiguity-safe resolver", () => {
  it("a variant matching two tools resolves to nothing", () => {
    expect(healToolName("a_b", ["a-b", "a/b"], {})).toEqual({ resolved: null, action: null })
  })
  it("ambiguity is not rescued by edit distance", () => {
    const names = ["umami/get_website_stats", "umami-get-website-stats"]
    expect(healToolName("umami_get_website_stats", names, {}).resolved).toBeNull()
  })
  it("a unique MCP variant still heals", () => {
    expect(healToolName("umami_get_website_stats", ["umami/get_website_stats", "web-search"], {})).toEqual({
      resolved: "umami/get_website_stats",
      action: { stage: "tool-name", from: "umami_get_website_stats", to: "umami/get_website_stats" },
    })
  })
  it("`web_search` still heals to `web-search`", () => {
    expect(healToolName("web_search", ["web-search", "http-get"], {}).resolved).toBe("web-search")
  })
  it("camelCase still heals (`fileRead` → `file-read`)", () => {
    expect(healToolName("fileRead", registeredTools, {}).resolved).toBe("file-read")
  })
})
