// Host-global bench:drive lock: second supervisor refused, stale lock reclaimed,
// stop/release frees it. Injected pid liveness + temp lock path; no Ollama.
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLock, liveLockOwner, readLock, releaseLock } from "../src/driver/lock.js"
import { newState, writeState, type DriveSpec } from "../src/driver/driver.js"
import { startDrive, stopDrive } from "../src/driver/cli.js"

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "drvlock-"))
  path = join(dir, "bench-drive.lock")
  process.env.RA_BENCH_DRIVE_LOCK = path
})
afterEach(() => {
  delete process.env.RA_BENCH_DRIVE_LOCK
  rmSync(dir, { recursive: true, force: true })
})

describe("acquireLock", () => {
  it("takes a free lock and records pid, outDir, start time", () => {
    const r = acquireLock(100, "/out/a", { path, now: () => new Date("2026-11-19T00:00:00Z") })
    expect(r.ok).toBe(true)
    expect(readLock(path)).toEqual({ pid: 100, outDir: "/out/a", startedAt: "2026-11-19T00:00:00.000Z" })
  })

  it("refuses a second supervisor while the holder is alive, naming its outDir", () => {
    acquireLock(100, "/out/a", { path })
    const r = acquireLock(200, "/out/b", { path, alive: (p) => p === 100 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.owner.pid).toBe(100)
      expect(r.message).toContain("/out/a")
      expect(r.message).toContain("bench:drive stop")
    }
    expect(readLock(path)?.pid).toBe(100) // holder untouched
  })

  it("reclaims a stale lock whose pid is dead", () => {
    acquireLock(100, "/out/a", { path })
    const r = acquireLock(200, "/out/b", { path, alive: () => false })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.reclaimed?.pid).toBe(100)
    expect(readLock(path)).toMatchObject({ pid: 200, outDir: "/out/b" })
  })

  it("reclaims an unreadable (torn/garbage) lock file", () => {
    writeFileSync(path, "not json")
    expect(acquireLock(200, "/out/b", { path, alive: () => true }).ok).toBe(true)
    expect(readLock(path)?.pid).toBe(200)
  })

  it("is re-entrant for the same pid", () => {
    acquireLock(100, "/out/a", { path })
    expect(acquireLock(100, "/out/a", { path, alive: () => true }).ok).toBe(true)
  })
})

describe("releaseLock", () => {
  it("frees the lock for its holder only", () => {
    acquireLock(100, "/out/a", { path })
    expect(releaseLock(999, { path })).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(releaseLock(100, { path })).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(acquireLock(200, "/out/b", { path, alive: () => true }).ok).toBe(true)
  })
})

describe("liveLockOwner", () => {
  it("is null when free, stale, or self; the owner when live and foreign", () => {
    expect(liveLockOwner(null, { path })).toBeNull()
    acquireLock(100, "/out/a", { path })
    expect(liveLockOwner(null, { path, alive: () => false })).toBeNull()
    expect(liveLockOwner(100, { path, alive: () => true })).toBeNull()
    expect(liveLockOwner(null, { path, alive: () => true })?.outDir).toBe("/out/a")
  })
})

describe("drive start/stop with the lock", () => {
  const specFor = (outDir: string): DriveSpec => ({
    outDir, tiers: ["qwen3:4b"], arms: [{ id: "a" }], k: 1, tasks: ["t1"], contention: "off",
    runnerCmd: ["bun", "-e", "setInterval(() => {}, 1000)"],
  })

  it("startDrive refuses while another live supervisor holds the lock", () => {
    // this test process is a live pid that is not prior.pid (null): a foreign live holder
    acquireLock(process.ppid, "/out/other", { path })
    const r = startDrive(specFor(join(dir, "out-b")))
    expect(r.error).toBe(true)
    expect(r.message).toContain("/out/other")
    expect(existsSync(join(dir, "out-b", "state.json"))).toBe(false) // nothing was written or spawned
  })

  it("stopDrive releases the lock its supervisor held", async () => {
    const outDir = join(dir, "out-c")
    const spec = specFor(outDir)
    const deadPid = 2 ** 22 + 12345 // above pid_max: never alive
    writeState({ ...newState(spec), pid: deadPid, status: "running" })
    acquireLock(deadPid, outDir, { path })
    expect(readLock(path)?.pid).toBe(deadPid)
    expect(await stopDrive(outDir, 100)).toBe("not running")
    expect(existsSync(path)).toBe(false)
    expect(readLock(path)).toBeNull()
  })
})
