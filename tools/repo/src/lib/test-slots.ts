import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from "node:fs"
import { availableParallelism, tmpdir, userInfo } from "node:os"
import { join } from "node:path"

/**
 * Machine-wide cap on concurrent `repo test` / `repo verify` test runs, so parallel sessions and
 * wardens cannot run enough `bun test` processes at once to exhaust RAM.
 *
 * A slot is a file `slot-<i>.lock` holding the owner's PID, created with `O_EXCL` in a shared dir
 * under the OS temp dir (one dir per user, shared by every checkout and worktree). A lock whose PID
 * is dead is stale and is taken over. The child `bun test` inherits `REPO_TEST_SLOT_HELD=1`, so a
 * nested `repo test` (a test that runs the CLI) does not wait on its own parent's slot.
 */

/** Env var marking a process tree that already holds a slot. */
export const SLOT_HELD_ENV = "REPO_TEST_SLOT_HELD"
/** Poll interval while waiting for a slot. */
const POLL_MS = 500

/**
 * Slot count: `REPO_TEST_SLOTS` (positive integer) or `max(2, floor(cores / 3))`.
 * The floor of 2 keeps one long `repo verify` from stalling every other session's quick scoped test;
 * the cap still stops three sessions' wardens from running a dozen suites at once (the 2026-11 OOMs).
 */
export function slotCount(env: Readonly<Record<string, string | undefined>> = process.env, cores = availableParallelism()): number {
  const raw = env.REPO_TEST_SLOTS
  if (raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0) return Number(raw)
  return Math.max(2, Math.floor(cores / 3))
}

/** Lock dir: `REPO_TEST_SLOTS_DIR`, else `<tmpdir>/repo-test-slots-<user>`. */
export function slotDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env.REPO_TEST_SLOTS_DIR
  if (override !== undefined && override.length > 0) return override
  let user = "user"
  try {
    user = userInfo().username.replace(/[^\w.-]/g, "_") || user
  } catch {
    // No passwd entry: one shared name is still correct, only less tidy.
  }
  return join(tmpdir(), `repo-test-slots-${user}`)
}

/** True when `pid` names a live process (EPERM = alive, owned by someone else). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

function ownerOf(path: string): number | undefined {
  try {
    const n = Number(readFileSync(path, "utf8").trim())
    return Number.isInteger(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

/** A lock with no PID is mid-creation for a moment; past `TORN_MS` it was left by a crash. */
const TORN_MS = 5000
function tornAndOld(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > TORN_MS
  } catch {
    return true
  }
}

/** Live holders in `dir` (stale locks are not counted). */
export function runningCount(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => /^slot-\d+\.lock$/.test(f) && pidAlive(ownerOf(join(dir, f)) ?? -1)).length
  } catch {
    return 0
  }
}

/**
 * One non-blocking attempt. Returns the lock path, or `undefined` when all `slots` are held by live
 * PIDs. Stale locks (dead PID, or a torn file with no PID) are removed and retaken.
 */
export function tryAcquire(dir: string, slots: number, pid: number = process.pid): string | undefined {
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < slots; i++) {
    const path = join(dir, `slot-${i}.lock`)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(path, "wx")
        writeSync(fd, String(pid))
        closeSync(fd)
        return path
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
        const owner = ownerOf(path)
        if (owner !== undefined ? pidAlive(owner) : !tornAndOld(path)) break
        rmSync(path, { force: true })
      }
    }
  }
  return undefined
}

/** Remove `path` if it still holds `pid`. Safe to call twice. */
export function release(path: string, pid: number = process.pid): void {
  if (ownerOf(path) === pid) rmSync(path, { force: true })
}

/** A held slot; `release()` is idempotent. `path` is undefined when no lock was needed (nested run). */
export interface Slot {
  path: string | undefined
  release(): void
}

/**
 * Wait for a slot. Prints `waiting for a test slot (k running)` once through `notify` when it has
 * to wait. The slot is also released on process exit, SIGINT and SIGTERM. A process that already
 * holds one (`REPO_TEST_SLOT_HELD=1`) gets a no-op slot.
 */
export async function acquireSlot(
  notify: (line: string) => void,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Slot> {
  if (env[SLOT_HELD_ENV] === "1") return { path: undefined, release: () => {} }
  const dir = slotDir(env)
  const slots = slotCount(env)
  let path = tryAcquire(dir, slots)
  if (path === undefined) {
    notify(`waiting for a test slot (${runningCount(dir)} running, ${slots} max; REPO_TEST_SLOTS overrides)`)
    while (path === undefined) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      path = tryAcquire(dir, slots)
    }
  }
  const held = path
  const onExit = (): void => release(held)
  const onSignal = (sig: NodeJS.Signals): void => {
    release(held)
    process.exit(sig === "SIGINT" ? 130 : 143)
  }
  process.on("exit", onExit)
  process.once("SIGINT", onSignal)
  process.once("SIGTERM", onSignal)
  return {
    path: held,
    release() {
      release(held)
      process.off("exit", onExit)
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
    },
  }
}
