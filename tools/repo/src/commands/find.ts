import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { loadCatalog } from "../lib/catalog.ts"
import { OUTPUT_CAP } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"
import { trackedFiles } from "../lib/tracked-files.ts"
import { cheapTitle, isStale, mdHeadings, MAX_FILE_BYTES, pageStatus } from "../lib/wiki-index.ts"

/** Where `find` looks. */
export type FindScope = "all" | "wiki" | "code" | "scripts"

/** One search hit. `line` is null for path/title/catalog hits. */
export interface Hit {
  path: string
  line: number | null
  text: string
  score: number
  stale: boolean
}

/** File types searched by `--code` (and `all`). Markdown outside `wiki/` is searched only by `all`. */
const CODE_EXT = new Set(["ts", "tsx", "js", "mjs", "cjs", "json", "sh"])
const SCORE = { exact: 100, name: 90, heading: 70, index: 50, line: 10 } as const
const PER_FILE_LINES = 2
const TEXT_MAX = 100
const NAV_INDEX = "wiki/Development/Repo-Navigation.md"
/** Files whose content lines are routing tables (ownership, catalog) rather than prose or code. */
const ROUTING_FILES = new Set(["tools/repo/ownership.json", "tools/repo/catalog.json"])

const ext = (p: string): string => p.slice(p.lastIndexOf(".") + 1)
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function inScope(path: string, scope: FindScope): boolean {
  const wiki = path.startsWith("wiki/")
  if (wiki) return scope !== "code" && path.endsWith(".md")
  if (scope === "wiki") return false
  return CODE_EXT.has(ext(path)) || (scope === "all" && path.endsWith(".md"))
}

type Matcher = (lowerText: string) => boolean
function makeMatcher(query: string, regex: boolean): Matcher {
  if (regex) {
    const re = new RegExp(query, "i")
    return (s) => re.test(s)
  }
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0)
  return (s) => words.every((w) => s.includes(w))
}

const clip = (s: string): string => {
  const t = s.trim()
  return t.length > TEXT_MAX ? `${t.slice(0, TEXT_MAX - 3)}...` : t
}

function scanFile(root: string, path: string, query: string, match: Matcher, regex: boolean): Hit[] {
  let text: string
  try {
    const abs = join(root, path)
    if (statSync(abs).size > MAX_FILE_BYTES) return []
    const buf = readFileSync(abs)
    if (buf.subarray(0, 4096).includes(0)) return []
    text = buf.toString("utf8")
  } catch {
    return []
  }
  const isMd = path.endsWith(".md")
  const lower = text.toLowerCase()
  const title = isMd ? cheapTitle(path, text) : ""
  const base = (path.split("/").pop() as string).replace(/\.[^.]+$/, "")
  const q = query.toLowerCase().trim()
  const nameText = `${path} ${title}`.toLowerCase()
  const nameHit = match(nameText)
  const exact = !regex && (base.toLowerCase() === q || title.toLowerCase() === q)
  const bodyMayHit = regex || match(lower)
  if (!nameHit && !bodyMayHit) return []

  const found: Hit[] = []
  const mk = (line: number | null, t: string, score: number): Hit => ({ path, line, text: t, score, stale: false })
  if (nameHit) found.push(mk(null, isMd ? title : path, exact ? SCORE.exact : SCORE.name))
  if (bodyMayHit) {
    const headingLines = new Set(isMd ? mdHeadings(text).map((h) => h.line) : [])
    const routing = ROUTING_FILES.has(path)
    let inNavIndex = false
    const lines = text.split("\n")
    const lowerLines = lower.split("\n")
    const body: Hit[] = []
    for (let i = 0; i < lines.length; i++) {
      if (path === NAV_INDEX && /^#{1,6}\s/.test(lines[i] as string)) inNavIndex = /canonical wiki index/i.test(lines[i] as string)
      if (!match(lowerLines[i] as string)) continue
      const score = headingLines.has(i + 1) ? SCORE.heading : routing || inNavIndex ? SCORE.index : SCORE.line
      body.push(mk(i + 1, clip(lines[i] as string), score))
    }
    body.sort((a, b) => b.score - a.score || (a.line as number) - (b.line as number))
    found.push(...body.slice(0, PER_FILE_LINES))
  }
  if (found.length === 0) return []
  const stale = isStale(path, isMd ? pageStatus(text) : null)
  return found.map((h) => ({ ...h, stale }))
}

function scriptHits(root: string, match: Matcher): Hit[] {
  return loadCatalog(root).flatMap((e) => {
    const where = e.path ?? `package.json#${e.script as string}`
    if (!match(`${e.id} ${e.summary} ${e.invoke}`.toLowerCase())) return []
    return [{ path: where, line: null, text: `${e.invoke}  # ${e.summary}`, score: SCORE.name, stale: false }]
  })
}

/** Total order: live before stale, higher score first, then path, then line. */
function order(a: Hit, b: Hit): number {
  return (
    Number(a.stale) - Number(b.stale) ||
    b.score - a.score ||
    cmp(a.path, b.path) ||
    (a.line ?? 0) - (b.line ?? 0)
  )
}

/** All ranked hits (uncapped). */
export function rankHits(query: string, scope: FindScope, root: string, regex = false): readonly Hit[] {
  const match = makeMatcher(query, regex)
  const hits = scope === "scripts" ? scriptHits(root, match) : []
  if (scope === "all") hits.push(...scriptHits(root, match))
  if (scope !== "scripts")
    for (const p of trackedFiles(root)) if (inScope(p, scope)) hits.push(...scanFile(root, p, query, match, regex))
  return hits.sort(order)
}

/**
 * Ranked search over git's file universe. Ranking: exact file/title name (100) > name contains
 * every query word (90) > heading line (70) > ownership/catalog/Canonical-Wiki-Index line (50) >
 * other content line (10); `_archive` and deprecated/superseded/historical pages sort last
 * (`stale`); ties break by path, then line. Multi-word queries need every word on the line.
 */
export function findHits(query: string, scope: FindScope, root: string, limit: number): readonly Hit[] {
  return rankHits(query, scope, root).slice(0, limit)
}

const OTHER_SCOPE: Record<FindScope, string> = { all: "--scripts", wiki: "--code", code: "--wiki", scripts: "--wiki" }
const SCOPE_FLAGS: readonly [string, FindScope][] = [
  ["--wiki", "wiki"],
  ["--code", "code"],
  ["--scripts", "scripts"],
]

/** `repo find`: ranked, capped search over tracked + untracked-non-ignored files. */
export const findCommand: Command = {
  name: "find",
  summary: "Ranked repo search: find \"q\" [--wiki|--code|--scripts] [--limit N]",
  detail: [
    "Words are ANDed per line. Rank: exact name > name/title > heading > ownership/catalog/wiki-index line > content line;",
    "stale (_archive, deprecated/superseded/historical) last. --code: ts,tsx,js,mjs,cjs,json,sh outside wiki/; --scripts: catalog.json.",
  ],
  example: 'bun run repo find "ownership" --wiki',
  async run(args, io) {
    const valueFlags = ["--limit", "--root"]
    const { positionals, flagTokens } = splitArgs(args, valueFlags)
    const bad = rejectUnknown(io, "find", flagTokens, { flags: ["--wiki", "--code", "--scripts", "--regex"], values: valueFlags })
    if (bad !== undefined) return bad
    const query = positionals.join(" ").trim()
    if (query.length === 0) return io.usage("missing query", 'bun run repo find --help')
    const picked = SCOPE_FLAGS.filter(([f]) => flagTokens.includes(f))
    if (picked.length > 1) return io.usage("choose one of --wiki, --code, --scripts", "bun run repo find --help")
    const scope: FindScope = picked[0]?.[1] ?? "all"
    const limitRaw = flagValue(flagTokens, "--limit")
    const limit = limitRaw === undefined ? 15 : Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1) return io.usage(`bad --limit: ${limitRaw}`, "bun run repo find --help")
    const regex = flagTokens.includes("--regex")
    if (regex) {
      try {
        new RegExp(query, "i")
      } catch {
        return io.usage(`invalid regex: ${query}`, "bun run repo find --help")
      }
    }
    const root = resolveRoot(flagValue(flagTokens, "--root"))

    const all = rankHits(query, scope, root, regex)
    const capped = !io.full && limit > OUTPUT_CAP
    const shown = all.slice(0, capped ? OUTPUT_CAP : limit)
    io.data({ query, scope, total: all.length, hits: shown })
    if (all.length === 0) {
      io.out(`no results for "${query}"`)
      io.result(`next: bun run repo find "${query}" ${OTHER_SCOPE[scope]}`)
      return 0
    }
    for (const h of shown) io.out(`${h.line === null ? h.path : `${h.path}:${h.line}`}  ${h.text}${h.stale ? " (stale)" : ""}`)
    if (all.length > shown.length)
      io.result(`... ${all.length - shown.length} more (use ${capped ? "--full" : `--limit ${all.length}`})`)
    return 0
  },
}
