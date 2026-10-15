// Run: bun test packages/tools/tests/drivers/driver-selection.test.ts --timeout 15000
import { describe, it, expect } from "bun:test"
import { selectToolCallingDriver, NativeFCDriver, TextParseDriver } from "../../src/drivers/index.js"

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

// W3b (plan 3.3): the `_dialect` param is CONSUMED. Per the spec's Stage-B end
// state (§4 "Calibration refines within native… it does not downgrade"; §5
// "routes to text-parse by capability, collapsing the two signals into one at
// the source"; §3 "surface the observed parse mode / dialect… so a wrong route
// is visible in telemetry"), the claim never picks the MODE — the capability
// claim does. Its fused role is confirm + source-tagged provenance: the
// validated claim rides on the selected driver as `dialectClaim`. Absent or
// out-of-vocabulary input is NOT a claim (GH #243: never default/act on a
// guessed format) and rides as undefined.
describe("selectToolCallingDriver — W3b: dialect consumed as confirm + provenance", () => {
  it('"native-fc" claim on a capable model CONFIRMS native and rides as provenance', () => {
    const driver = selectToolCallingDriver("native-fc", true)
    expect(driver.mode).toBe("native-fc")
    expect(driver.dialectClaim).toBe("native-fc")
  })

  it('"none" claim on a capable model NEVER downgrades (482c11e4 class) — and stays visible', () => {
    const driver = selectToolCallingDriver("none", true)
    expect(driver.mode).toBe("native-fc")
    expect(driver.dialectClaim).toBe("none")
  })

  it('"text-parse" claim on an incapable model rides on the capability-chosen TextParseDriver', () => {
    const driver = selectToolCallingDriver("text-parse", false)
    expect(driver.mode).toBe("text-parse")
    expect(driver.dialectClaim).toBe("text-parse")
  })

  it("no claim (undefined) → dialectClaim undefined on both routes", () => {
    expect(selectToolCallingDriver(undefined, true).dialectClaim).toBeUndefined()
    expect(selectToolCallingDriver(undefined, false).dialectClaim).toBeUndefined()
  })

  it("out-of-vocabulary claim is NOT a claim (GH #243 no-guess rule) → dialectClaim undefined", () => {
    // Callers must get the claim from loadDialectPriorClaim (closed vocabulary);
    // anything else must not masquerade as a measured fact on the driver.
    expect(selectToolCallingDriver("something-else", true).dialectClaim).toBeUndefined()
    expect(selectToolCallingDriver("", false).dialectClaim).toBeUndefined()
  })

  it("drivers constructed directly (no selection) carry no claim", () => {
    expect(new NativeFCDriver().dialectClaim).toBeUndefined()
    expect(new TextParseDriver().dialectClaim).toBeUndefined()
  })
})
