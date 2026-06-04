// Run: bun test packages/tools/tests/drivers/driver-selection.test.ts --timeout 15000
import { describe, it, expect } from "bun:test"
import { selectToolCallingDriver } from "../../src/drivers/index.js"

describe("selectToolCallingDriver — capability is the master signal", () => {
  // The driver MUST be keyed on the same signal as the resolver injection
  // (capabilities.supportsToolCalling) so the two cannot diverge. 482c11e4 keyed
  // the driver on calibration while the resolver stayed on capability — a
  // capable-but-uncalibrated model then got a NativeFCStrategy resolver AND a
  // text-parse driver, and its <tool_call> text was never extracted (loop to
  // max-iterations). These tests pin the coherent contract.
  // See wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md.

  it("explicitly incapable (supportsToolCalling=false) → TextParseDriver", () => {
    expect(selectToolCallingDriver(undefined, false).mode).toBe("text-parse")
    expect(selectToolCallingDriver("none", false).mode).toBe("text-parse")
  })

  it("capable → NativeFCDriver", () => {
    expect(selectToolCallingDriver("native-fc", true).mode).toBe("native-fc")
  })

  it("REGRESSION GUARD: capable + uncalibrated → NativeFCDriver (not text-parse)", () => {
    // The 482c11e4 regression: this exact case (undefined dialect, but provider
    // capable — every uncalibrated Ollama model) was routed to text-parse, which
    // is a not-yet-completed path. It must stay native so the resolver/tools
    // attach cohere and tool calls are actually extracted.
    expect(selectToolCallingDriver(undefined, true).mode).toBe("native-fc")
    expect(selectToolCallingDriver("none", true).mode).toBe("native-fc")
  })

  it("capability unknown (default) → NativeFCDriver (pre-482c11e4 safe default)", () => {
    // When the provider exposes no capabilities() probe, support is unknown; we
    // default to native (think.ts's no-resolver fallback handles native events).
    expect(selectToolCallingDriver(undefined).mode).toBe("native-fc")
    expect(selectToolCallingDriver("something-else").mode).toBe("native-fc")
  })
})
