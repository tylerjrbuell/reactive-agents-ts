import { matchesGlob } from "./glob.ts"
import { readManifest } from "./manifest.ts"
import { trackedFiles } from "./tracked-files.ts"

/**
 * One file-placement rule, loaded from `tools/repo/placement.json`. All policy is data.
 *
 * A path violates the rule when it is in `scope` and not `exempt`, and any of these holds:
 * it matches a `deny` glob; `allow` is non-empty and it matches none of them; `naming` is set
 * and the basename does not match that regex.
 */
export interface PlacementRule {
  id: string
  /** Word an agent can ask about: `bun run repo place --kind <kind>`. */
  kind: string
  /** Globs the rule applies to (default: every path). */
  scope?: readonly string[]
  /** Globs never evaluated (default: none). */
  exempt?: readonly string[]
  /** Globs a path in scope must match; empty = no constraint. */
  allow: readonly string[]
  /** Globs a path in scope must not match. */
  deny?: readonly string[]
  /** Regex source the basename must match. */
  naming?: string
  /** Human-readable correct location. */
  canonical: string
  reason: string
  owner: string
  /** ISO date; see `manifest-expiry`. */
  reviewBy: string
  examples: { ok: readonly string[]; bad: readonly string[] }
}

/** A known pre-existing violation, tolerated until fixed. The list may only shrink. */
export interface Grandfathered {
  path: string
  reason: string
  /** ISO date; see `manifest-expiry`. */
  reviewBy: string
}

/** Result of placing one path. */
export type Placement = { ok: true } | { ok: false; ruleId: string; reason: string; canonical: string }

const anyGlob = (path: string, globs: readonly string[]): boolean => globs.some((g) => matchesGlob(path, g))

/** Does `path` (repo-relative, `/`-separated) violate this one rule? */
export function violates(path: string, rule: PlacementRule): boolean {
  if (rule.scope !== undefined && !anyGlob(path, rule.scope)) return false
  if (rule.exempt !== undefined && anyGlob(path, rule.exempt)) return false
  if (rule.deny !== undefined && anyGlob(path, rule.deny)) return true
  if (rule.allow.length > 0 && !anyGlob(path, rule.allow)) return true
  if (rule.naming !== undefined) return !new RegExp(rule.naming).test(path.slice(path.lastIndexOf("/") + 1))
  return false
}

/** Normalise to a repo-relative `/` path with no leading `./`. */
function clean(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "")
}

/** First rule `path` violates, or ok. Generic engine: no rule logic lives here. */
export function placeFile(path: string, rules: readonly PlacementRule[]): Placement {
  const p = clean(path)
  for (const r of rules)
    if (violates(p, r)) return { ok: false, ruleId: r.id, reason: r.reason, canonical: r.canonical }
  return { ok: true }
}

/** Every tracked (or untracked, non-ignored) file that violates a rule, with the first rule it breaks. */
export function auditTracked(root: string, rules: readonly PlacementRule[]): readonly { path: string; ruleId: string }[] {
  const out: { path: string; ruleId: string }[] = []
  for (const path of trackedFiles(root)) {
    const v = placeFile(path, rules)
    if (!v.ok) out.push({ path, ruleId: v.ruleId })
  }
  return out
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`placement.json: ${what} must be a non-empty string`)
  return v
}

function strs(v: unknown, what: string): readonly string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`placement.json: ${what} must be a string array`)
  return v as string[]
}

function date(v: unknown, what: string): string {
  const s = str(v, what)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`placement.json: ${what} must be YYYY-MM-DD`)
  return s
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}
}

/** Load and shape-check `tools/repo/placement.json`. Throws naming the problem. */
export function loadPlacement(root: string): { rules: readonly PlacementRule[]; grandfathered: readonly Grandfathered[] } {
  const doc = readManifest(root, "placement.json")
  if (!Array.isArray(doc.rules)) throw new Error("placement.json: `rules` must be an array")
  if (!Array.isArray(doc.grandfathered)) throw new Error("placement.json: `grandfathered` must be an array")
  const rules = doc.rules.map((r: unknown, i): PlacementRule => {
    const o = obj(r)
    const id = str(o.id, `rules[${i}].id`)
    const ex = obj(o.examples)
    const naming = o.naming === undefined ? undefined : str(o.naming, `${id}.naming`)
    if (naming !== undefined) {
      try {
        new RegExp(naming)
      } catch {
        throw new Error(`placement.json: ${id}.naming is not a valid regex`)
      }
    }
    return {
      id,
      kind: str(o.kind, `${id}.kind`),
      ...(o.scope === undefined ? {} : { scope: strs(o.scope, `${id}.scope`) }),
      ...(o.exempt === undefined ? {} : { exempt: strs(o.exempt, `${id}.exempt`) }),
      allow: o.allow === undefined ? [] : strs(o.allow, `${id}.allow`),
      ...(o.deny === undefined ? {} : { deny: strs(o.deny, `${id}.deny`) }),
      ...(naming === undefined ? {} : { naming }),
      canonical: str(o.canonical, `${id}.canonical`),
      reason: str(o.reason, `${id}.reason`),
      owner: str(o.owner, `${id}.owner`),
      reviewBy: date(o.reviewBy, `${id}.reviewBy`),
      examples: { ok: strs(ex.ok, `${id}.examples.ok`), bad: strs(ex.bad, `${id}.examples.bad`) },
    }
  })
  const grandfathered = doc.grandfathered.map((g: unknown, i): Grandfathered => {
    const o = obj(g)
    return {
      path: str(o.path, `grandfathered[${i}].path`),
      reason: str(o.reason, `grandfathered[${i}].reason`),
      reviewBy: date(o.reviewBy, `grandfathered[${i}].reviewBy`),
    }
  })
  return { rules, grandfathered }
}

/** Self-check: unique ids, >=2 ok and >=2 bad examples per rule, every example behaves as labelled. */
export function placementProblems(rules: readonly PlacementRule[]): readonly { message: string; next: string }[] {
  const out: { message: string; next: string }[] = []
  const seen = new Set<string>()
  for (const r of rules) {
    const at = `tools/repo/placement.json#${r.id}`
    if (seen.has(r.id)) out.push({ message: `duplicate rule id ${r.id}`, next: `rename a duplicate ${at}` })
    seen.add(r.id)
    if (r.examples.ok.length < 2 || r.examples.bad.length < 2)
      out.push({ message: `${r.id}: needs >=2 ok and >=2 bad examples`, next: `add examples to ${at}` })
    for (const b of r.examples.bad)
      if (!violates(clean(b), r)) out.push({ message: `${r.id}: bad example not rejected: ${b}`, next: `fix examples or rule in ${at}` })
    for (const g of r.examples.ok) {
      const v = placeFile(g, rules)
      if (!v.ok) out.push({ message: `${r.id}: ok example rejected by ${v.ruleId}: ${g}`, next: `fix examples or rule in ${at}` })
    }
  }
  return out
}

/** Outcome of comparing the real audit with the grandfather list. */
export interface PlacementAudit {
  /** Violations not grandfathered. */
  fresh: readonly { path: string; ruleId: string }[]
  /** Grandfathered paths that no longer violate or no longer exist. */
  stale: readonly string[]
  /** Violations tolerated by the grandfather list. */
  tolerated: number
}

/** Ratchet audit: fresh violations and stale grandfather entries. */
export function placementAudit(root: string, rules: readonly PlacementRule[], grandfathered: readonly Grandfathered[]): PlacementAudit {
  const bad = auditTracked(root, rules)
  const badPaths = new Set(bad.map((b) => b.path))
  const gf = new Set(grandfathered.map((g) => g.path))
  return {
    fresh: bad.filter((b) => !gf.has(b.path)),
    stale: grandfathered.map((g) => g.path).filter((p) => !badPaths.has(p)),
    tolerated: bad.filter((b) => gf.has(b.path)).length,
  }
}
