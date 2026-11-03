import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { matchesGlob } from "./glob.ts"

/** Where a check runs. */
export type Stage = "hook" | "pre-commit" | "ci"

const STAGES: readonly Stage[] = ["hook", "pre-commit", "ci"]
const DAY_MS = 86_400_000
/** Days past `reviewBy` before an expired entry fails `repo check`. */
export const EXPIRY_GRACE_DAYS = 30

/** A ratchet: a numeric ceiling stored in `file` that may only shrink to the measured value. */
export interface Ratchet {
  /** Repo-relative file holding the ceiling. */
  file: string
  /** Ceiling name inside `file`, or `*` for every key the measurer reports. */
  constant: string
  /** Name of a measurer in `lib/measures.ts`. */
  measure: string
}

/** One registered check. */
export interface CheckEntry {
  id: string
  /** `scripts/check-*.sh` or `builtin:<name>`. */
  script: string
  scope: readonly string[]
  stages: readonly Stage[]
  /** Ceilings this check pins; `repo ratchet` tightens them. */
  ratchet?: readonly Ratchet[]
  owner: string
  /** ISO date; past it the entry warns, 30 days later `repo check` fails. */
  reviewBy: string
}

/** Path of a manifest file under the repo root. */
export function manifestPath(root: string, name: string): string {
  return join(root, "tools", "repo", name)
}

/** Read a manifest, enforcing `schemaVersion: 1`. Throws naming the file. */
export function readManifest(root: string, name: string): Record<string, unknown> {
  const path = manifestPath(root, name)
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error(`${name}: expected a JSON object`)
  const doc = raw as Record<string, unknown>
  if (doc.schemaVersion !== 1)
    throw new Error(`${name}: schemaVersion must be 1 (got ${JSON.stringify(doc.schemaVersion)})`)
  return doc
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`checks.json: ${what} must be a non-empty string`)
  return v
}

function strList(v: unknown, what: string): readonly string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error(`checks.json: ${what} must be a string array`)
  return v as string[]
}

function parseRatchet(v: unknown, id: string): readonly Ratchet[] {
  if (!Array.isArray(v)) throw new Error(`checks.json: ${id}.ratchet must be an array`)
  return v.map((r: unknown, i) => {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>
    const w = `${id}.ratchet[${i}]`
    return { file: str(o.file, `${w}.file`), constant: str(o.constant, `${w}.constant`), measure: str(o.measure, `${w}.measure`) }
  })
}

/** Load and validate `tools/repo/checks.json`. */
export function loadChecks(root: string): readonly CheckEntry[] {
  const doc = readManifest(root, "checks.json")
  if (!Array.isArray(doc.checks)) throw new Error("checks.json: `checks` must be an array")
  const seen = new Set<string>()
  return doc.checks.map((e: unknown, i) => {
    const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>
    const id = str(o.id, `checks[${i}].id`)
    if (seen.has(id)) throw new Error(`checks.json: duplicate id ${id}`)
    seen.add(id)
    const stages = strList(o.stages, `${id}.stages`)
    for (const s of stages)
      if (!STAGES.includes(s as Stage)) throw new Error(`checks.json: ${id} has unknown stage ${s}`)
    const reviewBy = str(o.reviewBy, `${id}.reviewBy`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw new Error(`checks.json: ${id}.reviewBy must be YYYY-MM-DD`)
    const entry: CheckEntry = {
      id,
      script: str(o.script, `${id}.script`),
      scope: strList(o.scope, `${id}.scope`),
      stages: stages as Stage[],
      owner: str(o.owner, `${id}.owner`),
      reviewBy,
      ...(o.ratchet === undefined ? {} : { ratchet: parseRatchet(o.ratchet, id) }),
    }
    return entry
  })
}

/** Checks for `stage` with at least one changed file in scope. */
export function selectChecks(
  checks: readonly CheckEntry[],
  changed: readonly string[],
  stage: Stage,
): readonly CheckEntry[] {
  return checks.filter(
    (c) => c.stages.includes(stage) && changed.some((f) => c.scope.some((g) => matchesGlob(f, g))),
  )
}

/** `scripts/check-*.sh` files on disk (repo-relative, sorted). */
export function checkScriptsOnDisk(root: string): readonly string[] {
  const dir = join(root, "scripts")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith("check-") && f.endsWith(".sh"))
    .sort()
    .map((f) => `scripts/${f}`)
}

/** Registry mismatches: scripts with no entry, and entries whose script file is missing. */
export function registryProblems(
  root: string,
  checks: readonly CheckEntry[],
): { unregistered: readonly string[]; missing: readonly string[] } {
  const registered = new Set(checks.map((c) => c.script))
  const unregistered = checkScriptsOnDisk(root).filter((s) => !registered.has(s))
  const missing = checks
    .filter((c) => !c.script.startsWith("builtin:") && !existsSync(join(root, c.script)))
    .map((c) => c.script)
  return { unregistered, missing }
}

function daysBetween(fromIso: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS)
}

/** Entries past `reviewBy` (warn) and past `reviewBy` + 30 days (fail). `today` is ISO `YYYY-MM-DD`. */
export function expiry(
  checks: readonly CheckEntry[],
  today: string,
): { warn: readonly string[]; fail: readonly string[] } {
  const warn: string[] = []
  const fail: string[] = []
  for (const c of checks) {
    const late = daysBetween(c.reviewBy, today)
    if (late > EXPIRY_GRACE_DAYS) fail.push(c.id)
    else if (late > 0) warn.push(c.id)
  }
  return { warn, fail }
}
