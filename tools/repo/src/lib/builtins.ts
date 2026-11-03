import type { CheckEntry } from "./manifest.ts"
import { loadCatalog, staleEntries, uncatalogued } from "./catalog.ts"
import { loadChecks } from "./manifest.ts"
import { evaluateRatchets, isViolation } from "./ratchet.ts"

/** Outcome of a builtin check. */
export interface BuiltinResult {
  ok: boolean
  output: string
  /** Command to run next, replacing the generic `check --only` hint on failure. */
  next?: string
}

/** A builtin check, referenced from `checks.json` as `builtin:<name>`. */
export type Builtin = (root: string, entry: CheckEntry) => BuiltinResult

/** Builtin checks by name. Add new in-process checks here and register them in `checks.json`. */
export const builtins: Readonly<Record<string, Builtin>> = {
  /** Fails when a script in catalog scope has no `catalog.json` entry, or an entry points at nothing. */
  "catalog-coverage": (root) => {
    const catalog = loadCatalog(root)
    const missing = uncatalogued(root, catalog, loadChecks(root))
    const stale = staleEntries(root, catalog)
    const lines = [...missing.map((m) => `uncatalogued: ${m}`), ...stale.map((id) => `stale catalog entry: ${id}`)]
    if (lines.length === 0) return { ok: true, output: `catalog covers ${catalog.length} entries` }
    const next =
      missing.length > 0
        ? `add ${missing[0]} to tools/repo/catalog.json (kind + summary)`
        : `remove ${stale[0]} from tools/repo/catalog.json`
    return { ok: false, output: lines.join("\n"), next }
  },

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
