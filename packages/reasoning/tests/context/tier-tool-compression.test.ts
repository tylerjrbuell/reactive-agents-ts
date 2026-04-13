import { describe, it, expect } from "bun:test"
import { buildStaticContext } from "../../src/context/context-engine.js"
import type { ContextProfile } from "../../src/context/context-profile.js"

const tools = [
  { name: "web-search", description: "Search the web", parameters: [{ name: "query", type: "string", description: "search query", required: true }] },
  { name: "write-file", description: "Write file contents to disk", parameters: [{ name: "path", type: "string", description: "file path", required: true }, { name: "content", type: "string", description: "content", required: true }] },
]

function makeProfile(tier: string): ContextProfile {
  return {
    tier: tier as any,
    promptVerbosity: "minimal",
    rulesComplexity: "simplified",
    fewShotExampleCount: 0,
    compactAfterSteps: 4,
    fullDetailSteps: 2,
    toolResultMaxChars: 600,
    toolResultPreviewItems: 5,
    contextBudgetPercent: 70,
    toolSchemaDetail: "full",
    temperature: 0.7,
  }
}

describe("buildStaticContext tier compression", () => {
  it("local tier: required tools get compact format (shows params)", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: makeProfile("local"),
      availableToolSchemas: tools,
      requiredTools: ["web-search"],
    })
    // Required tool should show parameter signature
    expect(ctx).toMatch(/web-search\(/)
  })

  it("local tier: non-required tools get micro format (no params, just name: desc)", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: makeProfile("local"),
      availableToolSchemas: tools,
      requiredTools: ["web-search"],
    })
    // write-file is not required — should appear as micro (name: description)
    expect(ctx).toContain("write-file: Write file contents to disk")
    // write-file should NOT show parameter details in micro format
    expect(ctx).not.toMatch(/write-file\(/)
  })

  it("frontier tier: all tools get full format", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: makeProfile("frontier"),
      availableToolSchemas: tools,
      requiredTools: [],
    })
    // Full format shows tool with parameter names
    expect(ctx).toMatch(/web-search\(/)
    expect(ctx).toMatch(/write-file\(/)
  })
})
