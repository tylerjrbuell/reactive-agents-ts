import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, extname, join, posix, relative } from "node:path"
import ts from "typescript"

/**
 * Gate `shipped-assets`: a published package's `src` must not load a sibling file at run time that its
 * build does not ship.
 *
 * Repo tests resolve `src`, so `new URL("./x.ts", import.meta.url)` or `join(dirname(...import.meta.url),
 * "assets")` always works there. From an npm install the code runs bundled in `dist/<entry>.js`, where the
 * same relative path names `dist/x.ts` or `dist/assets`, which exist only if the build emits them.
 * Incident (published 0.19.0): reasoning spawned `./sandbox-worker.ts`, dist had no worker, and Code
 * Action failed for every npm user with `ModuleNotFound ... dist/sandbox-worker.ts`.
 *
 * Static and approximate by design: it recognises `new URL(<rel>, <module url>)` and
 * `join|resolve(<module dir>, "<seg>", ...)` where the module anchor is `import.meta.*` (directly, through
 * `dirname`/`fileURLToPath`/`new URL(..).pathname`, or through a variable or parameter default holding one).
 * Relative paths come from string literals, conditionals, `const` arrays and `for..of` over them. A load is
 * fine when ANY of its candidates (one call, or sibling calls in one array/argument list, e.g. a
 * dist-then-src fallback list) resolves from `dist/` to something shipped: a tsup entry output
 * (`dist/<entry>.js`), a path under a non-`dist` `files` entry that exists in the repo, or `package.json`.
 */

/** One module-relative load site that the dist layout cannot satisfy. */
export interface UnshippedLoad {
  /** Repo-relative source file. */
  file: string
  line: number
  /** The candidate paths as written, relative to the module. */
  candidates: readonly string[]
  /** Each candidate resolved against `dist/`, package-relative. */
  resolved: readonly string[]
  /** Package-relative directory of the published package. */
  pkg: string
}

/** A known violation awaiting its owner's fix; listed as a warning until `until`, then it fails. */
export interface KnownUnshipped {
  file: string
  /** One of the `resolved` targets, package-relative. */
  target: string
  owner: string
  /** ISO date. */
  until: string
  why: string
}

/** Pre-existing violations found when the gate landed (2026-11-20). Remove an entry when its fix lands. */
export const KNOWN_UNSHIPPED: readonly KnownUnshipped[] = [
  {
    file: "packages/tools/src/execution/docker-sandbox.ts",
    target: "dist/sandbox-image/seccomp-sandbox.json",
    owner: "tools-warden",
    until: "2026-12-20",
    why: "npm installs lack the seccomp profile; the Docker sandbox silently runs without seccomp",
  },
  {
    file: "packages/tools/src/execution/docker-sandbox.ts",
    target: "dist/sandbox-image",
    owner: "tools-warden",
    until: "2026-12-20",
    why: "npm installs lack the Dockerfiles; buildSandboxImage() returns false",
  },
  {
    file: "packages/testing/src/gate/registry.ts",
    target: "dist/scenarios",
    owner: "core-warden",
    until: "2026-12-20",
    why: "discoverScenarios() (exported, @unstable) reads a scenarios dir dist does not have",
  },
  {
    file: "packages/llm-provider/src/calibration-runner.ts",
    target: "dist/calibrations",
    owner: "provider-warden",
    until: "2026-12-20",
    why: "commitCalibration() default dir is a WRITE target inside node_modules/dist; pick a user dir or require `dir`",
  },
]

/** Split violations into new (fail), known-and-current (warn), known-and-expired (fail); also known entries that no longer match (stale, fail). */
export function triage(
  loads: readonly UnshippedLoad[],
  today: string,
  known: readonly KnownUnshipped[] = KNOWN_UNSHIPPED,
): { fresh: UnshippedLoad[]; warned: { load: UnshippedLoad; known: KnownUnshipped }[]; expired: { load: UnshippedLoad; known: KnownUnshipped }[]; stale: KnownUnshipped[] } {
  const fresh: UnshippedLoad[] = []
  const warned: { load: UnshippedLoad; known: KnownUnshipped }[] = []
  const expired: { load: UnshippedLoad; known: KnownUnshipped }[] = []
  const used = new Set<KnownUnshipped>()
  for (const load of loads) {
    const k = known.find((x) => x.file === load.file && load.resolved.includes(x.target))
    if (k === undefined) fresh.push(load)
    else {
      used.add(k)
      ;(today > k.until ? expired : warned).push({ load, known: k })
    }
  }
  return { fresh, warned, expired, stale: known.filter((k) => !used.has(k)) }
}

const ANCHOR_PROPS = new Set(["url", "dir", "dirname", "filename", "path"])
const DIR_FNS = new Set(["dirname", "fileURLToPath"])
const JOIN_FNS = new Set(["join", "resolve"])

function calleeName(e: ts.Expression): string | undefined {
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x)) x = x.expression
  return x
}

/** Declarations by name, file-wide (shadowing is ignored: good enough for a lint over module-level helpers). */
function declarations(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>()
  const visit = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name) && !out.has(n.name.text)) out.set(n.name.text, n)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** The initializer an identifier stands for: `const x = <init>`, `(x = <default>)`, or `for (const x of <iter>)`. */
function bound(id: ts.Identifier, decls: Map<string, ts.Node>): { init: ts.Expression; iterated: boolean } | undefined {
  const d = decls.get(id.text)
  if (d === undefined) return undefined
  if (ts.isParameter(d)) return d.initializer ? { init: d.initializer, iterated: false } : undefined
  if (!ts.isVariableDeclaration(d)) return undefined
  if (d.initializer) return { init: d.initializer, iterated: false }
  const list = d.parent
  const stmt = ts.isVariableDeclarationList(list) ? list.parent : undefined
  if (stmt && ts.isForOfStatement(stmt)) return { init: stmt.expression, iterated: true }
  return undefined
}

/** True when `e` denotes this module's file URL/path or directory. */
function isAnchor(e: ts.Expression, decls: Map<string, ts.Node>, depth = 0): boolean {
  if (depth > 6) return false
  const x = unwrap(e)
  if (ts.isPropertyAccessExpression(x)) {
    if (ts.isMetaProperty(x.expression) && x.expression.keywordToken === ts.SyntaxKind.ImportKeyword) return ANCHOR_PROPS.has(x.name.text)
    if (x.name.text === "pathname" || x.name.text === "href") return isAnchor(x.expression, decls, depth + 1)
    return false
  }
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "URL")
    return x.arguments?.length === 1 && isAnchor(x.arguments[0] as ts.Expression, decls, depth + 1)
  if (ts.isCallExpression(x)) {
    const name = calleeName(x.expression)
    return name !== undefined && DIR_FNS.has(name) && x.arguments.length === 1 && isAnchor(x.arguments[0] as ts.Expression, decls, depth + 1)
  }
  if (ts.isIdentifier(x)) {
    const b = bound(x, decls)
    return b !== undefined && !b.iterated && isAnchor(b.init, decls, depth + 1)
  }
  return false
}

/** String values `e` can take, or `[]` when not statically known. */
function literals(e: ts.Expression, decls: Map<string, ts.Node>, depth = 0): string[] {
  if (depth > 6) return []
  const x = unwrap(e)
  if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) return [x.text]
  if (ts.isConditionalExpression(x)) return [...literals(x.whenTrue, decls, depth + 1), ...literals(x.whenFalse, decls, depth + 1)]
  if (ts.isArrayLiteralExpression(x)) return x.elements.flatMap((el) => literals(el, decls, depth + 1))
  if (ts.isIdentifier(x)) {
    const b = bound(x, decls)
    if (b === undefined) return []
    const vals = literals(b.init, decls, depth + 1)
    return b.iterated || !ts.isArrayLiteralExpression(unwrap(b.init)) ? vals : []
  }
  return []
}

interface Site {
  node: ts.Node
  /** Module-relative paths (URL form for `new URL`, segments joined for `join`). */
  rels: string[]
  /** `join` stopped at a non-literal segment: the path is a directory prefix. */
  prefix: boolean
}

/** Module-relative load sites in one source file. */
export function loadSites(sf: ts.SourceFile): Site[] {
  const decls = declarations(sf)
  const sites: Site[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "URL" && n.arguments?.length === 2) {
      const [rel, base] = n.arguments as unknown as [ts.Expression, ts.Expression]
      if (isAnchor(base, decls)) {
        const rels = literals(rel, decls).filter((s) => !/^[a-z][a-z0-9+.-]*:/i.test(s))
        if (rels.length > 0) sites.push({ node: n, rels, prefix: false })
      }
    } else if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression)
      const [base, ...rest] = n.arguments
      if (name !== undefined && JOIN_FNS.has(name) && base !== undefined && isAnchor(base, decls)) {
        const segs: string[] = []
        let prefix = false
        for (const a of rest) {
          const u = unwrap(a)
          if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) segs.push(u.text)
          else {
            prefix = true
            break
          }
        }
        // The anchor may be the module FILE (`new URL(import.meta.url).pathname`), not its directory;
        // `join(file, "..", x)` is rare, so treat the anchor as the directory either way.
        if (segs.length > 0) sites.push({ node: n, rels: [segs.join("/")], prefix })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return sites
}

/** Sibling sites in one array literal or one call's argument list form a fallback group. */
function groupKey(s: Site): ts.Node {
  const p = s.node.parent
  return p !== undefined && (ts.isArrayLiteralExpression(p) || ts.isCallExpression(p)) && p !== s.node ? p : s.node
}

// ─── What the build ships ───

function parseTs(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function entryKeysOfObject(obj: ts.ObjectLiteralExpression, cfgPath: string, seen: Set<string>): string[] | undefined {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) || p.name.getText() !== "entry") continue
    const v = unwrap(p.initializer)
    if (ts.isObjectLiteralExpression(v))
      return v.properties.flatMap((q) => (ts.isPropertyAssignment(q) ? [q.name.getText().replace(/^["']|["']$/g, "")] : []))
    if (ts.isArrayLiteralExpression(v))
      return v.elements.flatMap((el) => (ts.isStringLiteral(el) ? [basename(el.text, extname(el.text))] : []))
    return undefined
  }
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression)) {
      const keys = importedConfigEntries(p.expression.text, cfgPath, seen)
      if (keys !== undefined) return keys
    }
  }
  return undefined
}

function importedConfigEntries(local: string, cfgPath: string, seen: Set<string>): string[] | undefined {
  const sf = parseTs(cfgPath)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.name?.text !== local || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = join(dirname(cfgPath), st.moduleSpecifier.text)
    const file = [spec, spec.replace(/\.js$/, ".ts"), `${spec}.ts`].find((f) => existsSync(f) && statSync(f).isFile())
    return file === undefined ? undefined : configEntries(file, seen)
  }
  return undefined
}

/** Entry names a tsup config file declares (following `...base` spreads and `export default base`). */
export function configEntries(cfgPath: string, seen = new Set<string>()): string[] | undefined {
  if (seen.has(cfgPath)) return undefined
  seen.add(cfgPath)
  const sf = parseTs(cfgPath)
  for (const st of sf.statements) {
    if (!ts.isExportAssignment(st)) continue
    let e = unwrap(st.expression)
    if (ts.isCallExpression(e) && e.arguments.length === 1) e = unwrap(e.arguments[0] as ts.Expression)
    if (ts.isObjectLiteralExpression(e)) return entryKeysOfObject(e, cfgPath, seen)
    if (ts.isIdentifier(e)) return importedConfigEntries(e.text, cfgPath, seen)
  }
  return undefined
}

/** `dist/` entry names a package's `build` script emits (each `tsup` invocation; config file or CLI entries). */
export function buildEntries(pkgDir: string, buildScript: string): Set<string> {
  const out = new Set<string>()
  for (const part of buildScript.split(/&&|;/)) {
    const words = part.trim().split(/\s+/)
    const at = words.indexOf("tsup")
    if (at < 0) continue
    const args = words.slice(at + 1)
    const outDir = args.indexOf("--out-dir") >= 0 ? args[args.indexOf("--out-dir") + 1] : "dist"
    if (outDir !== "dist") continue
    const positional = args.filter((a, i) => /\.[mc]?[jt]sx?$/.test(a) && args[i - 1] !== "--config")
    if (positional.length > 0) {
      for (const p of positional) out.add(basename(p, extname(p)))
      continue
    }
    const ci = args.indexOf("--config")
    const cfg = ci >= 0 ? join(pkgDir, args[ci + 1] ?? "") : ["tsup.config.ts", "tsup.config.js", "tsup.config.mjs"].map((f) => join(pkgDir, f)).find(existsSync)
    if (cfg === undefined || !existsSync(cfg)) continue
    for (const k of configEntries(cfg) ?? []) out.add(k)
  }
  return out
}

interface Shipping {
  entries: Set<string>
  /** `files` entries other than `dist`, or undefined when the manifest has no `files` (npm ships everything). */
  files: string[] | undefined
}

function ships(pkgAbs: string, target: string, prefix: boolean, s: Shipping): boolean {
  if (target.startsWith("..")) return false
  if (target === "package.json" || /^(README|LICENSE|LICENCE)(\.|$)/i.test(target)) return true
  if (target === "dist" || target.startsWith("dist/")) {
    const rest = target.slice("dist/".length)
    if (prefix) return [...s.entries].some((k) => k.startsWith(`${rest}/`))
    const m = /^(.*)\.(m?js)$/.exec(rest)
    return m !== null && s.entries.has(m[1] as string)
  }
  const listed = s.files === undefined || s.files.some((f) => target === f || target.startsWith(`${f.replace(/\/$/, "")}/`))
  return listed && existsSync(join(pkgAbs, target))
}

function srcFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "tests" && name !== "node_modules") out.push(...srcFiles(p))
    } else if (/\.[mc]?tsx?$/.test(name) && !/\.(test|spec)\.[mc]?tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/** Every module-relative load in published packages' `src` that no candidate of its group ships. */
export function unshippedLoads(root: string): { loads: UnshippedLoad[]; scanned: number; packages: number } {
  const loads: UnshippedLoad[] = []
  let scanned = 0
  let packages = 0
  const pkgsDir = join(root, "packages")
  for (const name of readdirSync(pkgsDir).sort()) {
    const pkgAbs = join(pkgsDir, name)
    const manifest = join(pkgAbs, "package.json")
    if (!existsSync(manifest) || !existsSync(join(pkgAbs, "src"))) continue
    const json = JSON.parse(readFileSync(manifest, "utf8")) as { private?: boolean; files?: unknown; scripts?: Record<string, unknown> }
    const build = json.scripts?.build
    if (json.private === true || typeof build !== "string") continue
    packages++
    const shipping: Shipping = {
      entries: buildEntries(pkgAbs, build),
      files: Array.isArray(json.files) ? json.files.filter((f): f is string => typeof f === "string" && f !== "dist") : undefined,
    }
    for (const file of srcFiles(join(pkgAbs, "src"))) {
      scanned++
      const text = readFileSync(file, "utf8")
      if (!text.includes("import.meta")) continue
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const groups = new Map<ts.Node, { sites: Site[]; ok: boolean }>()
      for (const site of loadSites(sf)) {
        const key = groupKey(site)
        const g = groups.get(key) ?? { sites: [], ok: false }
        g.sites.push(site)
        // Bundled code runs as dist/<entry>.js, so module-relative paths resolve against dist/.
        if (site.rels.some((r) => ships(pkgAbs, posix.normalize(posix.join("dist", r)), site.prefix, shipping))) g.ok = true
        groups.set(key, g)
      }
      for (const g of groups.values()) {
        if (g.ok) continue
        const first = g.sites[0] as Site
        loads.push({
          file: relative(root, file),
          line: sf.getLineAndCharacterOfPosition(first.node.getStart(sf)).line + 1,
          candidates: g.sites.flatMap((s) => s.rels),
          resolved: g.sites.flatMap((s) => s.rels.map((r) => posix.normalize(posix.join("dist", r)))),
          pkg: relative(root, pkgAbs),
        })
      }
    }
  }
  return { loads, scanned, packages }
}
