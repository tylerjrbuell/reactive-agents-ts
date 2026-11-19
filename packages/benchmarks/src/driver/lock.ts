// File: src/driver/lock.ts — host-global single-supervisor lock for bench:drive.
//
// Why: the state file is per-outDir, so two specs in different outDirs could run two
// supervisors at once, and two live-model benches on one host measure each other
// (contention), not the harness. One lock file per host: pid + outDir + start time,
// taken with O_EXCL, reclaimed when its pid is dead, released on exit/stop.
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface LockInfo {
  readonly pid: number
  readonly outDir: string
  readonly startedAt: string
}

export type AcquireResult =
  | { readonly ok: true; readonly reclaimed: LockInfo | null }
  | { readonly ok: false; readonly owner: LockInfo; readonly message: string }

/** Overridable (tests, odd hosts) via RA_BENCH_DRIVE_LOCK. */
export const defaultLockPath = (): string => process.env.RA_BENCH_DRIVE_LOCK ?? join(tmpdir(), "bench-drive.lock")

export const pidAlive = (pid: number | null): boolean => {
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e && e.code === "EPERM"
  }
}

/** The lock's holder, or null when absent or unreadable. */
export function readLock(path: string = defaultLockPath()): LockInfo | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null || !("pid" in raw) || !("outDir" in raw) || !("startedAt" in raw)) return null
    const { pid, outDir, startedAt } = raw
    return typeof pid === "number" && typeof outDir === "string" && typeof startedAt === "string" ? { pid, outDir, startedAt } : null
  } catch {
    return null
  }
}

const refusal = (owner: LockInfo, path: string): AcquireResult => ({
  ok: false,
  owner,
  message: `another bench:drive supervisor is live (pid ${owner.pid}, outDir ${owner.outDir}, since ${owner.startedAt}). Two supervisors on one host contend for Ollama and corrupt each other's cells. Run \`bench:drive stop ${owner.outDir}\` first, or delete ${path} if you are sure it is stale.`,
})

export interface LockOpts {
  readonly path?: string
  readonly alive?: (pid: number) => boolean
  readonly now?: () => Date
}

/**
 * Take the lock for `pid` / `outDir`. Refused when a different live pid holds it;
 * a dead holder (or an unreadable file) is reclaimed. Creation is O_EXCL, so of two
 * racing starters exactly one wins.
 */
export function acquireLock(pid: number, outDir: string, opts: LockOpts = {}): AcquireResult {
  const path = opts.path ?? defaultLockPath()
  const alive = opts.alive ?? pidAlive
  const info: LockInfo = { pid, outDir, startedAt: (opts.now?.() ?? new Date()).toISOString() }
  let reclaimed: LockInfo | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, "wx")
      try { writeSync(fd, JSON.stringify(info)) } finally { closeSync(fd) }
      return { ok: true, reclaimed }
    } catch (e) {
      if (!(typeof e === "object" && e !== null && "code" in e && e.code === "EEXIST")) throw e
    }
    const owner = readLock(path)
    if (owner && owner.pid !== pid && alive(owner.pid)) return refusal(owner, path)
    if (owner) reclaimed = owner
    try { unlinkSync(path) } catch { /* lost the reclaim race: retry sees the winner */ }
  }
  const owner = readLock(path)
  return owner ? refusal(owner, path) : { ok: false, owner: { pid: -1, outDir: "?", startedAt: "?" }, message: `could not take ${path}` }
}

/** A live other-owner of the lock, or null (free, stale, or held by `selfPid`). Does not take it. */
export function liveLockOwner(selfPid: number | null, opts: LockOpts = {}): LockInfo | null {
  const owner = readLock(opts.path ?? defaultLockPath())
  if (!owner || owner.pid === selfPid) return null
  return (opts.alive ?? pidAlive)(owner.pid) ? owner : null
}

/** Remove the lock only if `pid` holds it (a stale pid-mismatch never deletes someone else's lock). */
export function releaseLock(pid: number | null, opts: Pick<LockOpts, "path"> = {}): boolean {
  const path = opts.path ?? defaultLockPath()
  const owner = readLock(path)
  if (!owner || owner.pid !== pid) return false
  try { unlinkSync(path); return true } catch { return false }
}
