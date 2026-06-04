import type { ToolCallingDriver } from "./tool-calling-driver.js"
import { NativeFCDriver } from "./native-fc-driver.js"
import { TextParseDriver } from "./text-parse-driver.js"

/**
 * Choose the tool-calling driver from a model's calibrated `toolCallDialect`.
 *
 * Native function-calling is selected ONLY when calibration explicitly confirms
 * the provider supports it (`"native-fc"`). Every other value resolves to the
 * text-parse driver, which works for any model that can follow prompt
 * instructions:
 *   - `"text-parse"` — calibration says use the text format.
 *   - `"none"` — the probe found no native tool-calling capability (e.g. an
 *      ollama model whose `/api/show` did not advertise `tools`). Handing such a
 *      model native `tools` is silently ignored by the provider, so it can never
 *      emit a call — it stalls. Text-parse gives it a `<tool_call>` text format
 *      it CAN produce.
 *   - `undefined` / unknown — uncalibrated. Default to the universally-safe
 *      text-parse path rather than assuming native FC that may not exist.
 *
 * A model that genuinely supports native FC will be calibrated `"native-fc"`
 * and keep the native path; only unconfirmed models fall back to text-parse.
 */
export function selectToolCallingDriver(dialect: string | undefined): ToolCallingDriver {
  return dialect === "native-fc" ? new NativeFCDriver() : new TextParseDriver()
}
