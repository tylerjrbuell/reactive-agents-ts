import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { frontmatter } from "../lib/frontmatter.ts"
import { manifestHealth } from "../lib/manifest-expiry.ts"
import { resolveRoot } from "../lib/root.ts"

const AUTHORITY = "wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md"
const PLANS_DIR = "wiki/Planning/Implementation-Plans"
const DEBT = "wiki/Architecture/DEBT-REGISTER.md"
const DAY_MS = 86_400_000
const STALE_DAYS = 60
const OVERRIDE_REVIEW_AT = 3
const PLANS_SHOWN = 5

/** An authority-doc heading: pointer only, never the text under it. */
export interface Heading {
  line: number
  text: string
  /** Set when the heading carries a date older than 60 days. */
  staleDate?: string
}

/** Everything `repo status` reports; all of it computed from files and git, none inferred. */
export interface StatusReport {
  branch: string
  activePlans: readonly { path: string; title: string }[]
  /** Plans by exact frontmatter `status`, for statuses other than `active`. */
  planStatusCounts: Readonly<Record<string, number>>
  /** `### D-...` register entries whose heading is not marked RESOLVED; null when the register has none to count. */
  openDebt: number | null
  hotUpdated: string | null
  dirtyFiles: number
  testsPassing: number | null
  authorityHeadings: readonly Heading[]
  /** Overrides per rule id from `.repo-logs/overrides.jsonl`. */
  overrides: Readonly<Record<string, number>>
  /** `rules.json:<id>` entries past `reviewBy`. */
  expiredRules: readonly string[]
}

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync("git", [...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return ""
  }
}

function read(root: string, rel: string): string | null {
  try {
    return readFileSync(join(root, rel), "utf8")
  } catch {
    return null
  }
}

function plans(root: string): { active: { path: string; title: string }[]; counts: Record<string, number> } {
  const dir = join(root, PLANS_DIR)
  const active: { path: string; title: string }[] = []
  const counts: Record<string, number> = {}
  if (!existsSync(dir)) return { active, counts }
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const text = read(root, `${PLANS_DIR}/${f}`)
    const status = text === null ? undefined : frontmatter(text)?.status
    if (typeof status !== "string") continue
    if (status === "active") {
      const title = /^#\s+(.+)$/m.exec(text ?? "")?.[1]?.trim() ?? f.replace(/\.md$/, "")
      active.push({ path: `${PLANS_DIR}/${f}`, title })
    } else counts[status] = (counts[status] ?? 0) + 1
  }
  return { active, counts }
}

function openDebt(root: string): number | null {
  const text = read(root, DEBT)
  if (text === null) return null
  const entries = text.split("\n").filter((l) => /^### D-/.test(l))
  if (entries.length === 0) return null
  return entries.filter((l) => !l.includes("RESOLVED")).length
}

function ageDays(from: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

function headings(root: string, today: string): Heading[] {
  const text = read(root, AUTHORITY)
  if (text === null) return []
  const out: Heading[] = []
  let fenced = false
  text.split("\n").forEach((l, i) => {
    if (/^\s*```/.test(l)) fenced = !fenced
    if (fenced || !/^## /.test(l)) return
    const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(l)?.[1]
    const h: Heading = { line: i + 1, text: l.trim() }
    if (date !== undefined && ageDays(date, today) > STALE_DAYS) h.staleDate = date
    out.push(h)
  })
  return out
}

function overrideCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const l of (read(root, ".repo-logs/overrides.jsonl") ?? "").split("\n")) {
    if (l.trim().length === 0) continue
    try {
      const id: unknown = (JSON.parse(l) as Record<string, unknown>).ruleId
      if (typeof id === "string") counts[id] = (counts[id] ?? 0) + 1
    } catch {
      // A torn log line is not worth failing a status read.
    }
  }
  return counts
}

function testsPassing(root: string): number | null {
  const text = read(root, "apps/docs/src/data/metrics-cache.json")
  if (text === null) return null
  try {
    const n: unknown = (JSON.parse(text) as Record<string, unknown>).tests
    return typeof n === "number" ? n : null
  } catch {
    return null
  }
}

/** Collect the status report. `today` is ISO `YYYY-MM-DD`, injected so output is deterministic. */
export function collectStatus(root: string, today: string): StatusReport {
  const p = plans(root)
  const hot = frontmatter(read(root, "wiki/Hot.md") ?? "")?.updated
  const health = manifestHealth(root, today)
  return {
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "unknown",
    activePlans: p.active,
    planStatusCounts: p.counts,
    openDebt: openDebt(root),
    hotUpdated: hot === undefined || hot === null ? null : String(hot),
    dirtyFiles: git(root, ["status", "--porcelain"]).split("\n").filter((l) => l.length > 0).length,
    testsPassing: testsPassing(root),
    authorityHeadings: headings(root, today),
    overrides: overrideCounts(root),
    expiredRules: [...health.warn, ...health.fail].filter((x) => x.startsWith("rules.json:")).sort(),
  }
}

/** Human-readable lines (the first line answers; the last is `next:`). */
export function renderStatus(r: StatusReport): string[] {
  const planWord = `${r.activePlans.length} active plan${r.activePlans.length === 1 ? "" : "s"}`
  const lines = [
    [
      `branch ${r.branch}`,
      planWord,
      r.openDebt === null ? "debt n/a" : `${r.openDebt} open debt`,
      `hot ${r.hotUpdated ?? "n/a"}`,
      `${r.dirtyFiles} dirty`,
    ].join(" | "),
  ]
  const others = Object.entries(r.planStatusCounts).filter(([s]) => s === "proposed")
  lines.push(`plans: ${r.activePlans.length} active${others.map(([s, n]) => `, ${n} ${s}`).join("")}`)
  for (const a of r.activePlans.slice(-PLANS_SHOWN).reverse()) lines.push(`  ${a.path}`)
  if (r.activePlans.length > PLANS_SHOWN) lines.push(`  (+${r.activePlans.length - PLANS_SHOWN} older active; ls ${PLANS_DIR})`)
  lines.push(
    r.openDebt === null
      ? `openDebt: n/a (see ${DEBT})`
      : `openDebt: ${r.openDebt} (### D- entries not marked RESOLVED in ${DEBT}; table rows not counted)`,
  )
  lines.push(r.testsPassing === null ? "tests: n/a" : `tests: ${r.testsPassing} (apps/docs/src/data/metrics-cache.json)`)
  lines.push(`authority: ${AUTHORITY}`)
  for (const h of r.authorityHeadings)
    lines.push(`  L${h.line} ${h.text}${h.staleDate === undefined ? "" : ` (dated ${h.staleDate} — confirm before relying)`}`)
  for (const [id, n] of Object.entries(r.overrides).sort(([a], [b]) => a.localeCompare(b)))
    if (n >= OVERRIDE_REVIEW_AT) lines.push(`rule ${id} may be wrong — review tools/repo/rules.json (${n} overrides)`)
  if (r.expiredRules.length > 0) lines.push(`expired rules: ${r.expiredRules.join(", ")}`)
  lines.push("next: bun run repo scope")
  return lines
}

/** `repo status`: orient in one screen; pointers to authority docs, never their prose. */
export const statusCommand: Command = {
  name: "status",
  summary: "Branch, active plans, open debt, authority-doc pointers (informational)",
  example: "bun run repo status",
  async run(args, io) {
    const bad = rejectUnknown(io, "status", args, { values: ["--root"] })
    if (bad !== undefined) return bad
    const root = resolveRoot(flagValue(args, "--root"))
    const report = collectStatus(root, new Date().toISOString().slice(0, 10))
    io.data(report)
    const lines = renderStatus(report)
    for (const l of lines.slice(0, -1)) io.out(l)
    io.result(lines[lines.length - 1] as string)
    return 0
  },
}
