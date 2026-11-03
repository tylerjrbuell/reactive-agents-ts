import type { CheckEntry } from "./manifest.ts"
import { evaluateRatchets, isViolation } from "./ratchet.ts"

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
    const lines = rows.map((r) =>
      r.old === undefined
        ? `${r.constant}: measured ${r.measured}, unpinned (no ceiling in ${r.file})`
        : `${r.constant}: measured ${r.measured}, ceiling ${r.old}${r.measured > r.old ? " (OVER)" : ""}`,
    )
    return { ok: !rows.some(isViolation), output: lines.join("\n") }
  },
}
