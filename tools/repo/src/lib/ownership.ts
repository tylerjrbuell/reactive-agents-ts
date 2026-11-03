import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { matchesGlob } from "./glob.ts"
import { readManifest } from "./manifest.ts"

/** One row of `ownership.json`: who owns files matching `glob`, which gates and docs they touch. */
export interface OwnershipEntry {
  glob: string
  /** Warden name (`.claude/agents/<owner>.md`), or null when no warden owns it. */
  owner: string | null
  /** Why `owner` is null. Required when it is. */
  reason?: string
  /** Check ids from `checks.json`. */
  checks: readonly string[]
  /** Doc paths to update when files here change. */
  docs: readonly string[]
  /** ISO date; past it the row warns, 30 days later `repo check` fails. */
  reviewBy?: string
}

/** What a set of files touches. All lists sorted and deduped. */
export interface ScopeResult {
  owners: readonly string[]
  checks: readonly string[]
  docs: readonly string[]
  /** Files matching no ownership row at all. */
  unowned: readonly string[]
  /** Files covered only by rows with `owner: null`, with the row's reason. */
  noOwner: readonly { file: string; reason: string }[]
}

function strList(v: unknown, what: string): readonly string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`ownership.json: ${what} must be a string array`)
  return v as string[]
}

/** Load `tools/repo/ownership.json` (shape only; semantic problems come from {@link ownershipProblems}). */
export function loadOwnership(root: string): readonly OwnershipEntry[] {
  const doc = readManifest(root, "ownership.json")
  if (!Array.isArray(doc.entries)) throw new Error("ownership.json: `entries` must be an array")
  return doc.entries.map((e: unknown, i) => {
    const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>
    if (typeof o.glob !== "string" || o.glob.length === 0)
      throw new Error(`ownership.json: entries[${i}].glob must be a non-empty string`)
    if (o.owner !== null && typeof o.owner !== "string")
      throw new Error(`ownership.json: ${o.glob}.owner must be a string or null`)
    return {
      glob: o.glob,
      owner: o.owner as string | null,
      ...(typeof o.reason === "string" ? { reason: o.reason } : {}),
      checks: strList(o.checks, `${o.glob}.checks`),
      docs: strList(o.docs, `${o.glob}.docs`),
      ...(typeof o.reviewBy === "string" ? { reviewBy: o.reviewBy } : {}),
    }
  })
}

const uniqSorted = (xs: readonly string[]): readonly string[] => [...new Set(xs)].sort()

/** Union of every matching row's owner, checks and docs; files matching no row are `unowned`. */
export function scopeFiles(files: readonly string[], entries: readonly OwnershipEntry[]): ScopeResult {
  const owners: string[] = []
  const checks: string[] = []
  const docs: string[] = []
  const unowned: string[] = []
  const noOwner: { file: string; reason: string }[] = []
  for (const f of files) {
    const hits = entries.filter((e) => matchesGlob(f, e.glob))
    if (hits.length === 0) unowned.push(f)
    if (hits.length > 0 && hits.every((h) => h.owner === null))
      noOwner.push({ file: f, reason: hits.map((h) => h.reason ?? "").find((x) => x.length > 0) ?? "" })
    for (const h of hits) {
      if (h.owner !== null) owners.push(h.owner)
      checks.push(...h.checks)
      docs.push(...h.docs)
    }
  }
  return { owners: uniqSorted(owners), checks: uniqSorted(checks), docs: uniqSorted(docs), unowned: uniqSorted(unowned), noOwner }
}

/** Directories directly under `packages/` and `apps/`, repo-relative and sorted. */
export function workspaceDirs(root: string): readonly string[] {
  const out: string[] = []
  for (const top of ["packages", "apps"]) {
    const abs = join(root, top)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs).sort())
      if (!name.startsWith(".") && statSync(join(abs, name)).isDirectory()) out.push(`${top}/${name}`)
  }
  return out
}

/** A problem with a message and the command that fixes it. */
export interface Problem {
  message: string
  next: string
}

/** Max names spelled out in a `next:` hint. */
const NEXT_NAME_CAP = 5

/** Join names for a `next:` line: all of them, or the first 5 plus a count. */
export function nameAll(names: readonly string[]): string {
  if (names.length <= NEXT_NAME_CAP) return names.join(" ")
  return `${names.slice(0, NEXT_NAME_CAP).join(" ")} (+${names.length - NEXT_NAME_CAP} more; see output)`
}

/**
 * Semantic problems in the ownership manifest: unowned workspace dirs, null owners without a
 * reason, owners with no `.claude/agents/<owner>.md`, and unknown check ids.
 */
export function ownershipProblems(
  root: string,
  entries: readonly OwnershipEntry[],
  checkIds: ReadonlySet<string>,
): readonly Problem[] {
  const problems: Problem[] = []
  const uncovered = workspaceDirs(root).filter((d) => !entries.some((e) => matchesGlob(`${d}/__probe__`, e.glob)))
  if (uncovered.length > 0)
    problems.push({
      message: uncovered.map((d) => `unowned workspace dir: ${d}`).join("\n"),
      next: `add ${nameAll(uncovered.map((d) => `${d}/**`))} to tools/repo/ownership.json`,
    })
  for (const e of entries) {
    if (e.owner === null && (e.reason ?? "").trim().length === 0)
      problems.push({ message: `${e.glob}: owner is null but reason is empty`, next: `add a reason to ${e.glob} in tools/repo/ownership.json` })
    if (e.owner !== null && !existsSync(join(root, ".claude", "agents", `${e.owner}.md`)))
      problems.push({
        message: `${e.glob}: owner ${e.owner} has no .claude/agents/${e.owner}.md`,
        next: `create .claude/agents/${e.owner}.md or set owner to null with a reason for ${e.glob}`,
      })
    for (const c of e.checks)
      if (!checkIds.has(c))
        problems.push({ message: `${e.glob}: unknown check id ${c}`, next: `fix or remove ${c} in tools/repo/ownership.json` })
  }
  return problems
}
