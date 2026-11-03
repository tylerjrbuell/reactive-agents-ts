import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { frontmatter } from "../lib/frontmatter.ts"
import { loadRules } from "../lib/hook-rules.ts"
import { manifestHealth } from "../lib/manifest-expiry.ts"
import { loadPlacement } from "../lib/placement.ts"
import { resolveRoot } from "../lib/root.ts"

const AUTHORITY = "wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md"
const PLANS_DIR = "wiki/Planning/Implementation-Plans"
const DEBT = "wiki/Architecture/DEBT-REGISTER.md"
const DAY_MS = 86_400_000
const STALE_DAYS = 60
const OVERRIDE_REVIEW_AT = 3
const PLANS_SHOWN = 5
const QUIET_DAYS = 30
const MIN_LOG_DAYS = 7

/** An authority-doc heading: pointer only, never the text under it. */
export interface Heading {
  line: number
  text: string
  /** Set when the heading carries a date older than 60 days. */
  staleDate?: string
}

/** A plan that declares itself active. Self-declared: verify against git log. */
export interface ActivePlan {
  path: string
  title: string
  /** ISO date from `updated`, else `created`, else the filename; null when none. */
  date: string | null
  /** True when the frontmatter has no `updated` field. */
  noUpdated: boolean
  /** Date older than 60 days at the injected `today`. */
  stale: boolean
}

/** Everything `repo status` reports; all of it computed from files and git, none inferred. */
export interface StatusReport {
  branch: string
  /** Plans with exact frontmatter `status: active`, newest first by `updated ?? created ?? filename date`. */
  activePlans: readonly ActivePlan[]
  /** Plans by exact frontmatter `status`, for statuses other than `active`. */
  planStatusCounts: Readonly<Record<string, number>>
  /** `### D-...` register headings without the whole word RESOLVED (a heuristic); null when there are none to count. */
  openDebt: number | null
  /** Register frontmatter `date` (ratchet baseline). */
  debtBaseline: string | null
  hotUpdated: string | null
  dirtyFiles: number
  testsPassing: number | null
  authorityHeadings: readonly Heading[]
  /** Overrides per rule id from `.repo-logs/overrides.jsonl`. */
  overrides: Readonly<Record<string, number>>
  /** `rules.json:<id>` entries past `reviewBy`. */
  expiredRules: readonly string[]
  /** Rule ids with 0 denies in the last 30 days; empty unless `.repo-logs/denies.jsonl` spans >=7 days. */
  quietRules: readonly string[]
  /** Rule ids overridden >=3 times (sorted). */
  overriddenRules: readonly string[]
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

function plans(root: string, today: string): { active: ActivePlan[]; counts: Record<string, number> } {
  const dir = join(root, PLANS_DIR)
  const active: ActivePlan[] = []
  const counts: Record<string, number> = {}
  if (!existsSync(dir)) return { active, counts }
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
    const text = read(root, `${PLANS_DIR}/${f}`)
    const fm = text === null ? null : frontmatter(text)
    const status = fm?.status
    if (typeof status !== "string") continue
    if (status === "active") {
      const title = /^#\s+(.+)$/m.exec(text ?? "")?.[1]?.trim() ?? f.replace(/\.md$/, "")
      const dated = fm?.updated ?? fm?.created
      const date = dated === undefined || dated === null ? /^(\d{4}-\d{2}-\d{2})/.exec(f)?.[1] ?? null : String(dated).slice(0, 10)
      active.push({
        path: `${PLANS_DIR}/${f}`,
        title,
        date,
        noUpdated: fm?.updated === undefined || fm?.updated === null,
        stale: date !== null && ageDays(date, today) > STALE_DAYS,
      })
    } else counts[status] = (counts[status] ?? 0) + 1
  }
  active.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path))
  return { active, counts }
}

function debt(root: string): { open: number | null; baseline: string | null } {
  const text = read(root, DEBT)
  if (text === null) return { open: null, baseline: null }
  const d = frontmatter(text)?.date
  const baseline = d === undefined || d === null ? null : String(d).slice(0, 10)
  const entries = text.split("\n").filter((l) => /^### D-/.test(l))
  return { open: entries.length === 0 ? null : entries.filter((l) => !/\bRESOLVED\b/.test(l)).length, baseline }
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

/**
 * Hook and placement rules that never fired in the 30 days before `today`. Only meaningful once the denies log
 * is >=7 days old: a rule that has simply had no time to fire is not a removal candidate.
 */
function quietRules(root: string, today: string): string[] {
  const stamps: { ts: number; ruleId: string }[] = []
  for (const l of (read(root, ".repo-logs/denies.jsonl") ?? "").split("\n")) {
    if (l.trim().length === 0) continue
    try {
      const o = JSON.parse(l) as Record<string, unknown>
      const ts = typeof o.ts === "string" ? Date.parse(o.ts) : Number.NaN
      if (typeof o.ruleId === "string" && !Number.isNaN(ts)) stamps.push({ ts, ruleId: o.ruleId })
    } catch {
      // A torn log line is not worth failing a status read.
    }
  }
  if (stamps.length === 0) return []
  const now = Date.parse(`${today}T00:00:00Z`) + DAY_MS
  if (now - Math.min(...stamps.map((s) => s.ts)) < MIN_LOG_DAYS * DAY_MS) return []
  const fired = new Set(stamps.filter((s) => s.ts >= now - QUIET_DAYS * DAY_MS).map((s) => s.ruleId))
  try {
    const ids = [...loadRules(root).map((r) => r.id), ...loadPlacement(root).rules.map((r) => r.id)]
    return ids.filter((id) => !fired.has(id)).sort()
  } catch {
    return []
  }
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
  const p = plans(root, today)
  const hot = frontmatter(read(root, "wiki/Hot.md") ?? "")?.updated
  const health = manifestHealth(root, today)
  const d = debt(root)
  const overrides = overrideCounts(root)
  return {
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "unknown",
    activePlans: p.active,
    planStatusCounts: p.counts,
    openDebt: d.open,
    debtBaseline: d.baseline,
    hotUpdated: hot === undefined || hot === null ? null : String(hot),
    dirtyFiles: git(root, ["status", "--porcelain"]).split("\n").filter((l) => l.length > 0).length,
    testsPassing: testsPassing(root),
    authorityHeadings: headings(root, today),
    overrides,
    expiredRules: [...health.warn, ...health.fail].filter((x) => x.startsWith("rules.json:")).sort(),
    quietRules: quietRules(root, today),
    overriddenRules: Object.entries(overrides).filter(([, n]) => n >= OVERRIDE_REVIEW_AT).map(([id]) => id).sort(),
  }
}

/** Human-readable lines (the first line answers; the last is `next:`). */
export function renderStatus(r: StatusReport): string[] {
  const lines = [`branch ${r.branch} | hot ${r.hotUpdated ?? "n/a"} | ${r.dirtyFiles} dirty`]
  const proposed = r.planStatusCounts.proposed ?? 0
  lines.push(`plans: ${r.activePlans.length} active (exact), ${proposed} proposed`)
  lines.push("plan status is self-declared; verify against git log")
  for (const a of r.activePlans.slice(0, PLANS_SHOWN)) {
    const flags = [a.noUpdated ? "(no updated field)" : "", a.stale && a.date !== null ? `(dated ${a.date} — confirm before relying)` : ""]
    lines.push(`  ${a.date ?? "undated"} ${a.path}${flags.filter((f) => f.length > 0).map((f) => ` ${f}`).join("")}`)
  }
  if (r.activePlans.length > PLANS_SHOWN) lines.push(`  (+${r.activePlans.length - PLANS_SHOWN} older active; ls ${PLANS_DIR})`)
  lines.push(
    r.openDebt === null
      ? `debt: ${DEBT} (canonical; open-entry count n/a)`
      : `debt: ${DEBT} (canonical; ratchet baseline ${r.debtBaseline ?? "n/a"}; ### D- entries without a RESOLVED marker: ${r.openDebt} — heuristic, ratchet table and P0 rows not counted)`,
  )
  lines.push(r.testsPassing === null ? "tests: n/a" : `tests: ${r.testsPassing} (apps/docs/src/data/metrics-cache.json)`)
  lines.push(`authority: ${AUTHORITY}`)
  for (const h of r.authorityHeadings)
    lines.push(`  L${h.line} ${h.text}${h.staleDate === undefined ? "" : ` (dated ${h.staleDate} — confirm before relying)`}`)
  for (const [id, n] of Object.entries(r.overrides).sort(([a], [b]) => a.localeCompare(b)))
    if (n >= OVERRIDE_REVIEW_AT) lines.push(`rule ${id} may be wrong — review tools/repo/rules.json (${n} overrides)`)
  if (r.overriddenRules.length > 0) lines.push(`rules overridden ≥${OVERRIDE_REVIEW_AT}×: ${r.overriddenRules.join(", ")}`)
  if (r.quietRules.length > 0) lines.push(`rules with 0 denies in ${QUIET_DAYS}d (removal candidates): ${r.quietRules.join(", ")}`)
  if (r.expiredRules.length > 0) lines.push(`expired rules: ${r.expiredRules.join(", ")}`)
  lines.push("next: bun run repo scope")
  return lines
}

/** `repo status`: orient in one screen; pointers to authority docs, never their prose. */
export const statusCommand: Command = {
  name: "status",
  summary: "Branch, plans, debt and authority-doc pointers (informational)",
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
