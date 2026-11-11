/**
 * Per-cell benchmark temp dirs (`.bench-run-<pid>-*`) and the sweep that
 * removes ones leaked by killed/crashed runs without touching a concurrent
 * session's live fixtures.
 */
import { readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

/** Prefix of a per-cell temp dir owned by this process: `.bench-run-<pid>-`. */
export const benchRunDirPrefix = (pid: number = process.pid): string => `.bench-run-${pid}-`

/** Legacy dirs (no owner pid in the name) are swept only once this old. */
const LEGACY_BENCH_DIR_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Whether `pid` names a live process (EPERM still means it exists). */
const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Whether a `.bench-run-*` dir is stale: its owner pid is dead, or (legacy
 * name without a pid) it is older than {@link LEGACY_BENCH_DIR_MAX_AGE_MS}.
 * A dir owned by a live process (a concurrent session) is never stale.
 */
const isStaleBenchDir = (baseDir: string, name: string, now: number): boolean => {
  const owner = /^\.bench-run-(\d+)-/.exec(name)
  if (owner) return !pidAlive(Number(owner[1]))
  try {
    return now - statSync(join(baseDir, name)).mtimeMs > LEGACY_BENCH_DIR_MAX_AGE_MS
  } catch {
    return false
  }
}

/**
 * Remove leftover `.bench-run-*` temp dirs from prior killed/crashed runs.
 * Only dirs whose owning process is gone are removed, so two sessions sharing a
 * cwd never delete each other's live fixtures.
 * Best-effort — swallows all errors so cleanup never aborts a benchmark.
 */
export function cleanupStaleBenchDirs(baseDir: string = process.cwd()): number {
  let removed = 0
  const now = Date.now()
  try {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".bench-run-") && isStaleBenchDir(baseDir, entry.name, now)) {
        try {
          rmSync(join(baseDir, entry.name), { recursive: true, force: true })
          removed++
        } catch {
          /* ignore a single dir we can't remove (in-use by a live run, perms) */
        }
      }
    }
  } catch {
    /* readdir failed (cwd gone?) — nothing to sweep */
  }
  return removed
}
