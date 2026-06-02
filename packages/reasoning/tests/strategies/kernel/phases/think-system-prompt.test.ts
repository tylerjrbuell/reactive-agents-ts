import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

const src = readFileSync(
  join(import.meta.dir, "../../../../src/kernel/capabilities/reason/think.ts"),
  "utf8"
)

describe("think.ts structural: canonical assembly is the sole path", () => {
  it("does not contain hasICS variable", () => {
    expect(src).not.toContain("const hasICS")
    expect(src).not.toContain("if (hasICS)")
  })
  it("routes context assembly through canonical project()", () => {
    // Sprint-1 A2 (2026-06-02): the legacy ContextManager.build → curate()
    // else-branch was deleted. Canonical project() from
    // `packages/reasoning/src/assembly/project.ts` is the sole assembler.
    expect(src).toContain("project(")
    expect(src).toContain("fromKernelState")
  })
  it("does not call legacy ContextManager.build or defaultContextCurator.curate", () => {
    // Canonical sole path — both legacy seams removed. Comments are allowed
    // (historical context); we pin on actual invocation patterns: a left
    // paren after the symbol or a structured destructure assignment.
    expect(src).not.toMatch(/ContextManager\.build\s*\(/)
    expect(src).not.toMatch(/defaultContextCurator\.curate\s*\(/)
  })
  it("does not reference the deleted RA_ASSEMBLY gate", () => {
    // Sprint-1 A2: flag deletion. The runtime gate `assemblyEnabled()` is gone.
    // RA_ASSEMBLY_DEBUG (diagnostic env flag) is allowed; the runtime gate
    // `assemblyEnabled(` is not.
    expect(src).not.toContain("assemblyEnabled(")
    expect(src).not.toContain('env.RA_ASSEMBLY ')
  })
  it("does not call buildDynamicContext", () => {
    expect(src).not.toContain("buildDynamicContext")
  })
  it("does not use thoughtPrompt variable", () => {
    expect(src).not.toContain("thoughtPrompt")
  })
})
