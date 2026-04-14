import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const src = readFileSync(
  join(import.meta.dir, "../../../../src/strategies/kernel/phases/think.ts"),
  "utf8"
)

describe("think.ts structural: no hasICS branch", () => {
  it("does not contain hasICS variable", () => {
    expect(src).not.toContain("const hasICS")
    expect(src).not.toContain("if (hasICS)")
  })
  it("routes context assembly through ContextManager.build()", () => {
    // Task 10: think.ts no longer calls buildStaticContext directly;
    // it delegates to ContextManager.build() which renders the static context.
    expect(src).toContain("ContextManager.build")
  })
  it("supports tool elaboration injection via ContextManager options", () => {
    // Task 10: toolElaboration flows through ContextManager.build() options,
    // not a direct buildToolElaborationInjection call in think.ts.
    expect(src).toContain("toolElaboration")
  })
  it("does not call buildDynamicContext", () => {
    expect(src).not.toContain("buildDynamicContext")
  })
  it("does not use thoughtPrompt variable", () => {
    expect(src).not.toContain("thoughtPrompt")
  })
})
