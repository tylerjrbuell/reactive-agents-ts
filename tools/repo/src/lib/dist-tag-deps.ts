import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** Manifest fields whose specifiers bun resolves at install time. */
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

/** A dependency declared with a dist-tag specifier. */
export interface DistTagDep {
  /** Repo-relative manifest path. */
  file: string
  field: (typeof DEP_FIELDS)[number]
  name: string
  spec: string
}

/**
 * The dist-tag a specifier names (`latest`, `next`, `canary`, `beta`, ...), else undefined.
 * Semver ranges (including `*`, `x`, `>=1`), `workspace:`/`file:`/`link:`/git/URL specifiers are not tags.
 * `npm:<pkg>` aliases are checked on their version part; a bare `npm:<pkg>` means `latest`.
 *
 * Why tags and not `*`: bun re-resolves tag specifiers against the registry on `--frozen-lockfile`, so a new
 * publish turns a committed lockfile stale (bun-types 1.4.5, 2026-11-19). A range keeps any locked version
 * that satisfies it.
 */
export function distTag(spec: string): string | undefined {
  let s = spec.trim()
  if (s.startsWith("npm:")) {
    const alias = s.slice(4)
    const at = alias.lastIndexOf("@")
    if (at <= 0) return "latest"
    s = alias.slice(at + 1).trim()
  }
  if (s.length === 0 || s.includes(":") || s.includes("/")) return undefined
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(s)) return undefined
  if (/^[vV]\d/.test(s) || /^[xX](\.[xX*\d]+)*$/.test(s)) return undefined
  return s
}

/** Repo-relative paths of the root manifest and every workspace manifest named by its `workspaces` globs. */
export function workspaceManifests(root: string): string[] {
  const rootJson: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const ws = typeof rootJson === "object" && rootJson !== null ? (rootJson as { workspaces?: unknown }).workspaces : undefined
  const raw = Array.isArray(ws) ? ws : typeof ws === "object" && ws !== null ? (ws as { packages?: unknown }).packages : []
  const patterns = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : []
  const out = new Set<string>(["package.json"])
  for (const p of patterns) {
    if (p.endsWith("/*")) {
      const dir = p.slice(0, -2)
      if (!existsSync(join(root, dir))) continue
      for (const name of readdirSync(join(root, dir)).sort()) {
        const rel = `${dir}/${name}/package.json`
        if (!name.startsWith(".") && existsSync(join(root, rel)) && statSync(join(root, rel)).isFile()) out.add(rel)
      }
    } else if (!p.includes("*")) {
      if (existsSync(join(root, p, "package.json"))) out.add(`${p}/package.json`)
    } else {
      throw new Error(`unsupported workspaces pattern "${p}" in package.json (only "<dir>/*" and literal dirs)`)
    }
  }
  return [...out]
}

/** Every dist-tag dependency in the root and workspace manifests. */
export function distTagDeps(root: string): DistTagDep[] {
  const hits: DistTagDep[] = []
  for (const file of workspaceManifests(root)) {
    const json: unknown = JSON.parse(readFileSync(join(root, file), "utf8"))
    if (typeof json !== "object" || json === null) continue
    for (const field of DEP_FIELDS) {
      const deps = (json as Record<string, unknown>)[field]
      if (typeof deps !== "object" || deps === null) continue
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec === "string" && distTag(spec) !== undefined) hits.push({ file, field, name, spec })
      }
    }
  }
  return hits
}
