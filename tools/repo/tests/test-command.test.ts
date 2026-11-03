import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { summarizeBunTest } from "../src/lib/bun-test-summary.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return { s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) }, out: () => o, err: () => e }
}

describe("summarizeBunTest", () => {
  test("counts from footer", () => {
    const log = "bun test v1.3.10\n\n 136 pass\n 2 skip\n 0 fail\nRan 138 tests across 3 files. [1.20s]\n"
    expect(summarizeBunTest(log)).toEqual({ pass: 136, fail: 0, skip: 2, failures: [] })
  })
  test("fail names in order, duration stripped", () => {
    const log = [
      "(fail) suite > first thing [12.00ms]",
      "(pass) suite > ok [1.00ms]",
      "(fail) other > second",
      " 1 pass",
      " 2 fail",
    ].join("\n")
    const s = summarizeBunTest(log)
    expect(s.failures).toEqual(["suite > first thing", "other > second"])
    expect(s.fail).toBe(2)
    expect(s.skip).toBe(0)
  })
  test("crash log with no summary is all null", () => {
    const s = summarizeBunTest("error: Cannot find module './nope.ts' from '/x/y.test.ts'\n")
    expect(s.pass).toBeNull()
    expect(s.fail).toBeNull()
    expect(s.skip).toBeNull()
    expect(s.failures).toEqual(["Cannot find module './nope.ts' from '/x/y.test.ts'"])
  })
  test("error: lines do not duplicate (fail) lines", () => {
    const s = summarizeBunTest("error: expect(received).toBe(expected)\n(fail) a > b [1ms]\n 0 pass\n 1 fail\n")
    expect(s.failures).toEqual(["a > b"])
  })
})

describe("repo test", () => {
  test("no paths exits 2 with next last", async () => {
    const c = capture()
    expect(await main(["test"], c.s)).toBe(2)
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo test <paths…>")
  })
  test("unknown flag exits 2", async () => {
    const c = capture()
    expect(await main(["test", "x", "--bogus"], c.s)).toBe(2)
  })
  test("bad timeout exits 2", async () => {
    const c = capture()
    expect(await main(["test", "x", "--timeout", "abc"], c.s)).toBe(2)
  })
  test("runs a scoped test, logs it", async () => {
    const c = capture()
    const code = await main(["test", "tools/repo/tests/catalog.test.ts"], c.s)
    expect(code).toBe(0)
    expect(c.out()).toMatch(/\d+ pass, 0 fail, \d+ skip/)
    const log = /log: (.+)\n/.exec(c.out())?.[1]
    expect(log).toBeDefined()
    expect(existsSync(join(REPO, log as string))).toBe(true)
  }, 60_000)
})
