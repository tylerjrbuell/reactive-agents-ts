import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"

const src = readFileSync(
  "packages/reasoning/src/strategies/kernel/phases/think.ts",
  "utf8"
)

describe("think.ts structural: no hasICS branch", () => {
  it("does not contain hasICS variable", () => {
    expect(src).not.toContain("const hasICS")
    expect(src).not.toContain("if (hasICS)")
  })
  it("always calls buildStaticContext", () => {
    expect(src).toContain("buildStaticContext")
  })
  it("supports tool elaboration injection", () => {
    expect(src).toContain("buildToolElaborationInjection")
    expect(src).toContain("toolElaborationSection")
  })
  it("does not call buildDynamicContext", () => {
    expect(src).not.toContain("buildDynamicContext")
  })
  it("does not use thoughtPrompt variable", () => {
    expect(src).not.toContain("thoughtPrompt")
  })
})
