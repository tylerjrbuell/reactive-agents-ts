import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** A measurer: current value per ceiling key. Gets the ceiling file text for ledger-style files. */
export type Measure = (root: string, ceilingText: string) => ReadonlyMap<string, number>

/** All files under `dir` accepted by `keep`, sorted; skips `node_modules` and `dist`. */
export function walk(dir: string, keep: (path: string) => boolean): readonly string[] {
  const out: string[] = []
  const visit = (d: string): void => {
    if (!existsSync(d)) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue
      const p = join(d, e.name)
      if (e.isDirectory()) visit(p)
      else if (e.isFile() && keep(p)) out.push(p)
    }
  }
  visit(dir)
  return out.sort()
}

const isProdSource = (p: string): boolean =>
  p.includes("/src/") && p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".spec.ts")

function countMatches(files: readonly string[], re: RegExp): number {
  let n = 0
  for (const f of files) n += (readFileSync(f, "utf8").match(re) ?? []).length
  return n
}

function newlines(file: string): number {
  return (readFileSync(file, "utf8").match(/\n/g) ?? []).length
}

function packageDirs(root: string): readonly string[] {
  const dir = join(root, "packages")
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function countAsUnknownAs(files: readonly string[]): number {
  let n = 0
  for (const f of files) {
    if (f.endsWith(".d.ts")) continue
    for (const raw of readFileSync(f, "utf8").split("\n")) {
      const t = raw.trim()
      if (t.startsWith("*") || t.startsWith("//")) continue
      if (raw.includes("as unknown as")) n++
    }
  }
  return n
}

/** Measurers by name, referenced from `checks.json` ratchets. */
export const measures: Readonly<Record<string, Measure>> = {
  "new-error-sites": (root) =>
    new Map([["STRING_ERRORS_BASELINE", countMatches(walk(join(root, "packages"), isProdSource), /new Error\(/g)]]),
  "instanceof-error-sites": (root) =>
    new Map([
      ["INSTANCEOF_BASELINE", countMatches(walk(join(root, "packages"), isProdSource), /instanceof (?:Error|[A-Za-z]*Error)/g)],
    ]),
  "as-unknown-as-src": (root) => {
    const files = packageDirs(root).flatMap((p) => walk(join(root, "packages", p, "src"), (f) => f.endsWith(".ts")))
    return new Map([["CEILING", countAsUnknownAs(files)]])
  },
  "as-unknown-as-tests": (root) => {
    const files = packageDirs(root).flatMap((p) => walk(join(root, "packages", p, "tests"), (f) => f.endsWith(".ts")))
    return new Map([["TESTS_CEILING", countAsUnknownAs(files)]])
  },
  "file-size": (root, text) => {
    const out = new Map<string, number>()
    for (const m of text.matchAll(/"([^"\s:]+\.ts):(\d+)"/g)) {
      const rel = m[1] as string
      const p = join(root, "packages", rel)
      if (existsSync(p)) out.set(rel, newlines(p))
    }
    return out
  },
  "type-escape-hatches": (root) => {
    const re = /\bas any\b|@ts-ignore|@ts-expect-error/
    const out = new Map<string, number>()
    for (const p of packageDirs(root)) {
      const files = walk(join(root, "packages", p, "src"), (f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      let n = 0
      for (const f of files) for (const l of readFileSync(f, "utf8").split("\n")) if (re.test(l)) n++
      if (n > 0) out.set(p, n)
    }
    return out
  },
}
