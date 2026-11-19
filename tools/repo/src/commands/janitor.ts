import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { Command } from "../cli.ts"
import { rejectUnknown } from "../lib/args.ts"
import { type CacheReading, cacheHogs, TEST_MEMORY_PREFIXES, testMemoryLeftovers } from "../lib/dev-hogs.ts"
import { realHome } from "../lib/test-home.ts"
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

/** Paths per `du` call: keeps argv far below ARG_MAX when sizing thousands of memory dirs. */
const DU_BATCH = 1000

/** Recursive size in bytes via `du -sk` (POSIX; far faster than a JS walk on 250k-file worktrees). */
function duBytes(paths: readonly string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < paths.length; i += DU_BATCH) {
    // du exits 1 on unreadable subdirs but still prints totals: read stdout regardless.
    const r = spawnSync("du", ["-sk", "--", ...paths.slice(i, i + DU_BATCH)], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 ** 2 })
    for (const line of (r.stdout ?? "").split("\n")) {
      const m = /^(\d+)\s+(.+)$/.exec(line)
      if (m !== null && m[2] !== undefined) out.set(m[2], Number(m[1]) * 1024)
    }
  }
  return out
}

/** One `git worktree list --porcelain` record. */
export interface WorktreeRecord {
  path: string
  prunable: boolean
  locked: boolean
}

/**
 * Worktree records from `git worktree list --porcelain`, minus the main worktree (always first) and
 * `self` (the checkout the janitor runs in). Covers worktrees anywhere on disk, not only `.claude/worktrees`.
 */
export function parseWorktreeList(porcelain: string, self: string): WorktreeRecord[] {
  const out: WorktreeRecord[] = []
  for (const block of porcelain.split(/\n\s*\n/).slice(1)) {
    const lines = block.split("\n")
    const head = lines.find((l) => l.startsWith("worktree "))
    if (head === undefined) continue
    const path = head.slice("worktree ".length)
    if (path === self) continue
    out.push({ path, prunable: lines.some((l) => l.startsWith("prunable")), locked: lines.some((l) => l.startsWith("locked")) })
  }
  return out
}

/** Every linked worktree of this repo with its last activity. Never throws. */
function readWorktrees(root: string): WorktreeReading[] {
  let list = ""
  try {
    list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return []
  }
  const out: WorktreeReading[] = []
  for (const { path, prunable, locked } of parseWorktreeList(list, root)) {
    if (prunable) {
      out.push({ path, lastActiveMs: 0, bytes: () => 0, prunable, locked })
      continue
    }
    let last = 0
    try {
      last = Number(execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) * 1000
      const idx = execFileSync("git", ["rev-parse", "--git-path", "index"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
      last = Math.max(last, statSync(isAbsolute(idx) ? idx : join(path, idx), { throwIfNoEntry: false })?.mtimeMs ?? 0)
    } catch {
      // Missing or broken worktree: keep `last` as read; a prunable one shows as stale.
    }
    out.push({ path, lastActiveMs: last, bytes: () => duBytes([path]).get(path) ?? 0, locked })
  }
  return out
}

/** Sizes of test-fixture entries in the real `~/.reactive-agents/memory` (others are never walked). */
function readTestMemorySizes(memDir: string): Map<string, number> {
  let names: string[] = []
  try {
    names = readdirSync(memDir).filter((n) => TEST_MEMORY_PREFIXES.some((p) => n.startsWith(p)))
  } catch {
    return new Map()
  }
  const sizes = new Map<string, number>()
  for (const [p, b] of duBytes(names.map((n) => join(memDir, n)))) sizes.set(p.slice(memDir.length + 1), b)
  return sizes
}

/** Turbo and bun install cache sizes (absent caches are left out). */
function readCaches(root: string, home: string): CacheReading {
  const turbo = join(root, ".turbo")
  const bunInstall = process.env.BUN_INSTALL
  const bun =
    process.env.BUN_INSTALL_CACHE_DIR ?? join(bunInstall !== undefined && bunInstall.length > 0 ? bunInstall : join(home, ".bun"), "install", "cache")
  const sizes = duBytes([turbo, bun].filter((p) => existsSync(p)))
  const r: CacheReading = {}
  const t = sizes.get(turbo)
  const b = sizes.get(bun)
  if (t !== undefined) r.turbo = { path: turbo, bytes: t }
  if (b !== undefined) r.bun = { path: bun, bytes: b }
  return r
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

function hogWhat(h: Hog): string {
  switch (h.kind) {
    case "stale-worktree":
      return `stale worktree, ${h.label ?? `idle ${h.idleHours ?? "?"} h`}`
    case "big-tmp":
      return "large temp entry, not janitor-owned"
    case "test-leftovers":
      return `${h.count ?? "?"} test-fixture memory dirs ${h.label ?? ""}* in the real home`
    case "cache":
      return h.label ?? "cache"
  }
}

function hogLines(hogs: readonly Hog[]): string[] {
  const lines: string[] = []
  for (const kind of ["stale-worktree", "test-leftovers", "cache", "big-tmp"] as const) {
    const of = hogs.filter((h) => h.kind === kind)
    for (const h of of.slice(0, HOG_CAP)) lines.push(`  ${fmtBytes(h.bytes)}  ${hogWhat(h)}: ${h.fix}`)
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
    "reports only (never deletes), each with its cleanup command: every linked git worktree (anywhere on disk) idle > 24 h or prunable; test-fixture agent memory dirs (guardrail-test-*, sub-grand-*, ...) in the real ~/.reactive-agents/memory; .turbo > 2 GB; the bun install cache > 5 GB; top-level temp entries > 500 MB it does not own",
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
      const root = resolveRoot(undefined)
      const home = realHome()
      const memDir = join(home, ".reactive-agents", "memory")
      hogs = [
        ...staleWorktrees(readWorktrees(root), now),
        ...testMemoryLeftovers(memDir, readTestMemorySizes(memDir)),
        ...cacheHogs(readCaches(root, home)),
        ...bigTmpEntries(tmpdir(), readTmpSizes(tmpdir())),
      ]
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
