import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Test temp-dir hygiene. Every test process gets ONE root `<base>/ra-tests-<pid>-<rand>/`; the runner
 * (and `scripts/test-preload.ts` for raw `bun test`) points TMPDIR at it, so each suite's
 * `mkdtemp(os.tmpdir())` lands inside a single removable tree. A root whose PID is dead was leaked by a
 * SIGKILL/OOM/timeout and is reaped by name alone (no stat). Legacy prefixes (dirs leaked before roots
 * existed) are reaped by age. A live PID's root is never touched.
 *
 * Why: /tmp is RAM-backed tmpfs on the dev machine; ~33,000 leaked test dirs reached 7 GB and
 * contributed to OOM kills of the desktop session (2026-11-17/18).
 */

/** Per-process root name prefix. */
export const ROOT_PREFIX = "ra-tests-"
/** Env var that tells the preload the runner already owns a root (do not create another). */
export const TEST_ROOT_ENV = "RA_TEST_TMP_ROOT"
/** Env var: use this (disk-backed) dir instead of the OS temp dir as the base for test roots. */
export const TEST_TMP_BASE_ENV = "REPO_TEST_TMPDIR"
/** Legacy dirs older than this (mtime) are reaped. */
export const LEGACY_MIN_AGE_MS = 60 * 60 * 1000

/** Name prefixes of legacy leaked test dirs. `ra-` covers ra-test-traces, ra-ep, ra-wb, ra-edit and friends. */
export const LEGACY_PREFIXES: readonly string[] = [
  "ra-",
  "rai-test",
  "corrective-guard",
  "w3b-triad",
  "rax-clean-install-test",
  "debrief-memory-test",
  "lean-plus-memory",
  "cortex-interaction-e2e",
  "repo-mirror",
  "truth-file",
  "ingest-",
  "rooted-heal",
  "readme-public",
  "calstore-cap",
  "search-env",
  "cortex-chat-",
  "cal-config-test-",
  "trace-test-",
]

/** Entries never reaped, whatever their prefix (live lock dirs). */
const PROTECTED = /^(?:repo-test-slots-)/

/** PID encoded in a root name, or undefined when `name` is not a root. */
export function rootPid(name: string): number | undefined {
  const m = /^ra-tests-(\d+)-[A-Za-z0-9]+$/.exec(name)
  return m === null ? undefined : Number(m[1])
}

/** Base dir for test roots: `REPO_TEST_TMPDIR` when set, else the OS temp dir. */
export function testTmpBase(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const o = env[TEST_TMP_BASE_ENV]
  return o !== undefined && o.length > 0 ? o : tmpdir()
}

/** Create `<base>/ra-tests-<pid>-<rand>/`. */
export function makeTestRoot(base: string = testTmpBase(), pid: number = process.pid): string {
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, `${ROOT_PREFIX}${pid}-`))
}

/** What the janitor needs from a filesystem; injectable so tests need no real /tmp. */
export interface JanitorFs {
  list(dir: string): string[]
  /** mtime in ms, or undefined when the entry vanished. */
  mtimeMs(path: string): number | undefined
  /** Recursive size in bytes (best effort). */
  bytes(path: string): number
  remove(path: string): void
}

/** One reaped (or would-be reaped) entry. */
export interface Reaped {
  name: string
  reason: "dead-pid" | "legacy-old" | "compile-cache"
  bytes: number
}

/** Result of one janitor pass. */
export interface JanitorReport {
  reaped: Reaped[]
  bytes: number
  /** Dirs skipped because their owner PID is alive. */
  liveRoots: number
}

/**
 * Reap leaked test dirs in `dir`. `legacy: false` is the cheap path (names only, no stat): dead-PID roots.
 * Live-PID roots and `repo-test-slots-*` are never touched. `dryRun` reports without removing.
 */
export function sweep(
  fs: JanitorFs,
  dir: string,
  opts: { pidAlive: (pid: number) => boolean; now: number; legacy: boolean; dryRun: boolean; minAgeMs?: number },
): JanitorReport {
  const report: JanitorReport = { reaped: [], bytes: 0, liveRoots: 0 }
  const minAge = opts.minAgeMs ?? LEGACY_MIN_AGE_MS
  const take = (name: string, reason: Reaped["reason"]): void => {
    const path = join(dir, name)
    const bytes = fs.bytes(path)
    if (!opts.dryRun) fs.remove(path)
    report.reaped.push({ name, reason, bytes })
    report.bytes += bytes
  }
  for (const name of fs.list(dir)) {
    if (PROTECTED.test(name)) continue
    const pid = rootPid(name)
    if (pid !== undefined) {
      if (opts.pidAlive(pid)) report.liveRoots++
      else take(name, "dead-pid")
      continue
    }
    if (!opts.legacy || !LEGACY_PREFIXES.some((p) => name.startsWith(p))) continue
    const m = fs.mtimeMs(join(dir, name))
    if (m !== undefined && opts.now - m >= minAge) take(name, "legacy-old")
  }
  return report
}

function dirBytes(path: string): number {
  let total = 0
  try {
    for (const e of readdirSync(path, { withFileTypes: true })) {
      const p = join(path, e.name)
      if (e.isDirectory()) total += dirBytes(p)
      else total += statSync(p, { throwIfNoEntry: false })?.size ?? 0
    }
  } catch {
    // vanished or unreadable: count what we saw
  }
  return total
}

/** The real filesystem. */
export const realFs: JanitorFs = {
  list: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  },
  mtimeMs: (p) => statSync(p, { throwIfNoEntry: false })?.mtimeMs,
  bytes: (p) => {
    const s = statSync(p, { throwIfNoEntry: false })
    return s === undefined ? 0 : s.isDirectory() ? dirBytes(p) : s.size
  },
  remove: (p) => rmSync(p, { recursive: true, force: true }),
}

/** Bases the janitor scans: the OS temp dir plus `REPO_TEST_TMPDIR` when set. */
export function janitorBases(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const bases = [tmpdir()]
  const o = env[TEST_TMP_BASE_ENV]
  if (o !== undefined && o.length > 0 && o !== bases[0] && existsSync(o)) bases.push(o)
  return bases
}

/** Run `sweep` over every base and merge the reports. */
export function sweepAll(
  fs: JanitorFs,
  bases: readonly string[],
  opts: { pidAlive: (pid: number) => boolean; now: number; legacy: boolean; dryRun: boolean; minAgeMs?: number },
): JanitorReport {
  const out: JanitorReport = { reaped: [], bytes: 0, liveRoots: 0 }
  for (const b of bases) {
    const r = sweep(fs, b, opts)
    out.reaped.push(...r.reaped)
    out.bytes += r.bytes
    out.liveRoots += r.liveRoots
  }
  return out
}

/** Node's on-disk compile cache in the temp dir (`module.enableCompileCache()`); it regenerates on demand. */
export const COMPILE_CACHE = "node-compile-cache"
/** The compile cache is reaped when older than this (mtime)... */
export const COMPILE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** ...or larger than this. Seen at 826 MB on RAM-backed /tmp (2026-11-19). */
export const COMPILE_CACHE_MAX_BYTES = 512 * 1024 ** 2

/**
 * Reap `<dir>/node-compile-cache` when stale or oversized. Returns the reaped entry, or undefined when
 * it is absent, young and small. `dryRun` reports without removing.
 */
export function reapCompileCache(fs: JanitorFs, dir: string, opts: { now: number; dryRun: boolean }): Reaped | undefined {
  const path = join(dir, COMPILE_CACHE)
  const m = fs.mtimeMs(path)
  if (m === undefined) return undefined
  const bytes = fs.bytes(path)
  if (opts.now - m < COMPILE_CACHE_MAX_AGE_MS && bytes <= COMPILE_CACHE_MAX_BYTES) return undefined
  if (!opts.dryRun) fs.remove(path)
  return { name: COMPILE_CACHE, reason: "compile-cache", bytes }
}

/** A space hog the janitor reports and never deletes, with the command that frees it. */
export interface Hog {
  path: string
  bytes: number
  kind: "stale-worktree" | "big-tmp"
  /** Hours since last activity (worktrees only). */
  idleHours?: number
  fix: string
}

/** Worktrees idle longer than this are reported. */
export const WORKTREE_STALE_MS = 24 * 60 * 60 * 1000
/** Top-level temp entries the janitor does not own are reported above this size. */
export const BIG_TMP_BYTES = 500 * 1024 ** 2

/** One agent worktree reading: path, last activity (newest of HEAD commit and index mtime) and size. */
export interface WorktreeReading {
  path: string
  lastActiveMs: number
  /** Size; only needed for stale worktrees, so a reader may size lazily. */
  bytes: () => number
}

/** Worktrees idle past `WORKTREE_STALE_MS`, with the exact remove command. Report only. */
export function staleWorktrees(worktrees: readonly WorktreeReading[], now: number): Hog[] {
  return worktrees
    .filter((w) => now - w.lastActiveMs >= WORKTREE_STALE_MS)
    .map((w) => ({
      path: w.path,
      bytes: w.bytes(),
      kind: "stale-worktree" as const,
      idleHours: Math.floor((now - w.lastActiveMs) / 3_600_000),
      fix: `git worktree remove ${w.path}`,
    }))
}

/**
 * True for temp entries the janitor owns or must never touch: test roots, legacy test dirs, the
 * compile cache, live slot locks, and `claude-*` (other live agent sessions' scratch).
 */
export function janitorOwnsOrSkips(name: string): boolean {
  return (
    rootPid(name) !== undefined ||
    PROTECTED.test(name) ||
    name === COMPILE_CACHE ||
    name.startsWith("claude-") ||
    LEGACY_PREFIXES.some((p) => name.startsWith(p))
  )
}

/** Top-level temp entries over `BIG_TMP_BYTES` that the janitor does not own, largest first. Report only. */
export function bigTmpEntries(dir: string, sizes: ReadonlyMap<string, number>): Hog[] {
  const out: Hog[] = []
  for (const [name, bytes] of sizes) {
    if (bytes <= BIG_TMP_BYTES || janitorOwnsOrSkips(name)) continue
    const path = join(dir, name)
    out.push({ path, bytes, kind: "big-tmp", fix: `ls -ld ${path}   # check owner and age before removing it` })
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

/** Human size: `1.2 GB`, `340 MB`, `12 KB`. */
export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  return `${Math.round(n / 1e3)} KB`
}
