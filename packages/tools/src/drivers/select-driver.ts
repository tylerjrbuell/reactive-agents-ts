import type { ToolCallingDriver, ToolCallDialectClaim } from "./tool-calling-driver.js"
import { NativeFCDriver } from "./native-fc-driver.js"
import { TextParseDriver } from "./text-parse-driver.js"

/**
 * Choose the tool-calling driver. **Capability is the master signal — and the
 * ONLY routing signal.**
 *
 * The driver, the `ToolCallResolver` injection (`runner.ts`, keyed on
 * `capabilities.supportsToolCalling`), and the native-`tools` attachment
 * (`think.ts`, keyed on `mode !== "text-parse"`) MUST all derive from one signal
 * or they diverge. They diverged in `482c11e4`: the driver was keyed on
 * calibration (`toolCallDialect`) while the resolver stayed keyed on capability,
 * so a capable-but-uncalibrated model (every uncalibrated Ollama model —
 * `local.ts` claims `supportsToolCalling: true` unconditionally) got a
 * `NativeFCStrategy` resolver AND a text-parse driver. No native tools were sent,
 * the model emitted `<tool_call>` text, and the resolver — which only parses
 * native FC events / fenced-JSON / pseudo-code — could not read it, so the call
 * was never extracted and the agent looped to max-iterations.
 *
 * Rule: a provider that supports native FC (or whose support is unknown — the
 * default) gets the native driver. The text-parse driver is reserved for
 * providers that EXPLICITLY report no native tool-calling
 * (`supportsToolCalling === false`).
 *
 * **`dialect` is consumed (W3b, plan 3.3) as CONFIRM + PROVENANCE, never as a
 * route selector.** Per the Stage-B design's end state
 * (wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md):
 * - §4: "Calibration *refines within* native … it does not *downgrade*. Text-parse
 *   is reserved for `supportsToolCalling === false`." — a `"none"` / `"text-parse"`
 *   claim never moves a capable model to text-parse (the 482c11e4 class; pinned in
 *   `tests/drivers/driver-selection.test.ts` + the reasoning triad test).
 * - §5 Stage B: dialect priors collapse INTO the capability claim at the source
 *   (`deriveSupportsToolCalling`, llm-provider — W2a). Re-arbitrating the floor
 *   here would re-create the second signal design law #1 forbids.
 * - §3: "surface the observed parse mode / dialect … so a wrong route is *visible*
 *   in telemetry, not silent." — the validated claim rides on the selected driver
 *   as `dialectClaim`. `"native-fc"` + capable CONFIRMS native (claim visible,
 *   route unchanged).
 *
 * Phantom rule (GH #243): callers must pass the claim from
 * `loadDialectPriorClaim` (explicit-presence reader). The schema-defaulted
 * `ModelCalibration.toolCallDialect` (absent → `"none"`) is NOT a claim — do not
 * feed it here. Input outside the closed claim vocabulary is treated as NO
 * claim (`undefined` on the driver), never defaulted into one.
 */
export function selectToolCallingDriver(
  dialect: string | undefined,
  supportsToolCalling = true,
): ToolCallingDriver {
  const claim: ToolCallDialectClaim | undefined =
    dialect === "native-fc" || dialect === "text-parse" || dialect === "none"
      ? dialect
      : undefined
  if (supportsToolCalling === false) return new TextParseDriver(claim)
  return new NativeFCDriver(claim)
}
