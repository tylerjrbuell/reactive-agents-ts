import { describe, it, expect } from "bun:test"
import { existsSync } from "fs"

describe("dead code removal", () => {
  it("task-phase.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/task-phase.ts")).toBe(false)
  })
  it("synthesis-templates.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/synthesis-templates.ts")).toBe(false)
  })
  it("context-synthesizer.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/context-synthesizer.ts")).toBe(false)
  })
})
