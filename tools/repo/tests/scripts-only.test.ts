import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { builtins, type BuiltinResult } from "../src/lib/builtins.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const ENTRY: CheckEntry = {
  id: "scripts-only", script: "builtin:scripts-only", scope: ["scripts/**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03",
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-scripts-only-"))
  dirs.push(root)
  const all: Record<string, string> = {
    "tools/repo/checks.json": JSON.stringify({ schemaVersion: 1, checks: [ENTRY] }),
    ...files,
  }
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}

function run(root: string): BuiltinResult {
  const check = builtins["scripts-only"]
  if (check === undefined) throw new Error("scripts-only builtin missing")
  return check(root, ENTRY, { today: "2026-11-03", commandNames: [] })
}

describe("scripts-only", () => {
  test("real repo: scripts/ holds only scripts", () => {
    expect(run(REPO).ok).toBe(true)
  })
  test("scripts and non-scripts elsewhere pass", () => {
    const root = fixture({ "scripts/a.ts": "", "scripts/b.sh": "", "apps/docs/tests/x.test.ts": "", "apps/docs/x.json": "" })
    expect(run(root).ok).toBe(true)
  })
  for (const bad of ["scripts/x.test.ts", "scripts/x.json", "scripts/x.md", "scripts/lift/y.test.ts"]) {
    test(`${bad} fails and is named`, () => {
      const r = run(fixture({ [bad]: "" }))
      expect(r.ok).toBe(false)
      expect(r.output).toContain(bad)
    })
  }
  test("test file gives the next: line from the plan", () => {
    const r = run(fixture({ "scripts/x.test.ts": "" }))
    expect(r.next).toBe("move scripts/x.test.ts next to the code it tests")
  })
  test("repo check reports every offender but one next: line", async () => {
    const root = fixture({ "scripts/a.json": "", "scripts/b.md": "" })
    let out = ""
    let err = ""
    const s: Streams = { stdout: (t) => void (out += t), stderr: (t) => void (err += t) }
    expect(await main(["check", "--all", "--root", root], s)).toBe(1)
    expect(out).toContain("scripts/a.json")
    expect(out).toContain("scripts/b.md")
    expect(err.split("\n").filter((l) => l.startsWith("next:"))).toHaveLength(1)
    expect(err).toContain("next: move scripts/a.json next to the code that consumes it")
  })
})
