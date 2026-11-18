import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { describeRun, suiteChunks, sumRuns, type TestRun } from "../src/commands/test.ts"
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
    expect(summarizeBunTest(log)).toEqual({ pass: 136, fail: 0, skip: 2, errors: 0, failures: [], details: {} })
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
  test("details carry the assertion, diff and first frame of each failure", () => {
    const log = [
      "3 |   test(\"eq\", () => { expect(1 + 1).toBe(3) })",
      "                                       ^",
      "error: expect(received).toBe(expected)",
      "",
      "Expected: 3",
      "Received: 2",
      "",
      "      at <anonymous> (/r/x.test.ts:3:42)",
      "      at other (/r/y.ts:1:1)",
      "(fail) s > eq [1.00ms]",
      "error: expect(received).toEqual(expected)",
      "@@ -1,3 +1,3 @@",
      "-   \"a\": 2,",
      "+   \"a\": 1,",
      "- Expected  - 1",
      "+ Received  + 1",
      "(fail) s > obj",
      "(fail) s > no block",
      " 0 pass",
      " 3 fail",
    ].join("\n")
    const s = summarizeBunTest(log)
    expect(s.details["s > eq"]).toEqual([
      "error: expect(received).toBe(expected)",
      "Expected: 3",
      "Received: 2",
      "at /r/x.test.ts:3:42",
    ])
    expect(s.details["s > obj"]).toEqual(["error: expect(received).toEqual(expected)", "-   \"a\": 2,", "+   \"a\": 1,"])
    expect(s.details["s > no block"]).toBeUndefined()
  })
})

describe("unhandled errors between tests", () => {
  // Shape of the v0.19.0 preflight chunk-4 log: 0 fail, 1 error, bun exit 1.
  const log = [
    "bun test v1.3.10 (30e609e0)",
    "",
    "packages/trace/tests/ok.test.ts:",
    "(pass) a > b [1.00ms]",
    "",
    "packages/trace/tests/attribution-docs-table.test.ts:",
    "",
    "# Unhandled error between tests",
    "-------------------------------",
    "16 |   if (start < 0) throw new Error(\"cli.md: no table\");",
    "                                                     ^",
    "error: cli.md: no table",
    "      at reasonsTable (/r/packages/trace/tests/attribution-docs-table.test.ts:16:81)",
    "      at <anonymous> (/r/packages/trace/tests/attribution-docs-table.test.ts:40:16)",
    "-------------------------------",
    "",
    "packages/trace/tests/later.test.ts:",
    "error: expect(received).toBe(expected)",
    "(fail) later > real failure [1.00ms]",
    "",
    " 8273 pass",
    " 2 skip",
    " 1 fail",
    " 1 error",
    "Ran 8276 tests across 807 files. [148.28s]",
  ].join("\n")
  test("counts the error and names the file and message", () => {
    const s = summarizeBunTest(log)
    expect(s.errors).toBe(1)
    const name = "unhandled error in packages/trace/tests/attribution-docs-table.test.ts: cli.md: no table"
    expect(s.failures).toEqual([name, "later > real failure"])
    expect(s.details[name]).toEqual([
      "error: cli.md: no table",
      "at reasonsTable (/r/packages/trace/tests/attribution-docs-table.test.ts:16:81",
    ])
    expect(s.details["later > real failure"]).toEqual(["error: expect(received).toBe(expected)"])
  })
  test("0 fail + 1 error is a failed run whose summary shows the error", () => {
    const zeroFail = log.replace(" 1 fail", " 0 fail").replace(/packages\/trace\/tests\/later[\s\S]*?\(fail\)[^\n]*\n/, "")
    const summary = summarizeBunTest(zeroFail)
    expect(summary.fail).toBe(0)
    expect(summary.errors).toBe(1)
    const lines = describeRun({ exit: 1, summary, log: ".repo-logs/x.log", failed: true, timedOut: false, maxSeconds: 600, root: "/r" })
    expect(lines[0]).toBe("8273 pass, 0 fail, 2 skip, 1 error")
    expect(lines[1]).toContain("unhandled error in packages/trace/tests/attribution-docs-table.test.ts")
    expect(lines).not.toContain("bun test exited 1")
  })
  test("a clean footer reports 0 errors; a footer-less log reports null", () => {
    expect(summarizeBunTest(" 3 pass\n 0 fail\n").errors).toBe(0)
    expect(summarizeBunTest("crash\n").errors).toBeNull()
  })
  test("unexplained non-zero exit is printed", () => {
    const summary = summarizeBunTest(" 3 pass\n 0 fail\n")
    const lines = describeRun({ exit: 1, summary, log: "l", failed: true, timedOut: false, maxSeconds: 600 })
    expect(lines).toContain("bun test exited 1")
  })
})

describe("suite chunks", () => {
  test("one chunk per package/app/tool holding a test file, plus scripts; no node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-chunks-"))
    try {
      for (const f of [
        "packages/a/tests/x.test.ts",
        "packages/b/src/deep/y.spec.tsx",
        "packages/c/src/index.ts",
        "packages/d/node_modules/z/z.test.ts",
        "apps/web/tests/w.test.ts",
        "tools/repo/tests/r.test.ts",
        "scripts/s.test.ts",
      ]) {
        mkdirSync(join(root, f, ".."), { recursive: true })
        writeFileSync(join(root, f), "")
      }
      expect(suiteChunks(root)).toEqual(["apps/web", "packages/a", "packages/b", "scripts", "tools/repo"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  test("sumRuns adds counts; one unknown makes the total unknown", () => {
    const run = (pass: number | null, errors: number | null): TestRun => ({
      exit: 0,
      summary: { pass, fail: 0, skip: 1, errors, failures: [], details: {} },
      log: "l",
      failed: false,
      timedOut: false,
      maxSeconds: 1,
    })
    expect(sumRuns([run(2, 0), run(3, 1)])).toEqual({ pass: 5, fail: 0, skip: 2, errors: 1 })
    expect(sumRuns([run(2, 0), run(null, 0)]).pass).toBeNull()
  })
})

describe("summarizeBunTest formats", () => {
  test("✗ lines, with ANSI colour, keep names", () => {
    const log = "\u001b[31m✗\u001b[0m suite > broken thing \u001b[90m[3.00ms]\u001b[0m\n 1 pass\n 1 fail\n"
    const s = summarizeBunTest(log)
    expect(s.failures).toEqual(["suite > broken thing"])
    expect(s.fail).toBe(1)
  })
  test("✗ and (fail) for the same test de-duplicate", () => {
    const s = summarizeBunTest("✗ a > b [1ms]\n(fail) a > b [1ms]\n 0 pass\n 1 fail\n")
    expect(s.failures).toEqual(["a > b"])
  })
})

describe("repo test", () => {
  test("positional equal to a flag value is kept", async () => {
    const c = capture()
    expect(await main(["test", "--timeout", "15000", "15000"], c.s)).toBe(1)
    expect(c.err()).toContain("log: ")
  }, 60_000)
  test("bad --max-seconds exits 2", async () => {
    const c = capture()
    expect(await main(["test", "x", "--max-seconds", "0"], c.s)).toBe(2)
  })
  test("wall-clock limit kills the child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repo-timeout-"))
    try {
      const f = join(dir, "sleep.test.ts")
      writeFileSync(f, 'import { test } from "bun:test"\ntest("sleeps", async () => { await new Promise((r) => setTimeout(r, 30000)) }, 40000)\n')
      const c = capture()
      const code = await main(["test", f, "--max-seconds", "1", "--root", REPO], c.s)
      expect(code).toBe(1)
      expect(c.err()).toContain("fail: timeout after 1s")
      const lines = c.err().trimEnd().split("\n")
      expect(lines.at(-1)).toMatch(/^next: open \.repo-logs\/test-.*-\d+\.log$/)
      const log = /log: (.+)/.exec(c.err())?.[1] as string
      expect(existsSync(join(REPO, log))).toBe(true)
      expect(readFileSync(join(REPO, log), "utf8")).not.toContain("\u001b[")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
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
  test("--all with paths exits 2", async () => {
    const c = capture()
    expect(await main(["test", "--all", "x"], c.s)).toBe(2)
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo test --all")
  })
  test("--all runs one chunk per package and names the failing chunk", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-test-all-"))
    try {
      for (const [dir, body] of [
        ["packages/good/tests", 'test("ok", () => expect(1).toBe(1))'],
        ["packages/bad/tests", 'test("ok", () => expect(1).toBe(1))\nthrow new Error("boom at load")'],
        ["packages/empty/src", null],
      ] as const) {
        mkdirSync(join(root, dir), { recursive: true })
        if (body !== null) writeFileSync(join(root, dir, "x.test.ts"), `import { expect, test } from "bun:test"\n${body}\n`)
      }
      const c = capture()
      const code = await main(["test", "--all", "--root", root], c.s)
      expect(code).toBe(1)
      const err = c.err()
      expect(c.out()).toContain("running 2 chunks")
      expect(err).toContain("✗ packages/bad")
      expect(err).not.toContain("✗ packages/good")
      expect(err).toContain("boom at load")
      expect(err.trimEnd().split("\n").at(-1)).toBe("next: bun run repo test ./packages/bad")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
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
