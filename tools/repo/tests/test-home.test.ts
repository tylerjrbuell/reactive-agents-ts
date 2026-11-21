import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseWorktreeList } from "../src/commands/janitor.ts"
import { testRootEnv } from "../src/commands/test.ts"
import { BUN_CACHE_REPORT_BYTES, cacheHogs, testMemoryLeftovers, TURBO_REPORT_BYTES } from "../src/lib/dev-hogs.ts"
import { installMcpAuthIsolation, makeTestHome, MCP_AUTH_DIR_ENV, REAL_HOME_ENV, realHome } from "../src/lib/test-home.ts"
import { staleWorktrees, TEST_ROOT_ENV } from "../src/lib/tmp-janitor.ts"

const ROOT = resolve(import.meta.dir, "../../..")
const scratch = mkdtempSync(join(tmpdir(), "repo-test-home-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe("makeTestHome", () => {
  test("mirrors every home entry as a symlink except .reactive-agents", () => {
    const real = join(scratch, "real")
    mkdirSync(join(real, ".reactive-agents", "memory"), { recursive: true })
    mkdirSync(join(real, ".bun"))
    writeFileSync(join(real, ".gitconfig"), "[user]\n")
    const home = makeTestHome(join(scratch, "root"), real)
    expect(readdirSync(home).sort()).toEqual([".bun", ".gitconfig"])
    expect(lstatSync(join(home, ".gitconfig")).isSymbolicLink()).toBe(true)
    // Removing the root removes the links, never the real entries behind them.
    rmSync(join(scratch, "root"), { recursive: true, force: true })
    expect(existsSync(join(real, ".gitconfig"))).toBe(true)
  })
  test("realHome prefers the outer runner's record", () => {
    expect(realHome({ [REAL_HOME_ENV]: "/home/dev" })).toBe("/home/dev")
  })
})

describe("installMcpAuthIsolation", () => {
  test("sets REACTIVE_AGENTS_MCP_AUTH_DIR to a fresh temp dir and removes it on exit", () => {
    const env: Record<string, string | undefined> = {}
    const exits: Array<() => void> = []
    const dir = installMcpAuthIsolation(env, (cleanup) => exits.push(cleanup))
    expect(dir).toBeDefined()
    expect(env[MCP_AUTH_DIR_ENV]).toBe(dir)
    expect(existsSync(dir!)).toBe(true)
    expect(exits).toHaveLength(1)
    exits[0]!()
    expect(existsSync(dir!)).toBe(false)
  })
  test("an outer value wins and nothing is created", () => {
    const env: Record<string, string | undefined> = { [MCP_AUTH_DIR_ENV]: "/outer/mcp-auth" }
    const exits: Array<() => void> = []
    expect(installMcpAuthIsolation(env, (cleanup) => exits.push(cleanup))).toBeUndefined()
    expect(env[MCP_AUTH_DIR_ENV]).toBe("/outer/mcp-auth")
    expect(exits).toHaveLength(0)
  })
  test("the preload already set it for this process, outside the real ~/.reactive-agents", () => {
    const dir = process.env[MCP_AUTH_DIR_ENV]
    expect(dir === undefined || dir.length === 0).toBe(false)
    expect(dir!.startsWith(join(realHome(), ".reactive-agents"))).toBe(false)
  })
})

/**
 * The leak this pins: memory-guardrails.test.ts builds memory layers with default db paths, which wrote a
 * `guardrail-test-<uuid>` dir per test into the developer's real ~/.reactive-agents/memory (1,986 of them
 * by 2026-11-19).
 */
describe("a leaking suite no longer writes into the real ~/.reactive-agents", () => {
  const SUITE = "packages/runtime/tests/memory-guardrails.test.ts"
  const memDir = join(realHome(), ".reactive-agents", "memory")
  const leaked = (): Set<string> => {
    try {
      return new Set(readdirSync(memDir).filter((n) => n.startsWith("guardrail-test-")))
    } catch {
      return new Set()
    }
  }
  const runSuite = (env: Record<string, string | undefined>): number | null =>
    spawnSync("bun", ["test", SUITE, "--timeout", "15000"], { cwd: ROOT, env, stdio: "ignore", timeout: 120_000 }).status

  test("repo test env: the suite writes into the root's mirror home only", () => {
    const before = leaked()
    const root = mkdtempSync(join(scratch, "ra-root-"))
    expect(runSuite({ ...process.env, ...testRootEnv(root) })).toBe(0)
    // Positive control: the suite does write memory dirs; they land in the mirror home.
    expect(readdirSync(join(root, "home", ".reactive-agents", "memory")).some((n) => n.startsWith("guardrail-test-"))).toBe(true)
    expect([...leaked()].filter((n) => !before.has(n))).toEqual([])
  }, 130_000)

  test("raw bun test (preload only): no new entries in the real home", () => {
    const before = leaked()
    const env: Record<string, string | undefined> = { ...process.env, HOME: realHome() }
    delete env[TEST_ROOT_ENV]
    delete env[REAL_HOME_ENV]
    expect(runSuite(env)).toBe(0)
    expect([...leaked()].filter((n) => !before.has(n))).toEqual([])
  }, 130_000)
})

describe("janitor report: worktrees, test leftovers, caches", () => {
  test("parseWorktreeList keeps every linked worktree, drops the main one and self, reads prunable and locked", () => {
    const porcelain = [
      "worktree /repo\nHEAD abc\nbranch refs/heads/dev",
      "worktree /home/u/pp-wt\nHEAD def\ndetached",
      "worktree /repo/.claude/worktrees/agent-1\nHEAD 123\nbranch refs/heads/x\nlocked claude agent",
      "worktree /home/u/gone\nHEAD 456\ndetached\nprunable gitdir file points to non-existent location",
      "worktree /self\nHEAD 789\ndetached",
      "",
    ].join("\n\n")
    expect(parseWorktreeList(porcelain, "/self")).toEqual([
      { path: "/home/u/pp-wt", prunable: false, locked: false },
      { path: "/repo/.claude/worktrees/agent-1", prunable: false, locked: true },
      { path: "/home/u/gone", prunable: true, locked: false },
    ])
  })
  test("prunable worktrees are reported with `git worktree prune`; locked ones say unlock first", () => {
    const hogs = staleWorktrees(
      [
        { path: "/home/u/gone", lastActiveMs: 0, bytes: () => 99, prunable: true },
        { path: "/home/u/held", lastActiveMs: 0, bytes: () => 5, locked: true },
      ],
      100 * 3_600_000,
    )
    expect(hogs[0]).toMatchObject({ bytes: 0, label: "directory gone" })
    expect(hogs[0]?.fix).toStartWith("git worktree prune")
    expect(hogs[1]?.fix).toStartWith("git worktree unlock /home/u/held && git worktree remove /home/u/held")
  })
  test("test-fixture memory dirs group by prefix with a scoped delete; real agents are ignored", () => {
    const hogs = testMemoryLeftovers(
      "/h/.reactive-agents/memory",
      new Map([
        ["sub-grand-1795101458462", 300],
        ["sub-grand-1795101458463", 300],
        ["guardrail-test-36acf0b7-e5bf-4d65-b36f-5d0ca60bbe17", 200],
        ["chat-titler-1793131378168", 9000],
        ["my-agent", 9000],
      ]),
    )
    expect(hogs.map((h) => [h.label, h.count, h.bytes])).toEqual([
      ["sub-grand-", 2, 600],
      ["guardrail-test-", 1, 200],
    ])
    expect(hogs[0]?.fix).toBe("find /h/.reactive-agents/memory -maxdepth 1 -name 'sub-grand-*' -exec rm -rf {} +")
  })
  test("caches are reported only above their thresholds", () => {
    const small = cacheHogs({ turbo: { path: "/r/.turbo", bytes: TURBO_REPORT_BYTES }, bun: { path: "/c", bytes: BUN_CACHE_REPORT_BYTES } })
    expect(small).toEqual([])
    const big = cacheHogs({ turbo: { path: "/r/.turbo", bytes: TURBO_REPORT_BYTES + 1 }, bun: { path: "/c", bytes: BUN_CACHE_REPORT_BYTES + 1 } })
    expect(big.map((h) => h.fix.split("   #")[0])).toEqual(["rm -rf /r/.turbo", "bun pm cache rm"])
  })
})
