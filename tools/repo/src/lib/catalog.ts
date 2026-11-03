import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { CheckEntry } from "./manifest.ts"
import { readManifest } from "./manifest.ts"

/** What a catalogued script is for. Order is the `help --all` heading order. */
export type ScriptKind = "check" | "release" | "build" | "docs" | "test-support" | "research" | "ops"

/** Kinds in display order. */
export const SCRIPT_KINDS: readonly ScriptKind[] = ["check", "release", "build", "docs", "test-support", "research", "ops"]

/** One runnable thing: a tracked file (`path`) or a root `package.json` script (`script`). */
export interface CatalogEntry {
  id: string
  path?: string
  script?: string
  kind: ScriptKind
  /** At most 80 characters. */
  summary: string
  /** Command that runs it. */
  invoke: string
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) throw new Error(`catalog.json: ${what} must be a non-empty string`)
  return v
}

/** Load and validate `tools/repo/catalog.json`. */
export function loadCatalog(root: string): readonly CatalogEntry[] {
  const doc = readManifest(root, "catalog.json")
  if (!Array.isArray(doc.entries)) throw new Error("catalog.json: `entries` must be an array")
  const seen = new Set<string>()
  return doc.entries.map((e: unknown, i) => {
    const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>
    const id = str(o.id, `entries[${i}].id`)
    if (seen.has(id)) throw new Error(`catalog.json: duplicate id ${id}`)
    seen.add(id)
    const kind = str(o.kind, `${id}.kind`)
    if (!SCRIPT_KINDS.includes(kind as ScriptKind)) throw new Error(`catalog.json: ${id} has unknown kind ${kind}`)
    const summary = str(o.summary, `${id}.summary`)
    if (summary.length > 80) throw new Error(`catalog.json: ${id}.summary exceeds 80 chars`)
    const hasPath = o.path !== undefined
    const hasScript = o.script !== undefined
    if (hasPath === hasScript) throw new Error(`catalog.json: ${id} needs exactly one of path or script`)
    return {
      id,
      ...(hasPath ? { path: str(o.path, `${id}.path`) } : {}),
      ...(hasScript ? { script: str(o.script, `${id}.script`) } : {}),
      kind: kind as ScriptKind,
      summary,
      invoke: str(o.invoke, `${id}.invoke`),
    }
  })
}

/**
 * Scope of the coverage rule: files under `scripts/`, `.agents/skills/<s>/scripts/`,
 * `packages/<p>/scripts/`, `apps/<a>/scripts/` (recursive), plus every ROOT `package.json`
 * script name. Package-level scripts and CI inline `run:` blocks are intentionally NOT
 * required; they are scoped to their own package or workflow.
 */
const SCOPE = /^(scripts\/|\.agents\/skills\/[^/]+\/scripts\/|(packages|apps)\/[^/]+\/scripts\/)/

function walk(root: string, dir: string, out: string[]): void {
  const abs = join(root, dir)
  if (!existsSync(abs)) return
  for (const name of readdirSync(abs).sort()) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out)
    else out.push(rel)
  }
}

function inScopeFiles(root: string): readonly string[] {
  if (existsSync(join(root, ".git"))) {
    const listed = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return listed.split("\n").filter((f) => SCOPE.test(f))
  }
  // Fixture roots without git: walk the same four anchors.
  const out: string[] = []
  walk(root, "scripts", out)
  for (const top of [".agents/skills", "packages", "apps"]) {
    const abs = join(root, top)
    if (!existsSync(abs)) continue
    for (const d of readdirSync(abs).sort()) walk(root, `${top}/${d}/scripts`, out)
  }
  return out
}

function rootScripts(root: string): readonly string[] {
  const file = join(root, "package.json")
  if (!existsSync(file)) return []
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> }
  return Object.keys(pkg.scripts ?? {})
}

/**
 * Runnable things in scope that no catalog entry or registered check covers, sorted.
 * Files are repo-relative paths; root scripts appear as `package.json#<name>`.
 */
export function uncatalogued(
  root: string,
  catalog: readonly CatalogEntry[],
  checks: readonly CheckEntry[],
): readonly string[] {
  const paths = new Set<string>([...catalog.flatMap((e) => (e.path ? [e.path] : [])), ...checks.map((c) => c.script)])
  const scripts = new Set(catalog.flatMap((e) => (e.script ? [e.script] : [])))
  const missing = [
    ...inScopeFiles(root).filter((f) => !paths.has(f)),
    ...rootScripts(root).filter((n) => !scripts.has(n)).map((n) => `package.json#${n}`),
  ]
  return missing.sort()
}

/** Catalog entries pointing at a file or root script that no longer exists, sorted by id. */
export function staleEntries(root: string, catalog: readonly CatalogEntry[]): readonly string[] {
  const scripts = new Set(rootScripts(root))
  return catalog
    .filter((e) => (e.path ? !existsSync(join(root, e.path)) : !scripts.has(e.script as string)))
    .map((e) => e.id)
    .sort()
}
