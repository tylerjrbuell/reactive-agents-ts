import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { loadCatalog } from "../lib/catalog.ts"
import { OUTPUT_CAP } from "../lib/output.ts"
import { loadChecks } from "../lib/manifest.ts"
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
/**
 * Score table (higher first; stale hits always sort after live ones). Path adjustments:
 * canonical wiki dirs (Architecture/Specs, Decisions, Failure-Modes) +5; Implementation-Plans,
 * Harness-Reports, Debriefs and test files -5; src/ +2. Heading starting with the query +10;
 * code definition line (`export function q`, `class q`, `q(` method) +30; comment line -3.
 */
const SCORE = { exact: 100, name: 90, heading: 70, index: 50, line: 10, definition: 30, headingStarts: 10, comment: -3 } as const
const PER_FILE_LINES = 2
const TEXT_MAX = 100
const NAV_INDEX = "wiki/Development/Repo-Navigation.md"
/** Files whose content lines are routing tables (ownership, catalog) rather than prose or code. */
const ROUTING_FILES = new Set(["tools/repo/ownership.json", "tools/repo/catalog.json"])

/** Small deterministic path adjustments (never enough to lift a content line over a heading). */
function pathBoost(path: string): number {
  if (/^wiki\/(?:Architecture\/Specs|Decisions|Failure-Modes)\//.test(path)) return 5
  if (/^wiki\/(?:Planning\/Implementation-Plans|Research\/Harness-Reports|Research\/Debriefs)\//.test(path)) return -5
  if (/(?:^|\/)tests?\/|\.(?:test|spec)\./.test(path)) return -5
  if (/(?:^|\/)src\//.test(path)) return 2
  return 0
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
  const boost = pathBoost(path)
  if (nameHit) found.push(mk(null, isMd ? title : "", (exact ? SCORE.exact : SCORE.name) + (exact ? 0 : boost)))
  if (bodyMayHit) {
    const headingLines = new Set(isMd ? mdHeadings(text).map((h) => h.line) : [])
    const routing = ROUTING_FILES.has(path)
    let inNavIndex = false
    const lines = text.split("\n")
    const lowerLines = lower.split("\n")
    // Frontmatter lines (`title: …`, `status: …`) are metadata, not content hits.
    const fmEnd = isMd && lines[0]?.trim() === "---" ? lines.findIndex((l, i) => i > 0 && l.trim() === "---") + 1 : 0
    const single = !regex && /^\S+$/.test(q)
    const word = escapeRe(q)
    const defRe = single
      ? new RegExp(
          `^\\s*(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:(?:function\\*?|class|interface|type|const|let|var|enum)\\s+${word}\\b|(?:(?:public|private|protected|static|async|readonly)\\s+)*${word}\\s*[(<])`,
          "i",
        )
      : null
    const body: Hit[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string
      if (i < fmEnd) continue
      if (path === NAV_INDEX && /^#{1,6}\s/.test(line)) inNavIndex = /canonical wiki index/i.test(line)
      if (!match(lowerLines[i] as string)) continue
      let score: number = SCORE.line
      if (headingLines.has(i + 1)) {
        score = SCORE.heading
        if (single && line.replace(/^#+\s*|`/g, "").toLowerCase().startsWith(q)) score += SCORE.headingStarts
      } else if (routing || inNavIndex) score = SCORE.index
      else if (!isMd && defRe?.test(line)) score += SCORE.definition
      else if (!isMd && /^\s*(?:\/\/|\/\*|\*|#)/.test(line)) score += SCORE.comment
      body.push(mk(i + 1, clip(line), score + boost))
    }
    body.sort((a, b) => b.score - a.score || (a.line as number) - (b.line as number))
    found.push(...body.slice(0, PER_FILE_LINES))
  }
  if (found.length === 0) return []
  const stale = isStale(path, isMd ? pageStatus(text) : null)
  return found.map((h) => ({ ...h, stale }))
}

/** Catalog entries (id, summary, invoke) and registered checks (id, script) that match. */
function scriptHits(root: string, match: Matcher): Hit[] {
  const has = (name: string): boolean => existsSync(join(root, "tools", "repo", name))
  const fromCatalog = (has("catalog.json") ? loadCatalog(root) : []).flatMap((e): Hit[] => {
    const where = e.path ?? `package.json#${e.script as string}`
    if (!match(`${e.id} ${e.summary} ${e.invoke}`.toLowerCase())) return []
    return [{ path: where, line: null, text: `${e.invoke}  # ${e.summary}`, score: SCORE.name, stale: false }]
  })
  const fromChecks = (has("checks.json") ? loadChecks(root) : []).flatMap((c): Hit[] =>
    match(`${c.id} ${c.script}`.toLowerCase())
      ? [{ path: c.script, line: null, text: `bun run repo check --only ${c.id}`, score: SCORE.name, stale: false }]
      : [],
  )
  return [...fromCatalog, ...fromChecks]
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
    "Words are ANDed per line. Scores: exact name 100 | name/title 90 | heading 70 (+10 if it starts with the query) |",
    "ownership/catalog/wiki-index line 50 | code definition line 40 | content line 10 | comment line 7.",
    "Path adjust: wiki Architecture/Specs, Decisions, Failure-Modes +5; Implementation-Plans, Harness-Reports, Debriefs, tests -5; src/ +2.",
    "Stale (always last, marked): _archive, wiki/Home.md, wiki/MOCs/, status deprecated|superseded|historical|stale|archived.",
    "Ties by path then line. --code: ts,tsx,js,mjs,cjs,json,sh outside wiki/. --scripts: catalog.json + checks.json (shows invoke).",
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
    for (const h of shown) {
      const where = h.line === null ? h.path : `${h.path}:${h.line}`
      io.out(`${where}${h.text.length > 0 ? `  ${h.text}` : ""}${h.stale ? " (stale)" : ""}`)
    }
    if (all.length > shown.length)
      io.result(`... ${all.length - shown.length} more (use ${capped ? "--full" : `--limit ${all.length}`})`)
    return 0
  },
}
