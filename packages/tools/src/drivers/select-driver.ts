import type { ToolCallingDriver } from "./tool-calling-driver.js"
import { NativeFCDriver } from "./native-fc-driver.js"
import { TextParseDriver } from "./text-parse-driver.js"

/**
 * Choose the tool-calling driver. **Capability is the master signal.**
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
 * NOTE (Stage A): text-parse is a not-yet-completed path — `think.ts` has no
 * transition that turns `<tool_call>` markup into `status: "acting"`, so
 * `act.ts`'s text-parse `extractCalls` is unreachable. Routing a capable model
 * there strands it. Stage B builds the text-parse think→acting transition AND
 * narrows the Ollama capability claim (per-model `/api/show` probe) so
 * genuinely-incapable ("none") models route here honestly. `_dialect` is
 * retained for that stage (it will gate which completed text dialect is used);
 * it is intentionally unused in Stage A.
 *
 * See wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md.
 */
export function selectToolCallingDriver(
  _dialect: string | undefined,
  supportsToolCalling = true,
): ToolCallingDriver {
  if (supportsToolCalling === false) return new TextParseDriver()
  return new NativeFCDriver()
}
