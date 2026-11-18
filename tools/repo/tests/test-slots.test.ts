import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireSlot, release, runningCount, slotCount, SLOT_HELD_ENV, tryAcquire } from "../src/lib/test-slots.ts"

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "repo-slots-"))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A PID that just exited (dead, and unlikely to be reused within the test). */
const deadPid = (): number => spawnSync("true").pid as number
/** Env for a child that must take its own slot (this runner itself runs under a held slot). */
const childEnv = (d: string): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { ...process.env, REPO_TEST_SLOTS_DIR: d, REPO_TEST_SLOTS: "1" }
  delete env[SLOT_HELD_ENV]
  return env
}
/** A PID that is alive: the test runner's parent. */
const livePid = process.ppid

describe("slotCount", () => {
  test("REPO_TEST_SLOTS wins when a positive integer; else max(2, floor(cores/3))", () => {
    expect(slotCount({ REPO_TEST_SLOTS: "3" }, 16)).toBe(3)
    expect(slotCount({ REPO_TEST_SLOTS: "0" }, 16)).toBe(5)
    expect(slotCount({ REPO_TEST_SLOTS: "x" }, 6)).toBe(2)
    expect(slotCount({}, 2)).toBe(2)
  })
})

describe("tryAcquire / release", () => {
  test("takes free slots up to the cap, then refuses; release frees one", () => {
    const d = tmp()
    const a = tryAcquire(d, 2)
    const b = tryAcquire(d, 2)
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a).not.toBe(b)
    expect(tryAcquire(d, 2)).toBeUndefined()
    expect(runningCount(d)).toBe(2)
    release(a as string)
    expect(existsSync(a as string)).toBe(false)
    expect(tryAcquire(d, 2)).toBe(a)
  })
  test("release only removes a lock this pid holds", () => {
    const d = tmp()
    const p = tryAcquire(d, 1, livePid) as string
    release(p)
    expect(readFileSync(p, "utf8")).toBe(String(livePid))
  })
  test("a lock held by a dead pid is stale and is taken over", () => {
    const d = tmp()
    writeFileSync(join(d, "slot-0.lock"), String(deadPid()))
    expect(runningCount(d)).toBe(0)
    const p = tryAcquire(d, 1)
    expect(p).toBe(join(d, "slot-0.lock"))
    expect(readFileSync(p as string, "utf8")).toBe(String(process.pid))
  })
  test("a live holder is never taken over", () => {
    const d = tmp()
    writeFileSync(join(d, "slot-0.lock"), String(livePid))
    expect(tryAcquire(d, 1)).toBeUndefined()
  })
  test("an empty (torn) lock is held briefly, then reclaimed once old", () => {
    const d = tmp()
    const f = join(d, "slot-0.lock")
    writeFileSync(f, "")
    expect(tryAcquire(d, 1)).toBeUndefined()
    const old = Date.now() / 1000 - 60
    utimesSync(f, old, old)
    expect(tryAcquire(d, 1)).toBe(f)
  })
})

describe("acquireSlot", () => {
  test("nested run (slot already held up the tree) takes no lock", async () => {
    const d = tmp()
    const s = await acquireSlot(() => {}, { [SLOT_HELD_ENV]: "1", REPO_TEST_SLOTS_DIR: d, REPO_TEST_SLOTS: "1" })
    expect(s.path).toBeUndefined()
    expect(runningCount(d)).toBe(0)
  })
  test("waits with one line while full, proceeds when the holder releases", async () => {
    const d = tmp()
    const env = { REPO_TEST_SLOTS_DIR: d, REPO_TEST_SLOTS: "1" }
    const first = await acquireSlot(() => {}, env)
    const lines: string[] = []
    let got = false
    const second = acquireSlot((l) => lines.push(l), env).then((s) => ((got = true), s))
    await new Promise((r) => setTimeout(r, 700))
    expect(got).toBe(false)
    expect(lines).toEqual(["waiting for a test slot (1 running, 1 max; REPO_TEST_SLOTS overrides)"])
    first.release()
    const s2 = await second
    expect(s2.path).toBe(join(d, "slot-0.lock"))
    expect(lines.length).toBe(1)
    s2.release()
    expect(existsSync(join(d, "slot-0.lock"))).toBe(false)
  })
  test("a killed holder's slot is recovered by the next run", async () => {
    const d = tmp()
    const env = childEnv(d)
    const script = `const { acquireSlot } = await import(${JSON.stringify(join(import.meta.dir, "../src/lib/test-slots.ts"))}); await acquireSlot(() => {}); process.kill(process.pid, "SIGKILL")`
    spawnSync("bun", ["-e", script], { env })
    expect(existsSync(join(d, "slot-0.lock"))).toBe(true)
    const s = await acquireSlot(() => {}, env)
    expect(s.path).toBe(join(d, "slot-0.lock"))
    s.release()
  })
  test("SIGTERM while holding releases the slot", () => {
    const d = tmp()
    const env = childEnv(d)
    const script = `const { acquireSlot } = await import(${JSON.stringify(join(import.meta.dir, "../src/lib/test-slots.ts"))}); await acquireSlot(() => {}); process.kill(process.pid, "SIGTERM"); await new Promise((r) => setTimeout(r, 5000))`
    const r = spawnSync("bun", ["-e", script], { env })
    expect(r.status).toBe(143)
    expect(existsSync(join(d, "slot-0.lock"))).toBe(false)
  })
})
