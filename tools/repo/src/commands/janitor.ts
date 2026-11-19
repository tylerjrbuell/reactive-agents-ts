import { execFileSync, spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, sep } from "node:path"
import type { Command } from "../cli.ts"
import { rejectUnknown } from "../lib/args.ts"
import { assessPressure, readPressure, type Pressure, type Verdict } from "../lib/mem-guard.ts"
import type { Io } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"
import { pidAlive } from "../lib/test-slots.ts"
import {
  bigTmpEntries,
  fmtBytes,
  type Hog,
  janitorBases,
  janitorOwnsOrSkips,
  realFs,
  reapCompileCache,
  staleWorktrees,
  sweepAll,
  testTmpBase,
  type WorktreeReading,
} from "../lib/tmp-janitor.ts"

/**
 * Reap leaked test temp dirs (dead-PID roots + legacy prefixes older than 60 min) and a stale or
 * oversized `node-compile-cache`. Shared by `repo janitor`, `repo guard`, `repo test`, `repo verify`
 * and `repo ci`. Never throws.
 */
export function runJanitor(dryRun: boolean): { count: number; bytes: number; liveRoots: number } {
  try {
    const now = Date.now()
    const bases = janitorBases()
    const r = sweepAll(realFs, bases, { pidAlive, now, legacy: true, dryRun })
    for (const b of bases) {
      const c = reapCompileCache(realFs, b, { now, dryRun })
      if (c !== undefined) {
        r.reaped.push(c)
        r.bytes += c.bytes
      }
    }
    return { count: r.reaped.length, bytes: r.bytes, liveRoots: r.liveRoots }
  } catch {
    return { count: 0, bytes: 0, liveRoots: 0 }
  }
}

/** Live guard verdict for the test temp dir's filesystem. */
export function currentPressure(): { pressure: Pressure; verdict: Verdict } {
  const pressure = readPressure(testTmpBase())
  return { pressure, verdict: assessPressure(pressure) }
}

/**
 * Mid-run check for long runs (`repo test --all` between chunks, `repo ci` between steps): the
 * reason to stop scheduling new work when the guard now refuses, else undefined. Never throws.
 */
export function pressureStop(read: () => Verdict = () => currentPressure().verdict): string | undefined {
  try {
    const v = read()
    return v.level === "refuse" ? v.lines.join("; ") : undefined
  } catch {
    return undefined
  }
}

/** The hint printed whenever the guard stops or refuses a run. */
export const PRESSURE_HINT = "bash scripts/mem-watch.sh   # shows top RSS processes, swap and temp usage; free memory, then retry"

/**
 * Pre-run hygiene for heavy commands: janitor, then the memory guard. Prints one line when something
 * was reaped or a warning applies. Returns an exit code when the run must not start, else undefined.
 */
export function preflightHeavy(io: Io, cmd: string): number | undefined {
  const j = runJanitor(false)
  if (j.count > 0) io.out(`janitor: reaped ${j.count} leaked temp entries, freed ${fmtBytes(j.bytes)}`)
  const v = currentPressure().verdict
  if (v.level === "warn") io.out(`warn: memory pressure (${v.lines.join("; ")}); run fewer heavy processes at once`)
  if (v.level === "refuse") {
    return io.fail(`${cmd} not started: ${v.lines.join("; ")}. Another heavy process or leaked temp data is eating RAM`, PRESSURE_HINT)
  }
  return undefined
}

/** Recursive size in bytes via `du -sk` (POSIX; far faster than a JS walk on 250k-file worktrees). */
function duBytes(paths: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  if (paths.length === 0) return out
  // du exits 1 on unreadable subdirs but still prints totals: read stdout regardless.
  const r = spawnSync("du", ["-sk", "--", ...paths], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 ** 2 })
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^(\d+)\s+(.+)$/.exec(line)
    if (m !== null && m[2] !== undefined) out.set(m[2], Number(m[1]) * 1024)
  }
  return out
}

/** Agent worktrees under `<root>/.claude/worktrees/` with their last activity. Never throws. */
function readAgentWorktrees(root: string): WorktreeReading[] {
  const prefix = join(root, ".claude", "worktrees") + sep
  let list = ""
  try {
    list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return []
  }
  const out: WorktreeReading[] = []
  for (const line of list.split("\n")) {
    if (!line.startsWith("worktree ")) continue
    const path = line.slice("worktree ".length)
    if (!path.startsWith(prefix)) continue
    let last = 0
    try {
      last = Number(execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) * 1000
      const idx = execFileSync("git", ["rev-parse", "--git-path", "index"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
      last = Math.max(last, statSync(isAbsolute(idx) ? idx : join(path, idx), { throwIfNoEntry: false })?.mtimeMs ?? 0)
    } catch {
      // Missing or broken worktree: keep `last` as read; a prunable one shows as stale.
    }
    out.push({ path, lastActiveMs: last, bytes: () => duBytes([path]).get(path) ?? 0 })
  }
  return out
}

/** Sizes of top-level temp entries the janitor does not own (owned and `claude-*` entries are never walked). */
function readTmpSizes(dir: string): Map<string, number> {
  const sizes = new Map<string, number>()
  const dirs: string[] = []
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (janitorOwnsOrSkips(e.name)) continue
      if (e.isDirectory()) dirs.push(join(dir, e.name))
      else sizes.set(e.name, statSync(join(dir, e.name), { throwIfNoEntry: false })?.size ?? 0)
    }
  } catch {
    return sizes
  }
  for (const [p, b] of duBytes(dirs)) sizes.set(p.slice(dir.length + 1), b)
  return sizes
}

/** Hogs listed per kind before `... N more`. */
const HOG_CAP = 10

function hogLines(hogs: readonly Hog[]): string[] {
  const lines: string[] = []
  for (const kind of ["stale-worktree", "big-tmp"] as const) {
    const of = hogs.filter((h) => h.kind === kind)
    for (const h of of.slice(0, HOG_CAP)) {
      const what = kind === "stale-worktree" ? `stale worktree, idle ${h.idleHours ?? "?"} h` : "large temp entry, not janitor-owned"
      lines.push(`  ${fmtBytes(h.bytes)}  ${what}: ${h.fix}`)
    }
    if (of.length > HOG_CAP) lines.push(`  ... ${of.length - HOG_CAP} more ${kind}`)
  }
  return lines
}

/** `repo janitor`: reap leaked test temp dirs; report worktree and temp hogs it will not delete. */
export const janitorCommand: Command = {
  name: "janitor",
  summary: "Reap leaked test temp and compile cache; report stale worktrees, big temp",
  example: "bun run repo janitor --dry-run",
  detail: [
    "--dry-run: report what would be removed, remove nothing",
    "reaps: <tmp>/ra-tests-<pid>-* whose PID is dead (any age); legacy ra-*, corrective-guard*, w3b-triad*, rax-clean-install-test* and similar older than 60 min; <tmp>/node-compile-cache older than 24 h or over 512 MB (node regenerates it)",
    "reports only (never deletes): git worktrees under .claude/worktrees idle > 24 h, with size and the `git worktree remove <path>` command; top-level temp entries > 500 MB it does not own",
    "never touches a root whose PID is alive, repo-test-slots-*, or <tmp>/claude-* (other live sessions); also scans REPO_TEST_TMPDIR when set",
    "the reaping (not the report) runs automatically at the start of `repo test`, `repo verify`, `repo ci` and `repo guard`",
  ],
  async run(args, io) {
    const bad = rejectUnknown(io, "janitor", args, { values: [], flags: ["--dry-run"] })
    if (bad !== undefined) return bad
    const dry = args.includes("--dry-run")
    const j = runJanitor(dry)
    const now = Date.now()
    let hogs: Hog[] = []
    try {
      hogs = [...staleWorktrees(readAgentWorktrees(resolveRoot(undefined)), now), ...bigTmpEntries(tmpdir(), readTmpSizes(tmpdir()))]
    } catch {
      // The report is advisory: never fail the janitor over it.
    }
    io.data({ ...j, hogs })
    io.result(`${dry ? "would reap" : "reaped"} ${j.count} entries, ${dry ? "would free" : "freed"} ${fmtBytes(j.bytes)}; ${j.liveRoots} live roots untouched`)
    if (hogs.length > 0) {
      io.result(`not deleted (${fmtBytes(hogs.reduce((n, h) => n + h.bytes, 0))} in ${hogs.length} entries; check each is unused first):`)
      for (const l of hogLines(hogs)) io.result(l)
    }
    io.result("next: bun run repo test <paths>")
    return 0
  },
}

/** `repo guard`: janitor + memory guard alone, for heavy commands the repo CLI does not run itself. */
export const guardCommand: Command = {
  name: "guard",
  summary: "Memory guard for builds, probes, benches: exit 1 when near an OOM kill",
  example: "bun run repo guard && bunx turbo run build --filter=@reactive-agents/reasoning",
  detail: [
    "runs the janitor, then the same checks `repo test` runs first: MemAvailable < 1 GB, swap > 97% full with MemAvailable < 3 GB, or a RAM-backed temp dir > 80% full refuse (exit 1)",
    "warns (exit 0) at MemAvailable < 3 GB, swap > 97% full, swap > 90% full with MemAvailable < 6 GB, or temp > 50% full",
    "chain it before any heavy command: `bun run repo guard && bun run build`, `bun run repo guard && bun run bench:replay`",
  ],
  async run(args, io) {
    const bad = rejectUnknown(io, "guard", args, { values: [], flags: [] })
    if (bad !== undefined) return bad
    const refused = preflightHeavy(io, "guarded command")
    if (refused !== undefined) return refused
    const p = currentPressure().pressure
    const gb = (n: number | undefined): string => (n === undefined ? "n/a" : `${(n / 1024 ** 3).toFixed(1)} GB`)
    const pct = (f: number | undefined): string => (f === undefined ? "n/a" : `${Math.round(f * 100)}%`)
    io.data(p)
    io.result(`memory ok to start: MemAvailable ${gb(p.memAvailableBytes)}, swap ${pct(p.swapUsedFrac)} used, RAM-backed temp ${pct(p.tmpfsUsedFrac)} used`)
    io.result("next: run the heavy command")
    return 0
  },
}
