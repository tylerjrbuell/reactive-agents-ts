import { describe, it, expect } from "bun:test"
import { buildToolReference } from "../../src/context/context-engine.js"

// Ported from the buildStaticContext wrapper tests (wrapper deleted Phase 1b,
// 2026-07-07 — only caller was the dead APC stack). buildToolReference is the
// live tier-adaptive tool disclosure used by systemPromptStage.
const tools = [
  { name: "web-search", description: "Search the web", parameters: [{ name: "query", type: "string", description: "search query", required: true }] },
  { name: "write-file", description: "Write file contents to disk", parameters: [{ name: "path", type: "string", description: "file path", required: true }, { name: "content", type: "string", description: "content", required: true }] },
]

describe("buildToolReference tier compression", () => {
  it("local tier: required tools get compact format (shows params)", () => {
    const ctx = buildToolReference("Search for X", tools, ["web-search"], "full", "local")
    expect(ctx).toMatch(/web-search\(/)
  })

  it("local tier: non-required tools get micro format (no params, just name: desc)", () => {
    const ctx = buildToolReference("Search for X", tools, ["web-search"], "full", "local")
    expect(ctx).toContain("write-file: Write file contents to disk")
    expect(ctx).not.toMatch(/write-file\(/)
  })

  it("frontier tier: all tools get full format", () => {
    const ctx = buildToolReference("Search for X", tools, [], "full", "frontier")
    expect(ctx).toMatch(/web-search\(/)
    expect(ctx).toMatch(/write-file\(/)
  })
})
