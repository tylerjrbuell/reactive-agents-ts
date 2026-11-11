import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { benchRunDirPrefix, cleanupStaleBenchDirs } from "../src/runner.js"

// A concurrent session sharing the cwd must never lose its live fixture dir
// (2026-11-10 budget-answer-turn ablation: one tier's sweep wiped another's).
describe("cleanupStaleBenchDirs", () => {
  let base = ""
  afterEach(() => {
    if (base) rmSync(base, { recursive: true, force: true })
  })

  it("keeps dirs owned by a live process and removes dead-owner and old legacy dirs", () => {
    base = mkdtempSync(join(tmpdir(), "bench-sweep-"))
    const live = join(base, `${benchRunDirPrefix(process.pid)}abc`)
    const dead = join(base, `${benchRunDirPrefix(2 ** 22 + 7)}abc`) // above pid_max default: never alive
    const legacyFresh = join(base, ".bench-run-fresh")
    const legacyOld = join(base, ".bench-run-old")
    for (const d of [live, dead, legacyFresh, legacyOld]) mkdirSync(d)
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000)
    utimesSync(legacyOld, old, old)

    expect(cleanupStaleBenchDirs(base)).toBe(2)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(legacyFresh)).toBe(true)
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(legacyOld)).toBe(false)
  })
})
