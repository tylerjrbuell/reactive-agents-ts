import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { evaluate, listSessions, loadBaseline, measureBefore, measureSessions, transcriptDir } from "../src/commands/session-stats.ts"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const turn = (...blocks: object[]): string => JSON.stringify({ type: "assistant", message: { role: "assistant", content: blocks } })
const use = (name: string, input: object, id = "t"): object => ({ type: "tool_use", id, name, input })
const bash = (command: string): string => turn(use("Bash", { command }))
const result = (id: string, content: unknown): string =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } })
const lines450 = Array.from({ length: 450 }, (_, i) => `line ${i}`).join("\n")

function setup(): { dir: string; a: string; b: string; c: string } {
  const dir = mkdtempSync(join(tmpdir(), "repo-sessions-"))
  dirs.push(dir)
  const a = join(dir, "aaa.jsonl")
  const b = join(dir, "bbb.jsonl")
  const c = join(dir, "ccc.jsonl")
  writeFileSync(
    a,
    [
      bash("bun test packages/x | tail"),
      bash("python3 - <<'EOF'\np = open('f').read().replace('a','b')\nEOF"),
      turn(use("Edit", { file_path: "/x", old_string: "a", new_string: "b" })),
      turn(use("Agent", { prompt: "go" })),
      result("d1", "denied\n[source: tools/repo/rules.json#no-piped-test]"),
    ].join("\n"),
  )
  writeFileSync(
    b,
    [
      turn(use("Read", { file_path: "/big" }, "r1")),
      result("r1", lines450),
      bash("grep -rn foo wiki/"),
      turn(use("Grep", { pattern: "x" })),
      '{"type":"assistant", broken',
      bash("sed -i s/a/b/ f"),
    ].join("\n"),
  )
  writeFileSync(
    c,
    [
      bash("bun test a --timeout 1"),
      turn(use("Read", { file_path: "/big", limit: 500 }, "r2")),
      result("r2", [{ type: "text", text: lines450 }]),
    ].join("\n"),
  )
  mkdirSync(join(dir, "ccc", "subagents"), { recursive: true })
  writeFileSync(
    join(dir, "ccc", "subagents", "agent-1.jsonl"),
    [turn(use("Edit", { file_path: "/y" })), turn({ type: "text", text: "done" })].join("\n"),
  )
  utimesSync(a, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"))
  utimesSync(b, new Date("2026-11-05T00:00:00Z"), new Date("2026-11-05T00:00:00Z"))
  utimesSync(c, new Date("2026-11-06T00:00:00Z"), new Date("2026-11-06T00:00:00Z"))
  return { dir, a, b, c }
}

describe("measureSessions", () => {
  test("hand-computed counts over 3 fixtures (+ subagent file)", () => {
    const { a, b, c } = setup()
    const m = measureSessions([a, b, c])
    expect(m).toEqual({
      sessions: 3,
      bunTestCalls: 2,
      pipedBunTest: 1,
      scriptedEdits: 2,
      editToolCalls: 2,
      agentSpawns: 1,
      subagentTurns: 2,
      mainTurns: 10,
      hookDenies: 1,
      hookDeniesByRule: { "no-piped-test": 1 },
      overrides: 0,
      searchCalls: 2,
      shellGrepCalls: 1,
      wholeFileReadsOver400Lines: 1,
      skippedLines: 1,
    })
  })
  test("malformed line is counted, never thrown", () => {
    const { b } = setup()
    expect(() => measureSessions([b])).not.toThrow()
    expect(measureSessions([b]).skippedLines).toBe(1)
  })
  test("missing file is skipped, not thrown", () => {
    expect(measureSessions(["/nonexistent/x.jsonl"]).skippedLines).toBe(1)
  })
})

describe("shellGrepCalls / searchCalls classification", () => {
  function count(commands: string[]): { shell: number; search: number } {
    const dir = mkdtempSync(join(tmpdir(), "repo-grep-"))
    dirs.push(dir)
    const p = join(dir, "s.jsonl")
    writeFileSync(p, commands.map(bash).join("\n"))
    const m = measureSessions([p])
    return { shell: m.shellGrepCalls, search: m.searchCalls }
  }
  test("counts recursive/unscoped grep, rg, ag", () => {
    expect(count(["grep -rn foo wiki/", "rg foo", "ugrep -r x packages", "ls && grep -R x ."])).toEqual({ shell: 4, search: 4 })
  })
  test("ignores pipe-fed, git grep, single-file, non-recursive, outside-repo", () => {
    const r = count([
      "git log | grep fix",
      "git grep -n x -- f.ts",
      "grep -n foo packages/core/src/x.ts",
      "grep foo file.txt",
      "grep -rn foo /tmp/scratch",
      "grep -rn foo ./node_modules/pkg",
      "grep -rn foo ~/notes",
      "rg foo src/one.ts",
    ])
    expect(r.shell).toBe(0)
    expect(r.search).toBe(0)
  })
  test("find and repo find count as searches but not shell greps", () => {
    expect(count(["find . -name '*.ts'", "bun run repo find foo"])).toEqual({ shell: 0, search: 2 })
  })
})

describe("baseline.json", () => {
  test("measured reproduces itself over fixtures and has the published/measured split", () => {
    const { dir } = setup()
    const first = measureBefore(dir, Date.parse("2026-11-06T00:00:00Z"))
    const second = measureBefore(dir, Date.parse("2026-11-06T00:00:00Z"))
    expect(first).toEqual(second)
    expect(first.files).toBe(2)
    expect(first.metrics).toEqual(measureSessions(listSessions(dir, undefined).filter((p) => !p.endsWith("ccc.jsonl"))))
    const file = loadBaseline()
    expect(file.published.bunTestCalls).toBe(491)
    expect(file.measured.sessions).toBe(6)
    for (const k of ["bunTestCalls", "pipedBunTest", "scriptedEdits", "editToolCalls", "searchCalls", "shellGrepCalls"] as const)
      expect(typeof file.measured[k]).toBe("number")
  })
  test("--json carries published; human output uses measured", async () => {
    const { dir } = setup()
    const out = (args: string[]): Promise<string> => {
      let o = ""
      return main(["session-stats", "--dir", dir, "--root", dir, ...args], { stdout: (t) => void (o += t), stderr: () => {} }).then(() => o)
    }
    expect(await out([])).toContain("(baseline 557)")
    const doc: unknown = JSON.parse(await out(["--json"]))
    expect(doc).toMatchObject({ published: { bunTestCalls: 491 }, baseline: { bunTestCalls: 557 }, metrics: { hookDeniesByRule: { "no-piped-test": 1 } } })
  })
})

describe("listSessions / transcriptDir", () => {
  test("--since excludes older files by mtime", () => {
    const { dir } = setup()
    expect(listSessions(dir, undefined).length).toBe(3)
    expect(listSessions(dir, Date.parse("2026-11-04")).map((p) => p.slice(-9))).toEqual(["bbb.jsonl", "ccc.jsonl"])
  })
  test("slug matches Claude Code's", () => {
    expect(transcriptDir("/home/u/a_b/c", "/h")).toBe("/h/.claude/projects/-home-u-a-b-c")
  })
})

describe("evaluate", () => {
  const base = { sessions: 3, bunTestCalls: 100, pipedBunTest: 5, scriptedEdits: 1, editToolCalls: 5, agentSpawns: 0, subagentTurns: 0, mainTurns: 0, hookDenies: 0, hookDeniesByRule: {}, overrides: 6, searchCalls: 100, shellGrepCalls: 5, wholeFileReadsOver400Lines: 0, skippedLines: 0 }
  test("all pass at the limits", () => {
    expect(evaluate(base, {}).every((c) => c.ok)).toBe(true)
  })
  test("each threshold can fail", () => {
    const bad = evaluate({ ...base, pipedBunTest: 6, scriptedEdits: 6, overrides: 7, shellGrepCalls: 6 }, {})
    expect(bad.map((c) => c.ok)).toEqual([false, false, false, false])
  })
})

describe("repo session-stats", () => {
  function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = ""
    let err = ""
    const streams: Streams = { stdout: (t) => void (out += t), stderr: (t) => void (err += t) }
    return main(["session-stats", ...args], streams).then((code) => ({ code, out, err }))
  }
  test("no --since: metrics only, exit 0", async () => {
    const { dir } = setup()
    const r = await run(["--dir", dir, "--root", dir])
    expect(r.code).toBe(0)
    expect(r.out).toContain("sessions 3")
    expect(r.out).toContain("metrics only")
  })
  test("<3 sessions: insufficient, exit 0", async () => {
    const { dir } = setup()
    const r = await run(["--dir", dir, "--root", dir, "--since", "2026-11-04"])
    expect(r.code).toBe(0)
    expect(r.out).toContain("insufficient sessions (2<3)")
  })
  test(">=3 sessions: threshold miss exits 1 with next: last", async () => {
    const { dir } = setup()
    const r = await run(["--dir", dir, "--root", dir, "--since", "2026-09-01"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("FAIL piped-bun-test")
    expect(r.err.trim().split("\n").pop()).toBe("next: fix the offending rule or habit; see bun run repo status")
  })
  test("--json emits metrics and checks", async () => {
    const { dir } = setup()
    const r = await run(["--dir", dir, "--root", dir, "--since", "2026-09-01", "--json"])
    const doc: unknown = JSON.parse(r.out)
    expect(doc).toMatchObject({ evaluated: true, metrics: { sessions: 3 } })
  })
  test("overrides in window count toward per-session limit", async () => {
    const { dir } = setup()
    mkdirSync(join(dir, ".repo-logs"))
    const ts = "2026-11-05T00:00:00Z"
    writeFileSync(join(dir, ".repo-logs", "overrides.jsonl"), Array.from({ length: 7 }, () => JSON.stringify({ ruleId: "x", ts })).join("\n"))
    const r = await run(["--dir", dir, "--root", dir, "--since", "2026-09-01"])
    expect(r.out).toContain("FAIL hook-overrides")
  })
  test("bad --since is a usage error", async () => {
    expect((await run(["--since", "nope"])).code).toBe(2)
  })
})
