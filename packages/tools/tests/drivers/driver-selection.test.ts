// Run: bun test packages/tools/tests/drivers/driver-selection.test.ts --timeout 15000
import { describe, it, expect } from "bun:test"
import { selectToolCallingDriver } from "../../src/drivers/index.js"

describe("selectToolCallingDriver — which tool-call mechanism the model gets", () => {
  // Native FC is only safe when calibration CONFIRMS the provider supports it.
  // For every other value the provider may silently ignore native `tools`
  // (e.g. ollama models without a "tools" capability → dialect "none"), leaving
  // the model with no way to call a tool. Text-parse works for any model that
  // can follow prompt instructions, so it is the safe default.
  it("native-fc → NativeFCDriver", () => {
    expect(selectToolCallingDriver("native-fc").mode).toBe("native-fc")
  })
  it("text-parse → TextParseDriver", () => {
    expect(selectToolCallingDriver("text-parse").mode).toBe("text-parse")
  })
  it("none (probed: provider advertises no native tool-calling) → TextParseDriver", () => {
    expect(selectToolCallingDriver("none").mode).toBe("text-parse")
  })
  it("undefined (uncalibrated) → TextParseDriver safe default", () => {
    expect(selectToolCallingDriver(undefined).mode).toBe("text-parse")
  })
  it("unknown value → TextParseDriver safe default", () => {
    expect(selectToolCallingDriver("something-else").mode).toBe("text-parse")
  })
})
