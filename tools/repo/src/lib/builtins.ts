import type { CheckEntry } from "./manifest.ts"
import { loadCatalog, staleEntries, uncatalogued } from "./catalog.ts"
import { loadChecks } from "./manifest.ts"
import { docCommandDrift } from "./doc-drift.ts"
import { loadRules, ruleProblems } from "./hook-rules.ts"
import { manifestHealth } from "./manifest-expiry.ts"
import { loadOwnership, nameAll, ownershipProblems } from "./ownership.ts"
import { evaluateRatchets, isViolation } from "./ratchet.ts"

/** Outcome of a builtin check. */
export interface BuiltinResult {
  ok: boolean
  output: string
  /** Command to run next, replacing the generic `check --only` hint on failure. */
  next?: string
}

/** Inputs a builtin may need beyond the repo root; injected at the CLI edge so builtins stay pure. */
export interface BuiltinCtx {
  /** ISO `YYYY-MM-DD`. */
  today: string
  /** Registered `repo` command names. */
  commandNames: readonly string[]
}

/** A builtin check, referenced from `checks.json` as `builtin:<name>`. */
export type Builtin = (root: string, entry: CheckEntry, ctx: BuiltinCtx) => BuiltinResult

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
        ? `add ${nameAll(missing)} to tools/repo/catalog.json (kind + summary)`
        : `remove ${nameAll(stale)} from tools/repo/catalog.json`
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

  /** Fails when a packages/* or apps/* dir has no ownership row, or a row is malformed. */
  "ownership-coverage": (root) => {
    const entries = loadOwnership(root)
    const problems = ownershipProblems(root, entries, new Set(loadChecks(root).map((c) => c.id)))
    if (problems.length === 0) return { ok: true, output: `ownership covers every workspace dir (${entries.length} rows)` }
    return { ok: false, output: problems.map((p) => p.message).join("\n"), next: (problems[0] as { next: string }).next }
  },

  /** Fails when a doc says `bun run repo <word>` and `<word>` is not a registered command. */
  "doc-command-drift": (root, _entry, ctx) => {
    const hits = docCommandDrift(root, ctx.commandNames)
    if (hits.length === 0) return { ok: true, output: "doc command mentions match registered commands" }
    return {
      ok: false,
      output: hits.map((h) => `${h.file}:${h.line}: unknown command "${h.command}"`).join("\n"),
      next: "rename to an existing command (bun run repo help)",
    }
  },

  /** Fails when rules.json is malformed, or a rule lacks >=2 allow/deny examples or an example misbehaves. */
  "rules-valid": (root) => {
    try {
      const rules = loadRules(root)
      const problems = ruleProblems(rules)
      if (problems.length === 0) return { ok: true, output: `${rules.length} hook rules verified by their examples` }
      return { ok: false, output: problems.map((p) => p.message).join("\n"), next: (problems[0] as { next: string }).next }
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e), next: "fix tools/repo/rules.json" }
    }
  },

  /** Fails on a bad/missing `schemaVersion` in any manifest or an entry 30+ days past `reviewBy`; warns before that. */
  "manifest-expiry": (root, _entry, ctx) => {
    const h = manifestHealth(root, ctx.today)
    const lines = [
      ...h.schemaErrors,
      ...h.fail.map((x) => `past reviewBy + 30 days: ${x}`),
      ...h.warn.map((x) => `warn: past reviewBy: ${x}`),
    ]
    if (h.schemaErrors.length === 0 && h.fail.length === 0)
      return { ok: true, output: lines.length > 0 ? lines.join("\n") : "manifests current" }
    return {
      ok: false,
      output: lines.join("\n"),
      next: h.schemaErrors.length > 0 ? "set schemaVersion to 1 in the named manifest" : "bump reviewBy in the named manifest after reviewing the entry",
    }
  },
}
