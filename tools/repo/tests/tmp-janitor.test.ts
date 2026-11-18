import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memCapped } from "../src/commands/test.ts"
import { assessPressure, parseMemAvailable } from "../src/lib/mem-guard.ts"
import { type JanitorFs, makeTestRoot, realFs, rootPid, sweep } from "../src/lib/tmp-janitor.ts"

const HOUR = 3600_000
const NOW = 1_000_000 * HOUR

/** In-memory fs: name -> {mtime, bytes}. */
function fakeFs(entries: Record<string, { age: number; bytes: number }>): { fs: JanitorFs; removed: string[] } {
  const removed: string[] = []
  const base = (p: string): string => p.slice(p.lastIndexOf("/") + 1)
  return {
    removed,
    fs: {
      list: () => Object.keys(entries),
      mtimeMs: (p) => {
        const e = entries[base(p)]
        return e === undefined ? undefined : NOW - e.age
      },
      bytes: (p) => entries[base(p)]?.bytes ?? 0,
      remove: (p) => void removed.push(base(p)),
    },
  }
}
const alive = (...pids: number[]) => (pid: number): boolean => pids.includes(pid)

describe("rootPid", () => {
  test("parses roots only", () => {
    expect(rootPid("ra-tests-4242-AbC123")).toBe(4242)
    expect(rootPid("ra-test-traces-AbC123")).toBeUndefined()
    expect(rootPid("ra-tests-x-AbC123")).toBeUndefined()
  })
})

describe("sweep", () => {
  const entries = {
    "ra-tests-100-aaaaaa": { age: 5, bytes: 1000 }, // dead pid, fresh: still reaped
    "ra-tests-200-bbbbbb": { age: 99 * HOUR, bytes: 500 }, // live pid, ancient: never touched
    "ra-edit-xyz123": { age: 2 * HOUR, bytes: 10 }, // legacy, old
    "ra-ep-xyz123": { age: 10 * 60_000, bytes: 10 }, // legacy, fresh: kept
    "corrective-guard-q1": { age: 3 * HOUR, bytes: 7 },
    "w3b-triad-q1": { age: 3 * HOUR, bytes: 3 },
    "rax-clean-install-test-q1": { age: 3 * HOUR, bytes: 100 },
    "repo-test-slots-tyler": { age: 99 * HOUR, bytes: 1 }, // protected
    "claude-1000": { age: 99 * HOUR, bytes: 1 }, // not ours
  }
  test("reaps dead-pid roots and old legacy dirs, never live roots", () => {
    const { fs, removed } = fakeFs(entries)
    const r = sweep(fs, "/t", { pidAlive: alive(200), now: NOW, legacy: true, dryRun: false })
    expect(removed.sort()).toEqual(
      ["corrective-guard-q1", "ra-edit-xyz123", "ra-tests-100-aaaaaa", "rax-clean-install-test-q1", "w3b-triad-q1"].sort(),
    )
    expect(r.bytes).toBe(1000 + 10 + 7 + 3 + 100)
    expect(r.liveRoots).toBe(1)
  })
  test("dry run reports bytes but removes nothing", () => {
    const { fs, removed } = fakeFs(entries)
    const r = sweep(fs, "/t", { pidAlive: alive(200), now: NOW, legacy: true, dryRun: true })
    expect(removed).toEqual([])
    expect(r.reaped.length).toBe(5)
  })
  test("cheap path (legacy: false) touches only dead-pid roots", () => {
    const { fs, removed } = fakeFs(entries)
    sweep(fs, "/t", { pidAlive: alive(200), now: NOW, legacy: false, dryRun: false })
    expect(removed).toEqual(["ra-tests-100-aaaaaa"])
  })
})

describe("real fs", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "jt-sandbox-"))
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }))
  test("makeTestRoot embeds the pid; sweep reaps a dead one and spares a live one", () => {
    const live = makeTestRoot(sandbox, process.pid)
    const dead = makeTestRoot(sandbox, 2_147_483_000)
    writeFileSync(join(dead, "f.txt"), "12345")
    const legacy = join(sandbox, "ra-edit-old001")
    mkdirSync(legacy)
    const old = new Date(Date.now() - 2 * HOUR)
    utimesSync(legacy, old, old)
    const r = sweep(realFs, sandbox, {
      pidAlive: (p) => p === process.pid,
      now: Date.now(),
      legacy: true,
      dryRun: false,
    })
    expect(existsSync(live)).toBe(true)
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(legacy)).toBe(false)
    expect(r.bytes).toBeGreaterThanOrEqual(5)
  })
})

describe("mem-guard", () => {
  test("parses MemAvailable", () => {
    expect(parseMemAvailable("MemTotal: 1 kB\nMemAvailable:    2048 kB\n")).toBe(2048 * 1024)
    expect(parseMemAvailable("nothing")).toBeUndefined()
  })
  test("levels", () => {
    const GB = 1024 ** 3
    expect(assessPressure({ memAvailableBytes: 8 * GB, tmpfsUsedFrac: 0.1 }).level).toBe("ok")
    expect(assessPressure({ memAvailableBytes: 2 * GB }).level).toBe("warn")
    expect(assessPressure({ memAvailableBytes: 0.5 * GB }).level).toBe("refuse")
    expect(assessPressure({ memAvailableBytes: 8 * GB, tmpfsUsedFrac: 0.6 }).level).toBe("warn")
    expect(assessPressure({ memAvailableBytes: 8 * GB, tmpfsUsedFrac: 0.9 }).level).toBe("refuse")
    expect(assessPressure({}).level).toBe("ok")
  })
})

describe("memCapped", () => {
  const argv = ["bun", "test", "x"]
  test("no cap: unchanged", () => {
    expect(memCapped(argv, {}, true)).toEqual(["bun", ["test", "x"]])
  })
  test("cap wraps in a systemd scope without swap", () => {
    const [cmd, args] = memCapped(argv, { REPO_TEST_MEM_MAX: "8G" }, true)
    expect(cmd).toBe("systemd-run")
    expect(args).toEqual(["--user", "--scope", "--quiet", "-p", "MemoryMax=8G", "-p", "MemorySwapMax=0", "bun", "test", "x"])
  })
  test("no systemd-run or bad value: unchanged", () => {
    expect(memCapped(argv, { REPO_TEST_MEM_MAX: "8G" }, false)[0]).toBe("bun")
    expect(memCapped(argv, { REPO_TEST_MEM_MAX: "lots" }, true)[0]).toBe("bun")
  })
})
