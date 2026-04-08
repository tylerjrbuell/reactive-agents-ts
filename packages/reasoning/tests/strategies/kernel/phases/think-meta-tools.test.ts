import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"

describe("think.ts meta-tool FC schema injection", () => {
  it("source injects recall schema when metaTools.recall is truthy", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).toMatch(/metaTools\?\.\brecall\b/)
    expect(src).toContain("recallTool")
  })
  it("source injects find schema when metaTools.find is truthy", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).toMatch(/metaTools\?\.\bfind\b/)
  })
})
