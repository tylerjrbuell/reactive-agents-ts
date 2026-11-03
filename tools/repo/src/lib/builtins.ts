import type { CheckEntry } from "./manifest.ts"
import { evaluateRatchets } from "./ratchet.ts"

/** Outcome of a builtin check. */
export interface BuiltinResult {
  ok: boolean
  output: string
}

/** A builtin check, referenced from `checks.json` as `builtin:<name>`. */
export type Builtin = (root: string, entry: CheckEntry) => BuiltinResult

/** Builtin checks by name. Add new in-process checks here and register them in `checks.json`. */
export const builtins: Readonly<Record<string, Builtin>> = {
  /** Fails when any ceiling declared in the entry's `ratchet` is exceeded by its measurement. */
  ratchet: (root, entry) => {
    const rows = evaluateRatchets(root, [entry])
    const over = rows.filter((r) => r.measured > r.old)
    const lines = rows.map(
      (r) => `${r.constant}: measured ${r.measured}, ceiling ${r.old}${r.measured > r.old ? " (OVER)" : ""}`,
    )
    return { ok: over.length === 0, output: lines.join("\n") }
  },
}
