import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pressureStop } from "../src/commands/janitor.ts"
import { memCapped, runAllTests } from "../src/commands/test.ts"
import { assessPressure, parseMemAvailable, parseMeminfo } from "../src/lib/mem-guard.ts"
import { makeIo } from "../src/lib/output.ts"
import {
  bigTmpEntries,
  COMPILE_CACHE,
  type JanitorFs,
  makeTestRoot,
  realFs,
  reapCompileCache,
  rootPid,
  staleWorktrees,
  sweep,
} from "../src/lib/tmp-janitor.ts"

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
  const meminfo = (availKb: number, swapTotalKb: number, swapFreeKb: number): string =>
    `MemTotal:       31926948 kB\nMemAvailable:   ${availKb} kB\nSwapTotal:       ${swapTotalKb} kB\nSwapFree:        ${swapFreeKb} kB\n`
  const KB_GB = 1024 * 1024
  test("parses swap used; no swap leaves it unset", () => {
    const p = parseMeminfo(meminfo(17 * KB_GB, 8 * KB_GB, 2 * KB_GB))
    expect(p.memAvailableBytes).toBe(17 * 1024 ** 3)
    expect(p.swapUsedFrac).toBeCloseTo(0.75)
    expect(parseMeminfo(meminfo(17 * KB_GB, 0, 0)).swapUsedFrac).toBeUndefined()
  })
  test("2026-11-19 OOM reading (17 GB available, 8 GB swap exhausted) is not ok", () => {
    const v = assessPressure(parseMeminfo(meminfo(17 * KB_GB, 8 * KB_GB, 0)))
    expect(v.level).not.toBe("ok")
    expect(v.lines.join(" ")).toContain("swap 100% full")
  })
  test("swap levels", () => {
    const GB = 1024 ** 3
    // 90% swap with plenty of RAM: today's steady state on zram, no noise
    expect(assessPressure({ memAvailableBytes: 19 * GB, swapUsedFrac: 0.9 }).level).toBe("ok")
    expect(assessPressure({ memAvailableBytes: 5 * GB, swapUsedFrac: 0.95 }).level).toBe("warn")
    expect(assessPressure({ memAvailableBytes: 7 * GB, swapUsedFrac: 0.95 }).level).toBe("ok")
    expect(assessPressure({ memAvailableBytes: 2.5 * GB, swapUsedFrac: 0.98 }).level).toBe("refuse")
    expect(assessPressure({ memAvailableBytes: 2.5 * GB, swapUsedFrac: 0.95 }).level).toBe("warn")
    expect(assessPressure({ swapUsedFrac: 0.99 }).level).toBe("warn")
  })
  test("pressureStop: a reason only on refuse; a throwing reader never stops a run", () => {
    expect(pressureStop(() => ({ level: "refuse", lines: ["a", "b"] }))).toBe("a; b")
    expect(pressureStop(() => ({ level: "warn", lines: ["a"] }))).toBeUndefined()
    expect(
      pressureStop(() => {
        throw new Error("no /proc")
      }),
    ).toBeUndefined()
  })
})

describe("compile cache", () => {
  const MB = 1024 ** 2
  test("reaped when older than 24 h or larger than 512 MB; kept otherwise", () => {
    for (const [e, reaped] of [
      [{ age: 25 * HOUR, bytes: 10 * MB }, true],
      [{ age: 1 * HOUR, bytes: 826 * MB }, true],
      [{ age: 1 * HOUR, bytes: 100 * MB }, false],
    ] as const) {
      const { fs, removed } = fakeFs({ [COMPILE_CACHE]: e })
      const r = reapCompileCache(fs, "/tmp", { now: NOW, dryRun: false })
      expect(r !== undefined).toBe(reaped)
      expect(removed).toEqual(reaped ? [COMPILE_CACHE] : [])
    }
  })
  test("dry run removes nothing; absent cache is a no-op", () => {
    const { fs, removed } = fakeFs({ [COMPILE_CACHE]: { age: 30 * HOUR, bytes: 5 } })
    expect(reapCompileCache(fs, "/tmp", { now: NOW, dryRun: true })?.reason).toBe("compile-cache")
    expect(removed).toEqual([])
    expect(reapCompileCache(fakeFs({}).fs, "/tmp", { now: NOW, dryRun: false })).toBeUndefined()
  })
  test("sweep never treats the compile cache as a legacy test dir", () => {
    const { fs, removed } = fakeFs({ [COMPILE_CACHE]: { age: 99 * HOUR, bytes: 1 } })
    sweep(fs, "/tmp", { pidAlive: alive(), now: NOW, legacy: true, dryRun: false })
    expect(removed).toEqual([])
  })
})

describe("hog report", () => {
  test("stale worktrees get size and the exact remove command; fresh ones are not sized", () => {
    let sized = 0
    const hogs = staleWorktrees(
      [
        { path: "/r/.claude/worktrees/agent-old", lastActiveMs: NOW - 30 * HOUR, bytes: () => ++sized * 1000 },
        { path: "/r/.claude/worktrees/agent-new", lastActiveMs: NOW - 2 * HOUR, bytes: () => ++sized * 1000 },
      ],
      NOW,
    )
    expect(hogs).toEqual([{ path: "/r/.claude/worktrees/agent-old", bytes: 1000, kind: "stale-worktree", idleHours: 30, fix: "git worktree remove /r/.claude/worktrees/agent-old" }])
    expect(sized).toBe(1)
  })
  test("big temp entries: only > 500 MB, never janitor-owned or claude-*", () => {
    const MB = 1024 ** 2
    const hogs = bigTmpEntries(
      "/tmp",
      new Map([
        ["huge-thing", 2000 * MB],
        ["mid-thing", 600 * MB],
        ["small", 10 * MB],
        ["claude-1000", 9000 * MB],
        [COMPILE_CACHE, 900 * MB],
        ["ra-tests-1-abcdef", 900 * MB],
        ["repo-test-slots-x", 900 * MB],
      ]),
    )
    expect(hogs.map((h) => h.path)).toEqual(["/tmp/huge-thing", "/tmp/mid-thing"])
    expect(hogs[0]?.fix).toContain("ls -ld /tmp/huge-thing")
  })
})

describe("runAllTests memory stop", () => {
  test("a refusing guard starts no chunk and names the chunks not run", async () => {
    const root = mkdtempSync(join(tmpdir(), "ra-allstop-"))
    try {
      for (const k of ["a", "b"]) {
        mkdirSync(join(root, "packages", k), { recursive: true })
        writeFileSync(join(root, "packages", k, "x.test.ts"), "")
      }
      const out: string[] = []
      const io = makeIo(false, { stdout: (s) => void out.push(s), stderr: (s) => void out.push(s) })
      const code = await runAllTests(root, "1000", io, 60, undefined, () => "swap 100% full")
      io.flush()
      const text = out.join("\n")
      expect(code).toBe(1)
      expect(text).toContain("not run (memory guard: swap 100% full): packages/a packages/b")
      expect(text).toContain("across 0 chunks, 2 not run")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
