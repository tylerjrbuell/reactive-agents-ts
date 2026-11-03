import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { preWrite } from "../src/commands/hook.ts"
import { builtins, type BuiltinResult } from "../src/lib/builtins.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"
import { manifestHealth } from "../src/lib/manifest-expiry.ts"
import { loadPlacement, placeFile, placementProblems, violates } from "../src/lib/placement.ts"
import { trackedFiles } from "../src/lib/tracked-files.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const { rules, grandfathered } = loadPlacement(REPO)
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const ENTRY: CheckEntry = {
  id: "placement", script: "builtin:placement", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03",
}

function fixture(files: Record<string, string>, gf: readonly { path: string; reason: string; reviewBy: string }[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "repo-placement-"))
  dirs.push(root)
  const all: Record<string, string> = {
    "tools/repo/checks.json": JSON.stringify({ schemaVersion: 1, checks: [ENTRY] }),
    "tools/repo/placement.json": JSON.stringify({ schemaVersion: 1, rules, grandfathered: gf }),
    ...files,
  }
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}

function run(root: string): BuiltinResult {
  const check = builtins.placement
  if (check === undefined) throw new Error("placement builtin missing")
  return check(root, ENTRY, { today: "2026-11-03", commandNames: [] })
}

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ""
  let err = ""
  const s: Streams = { stdout: (t) => void (out += t), stderr: (t) => void (err += t) }
  const code = await main(args, s)
  return { code, out, err }
}

describe("rules", () => {
  test("self-check passes (>=2 ok, >=2 bad, all behave)", () => {
    expect(placementProblems(rules)).toEqual([])
  })
  for (const r of rules) {
    test(`${r.id}: examples`, () => {
      expect(r.examples.ok.length).toBeGreaterThanOrEqual(2)
      expect(r.examples.bad.length).toBeGreaterThanOrEqual(2)
      for (const p of r.examples.ok) expect(placeFile(p, rules).ok).toBe(true)
      for (const p of r.examples.bad) expect(placeFile(p, [r])).toMatchObject({ ok: false, ruleId: r.id })
    })
  }
  test("scratch.ts fails no-stray-artifacts and names where real code goes", () => {
    const v = placeFile("scratch.ts", rules)
    expect(v).toMatchObject({ ok: false, ruleId: "no-stray-artifacts" })
    if (!v.ok) expect(v.canonical).toContain("real code")
    expect(placeFile("packages/core/scratch.ts", rules)).toMatchObject({ ok: false, ruleId: "no-stray-artifacts" })
  })
  test("plan paths", () => {
    expect(placeFile("wiki/Planning/Implementation-Plans/2026-11-03-x.md", rules).ok).toBe(true)
    expect(placeFile("wiki/Planning/Implementation-Plans/x.md", rules)).toMatchObject({ ok: false, ruleId: "plans-in-wiki" })
  })
  test("coverage: every real top-level directory is matched by new-top-level-dir", () => {
    const rule = rules.find((r) => r.id === "new-top-level-dir")
    if (rule === undefined) throw new Error("new-top-level-dir missing")
    const tops = new Set(trackedFiles(REPO).filter((f) => f.includes("/")).map((f) => f.slice(0, f.indexOf("/"))))
    expect(tops.size).toBeGreaterThan(5)
    for (const top of tops) expect(violates(`${top}/x`, rule)).toBe(false)
    expect(violates("brand-new-dir/x", rule)).toBe(true)
  })
  test("scripts-only rule (migrated from the old builtin)", () => {
    for (const bad of ["scripts/x.test.ts", "scripts/x.json", "scripts/x.md", "scripts/lift/y.test.ts"])
      expect(placeFile(bad, rules)).toMatchObject({ ok: false })
    for (const ok of ["scripts/a.ts", "scripts/b.sh", "apps/docs/tests/x.test.ts", "apps/docs/x.json"])
      expect(placeFile(ok, rules).ok).toBe(true)
  })
})

describe("placement check", () => {
  test("real repo is clean under the grandfather list", () => {
    const r = run(REPO)
    expect(r.output).not.toContain("misplaced")
    expect(r.ok).toBe(true)
  })
  test("grandfathered entries all carry a reason and reviewBy", () => {
    for (const g of grandfathered) {
      expect(g.reason.length).toBeGreaterThan(0)
      expect(g.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  test("fresh stray file fails with a next: move line", () => {
    const r = run(fixture({ "scripts/x.test.ts": "" }))
    expect(r.ok).toBe(false)
    expect(r.output).toContain("scripts/x.test.ts")
    expect(r.next).toStartWith("move scripts/x.test.ts to ")
  })
  test("grandfathered violation passes", () => {
    const root = fixture({ "scripts/x.test.ts": "" }, [{ path: "scripts/x.test.ts", reason: "legacy", reviewBy: "2027-02-03" }])
    expect(run(root).ok).toBe(true)
  })
  test("stale grandfathered entry fails naming it", () => {
    const root = fixture({}, [{ path: "scripts/gone.test.ts", reason: "legacy", reviewBy: "2027-02-03" }])
    const r = run(root)
    expect(r.ok).toBe(false)
    expect(r.next).toBe("remove scripts/gone.test.ts from tools/repo/placement.json#grandfathered")
  })
  test("repo check reports every offender but one next: line", async () => {
    const root = fixture({ "scripts/a.json": "", "scripts/b.md": "" })
    const { code, out, err } = await cli(["check", "--all", "--root", root])
    expect(code).toBe(1)
    expect(out).toContain("scripts/a.json")
    expect(out).toContain("scripts/b.md")
    expect(err.split("\n").filter((l) => l.startsWith("next:"))).toHaveLength(1)
  })
  test("expiry covers placement.json", () => {
    const root = fixture({}, [{ path: "scripts/old.json", reason: "legacy", reviewBy: "2020-01-01" }])
    expect(manifestHealth(root, "2026-11-03").fail.some((f) => f.includes("placement.json:scripts/old.json"))).toBe(true)
  })
})

describe("repo place", () => {
  test("ok path exits 0", async () => {
    const r = await cli(["place", "wiki/Planning/Implementation-Plans/2026-11-03-x.md", "--root", REPO])
    expect(r.code).toBe(0)
    expect(r.out).toContain("ok wiki/Planning/Implementation-Plans/2026-11-03-x.md")
  })
  test("violation prints rule, canonical, next last; exit 1", async () => {
    const r = await cli(["place", "docs/x.md", "packages/core/src/ok.ts", "--root", REPO])
    expect(r.code).toBe(1)
    expect(r.out).toContain("✗ no-docs-dir:")
    expect(r.out).toContain("canonical: ")
    expect(r.out).toContain("ok packages/core/src/ok.ts")
    expect(r.err.trimEnd().split("\n").pop()).toStartWith("next: Write the file at ")
  })
  test("--json", async () => {
    const r = await cli(["place", "note.md", "--json", "--root", REPO])
    const doc = JSON.parse(r.out) as { results: { ok?: boolean; ruleId?: string }[] }
    expect(doc.results[0]?.ok ?? false).toBe(false)
    expect(doc.results[0]?.ruleId).toBeDefined()
  })
  test("--kind returns the canonical location", async () => {
    const r = await cli(["place", "--kind", "plan", "--root", REPO])
    expect(r.code).toBe(0)
    expect(r.out).toContain("wiki/Planning/Implementation-Plans/YYYY-MM-DD-")
  })
  test("unknown kind, unknown flag and no path exit 2", async () => {
    expect((await cli(["place", "--kind", "nope", "--root", REPO])).code).toBe(2)
    expect((await cli(["place", "--bogus", "x"])).code).toBe(2)
    expect((await cli(["place", "--root", REPO])).code).toBe(2)
  })
})

describe("hook pre-write", () => {
  const payload = (file_path: string): string => JSON.stringify({ tool_input: { file_path } })
  const root = fixture({ "existing-note.md": "x", ".gitignore": ".superpowers/\n" })
  test("denies a new violating file with the standard JSON and source tag", () => {
    const out = preWrite(root, payload(join(root, "note.md")), {})
    expect(out).toBeDefined()
    const doc = JSON.parse(out as string) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } }
    expect(doc.hookSpecificOutput.permissionDecision).toBe("deny")
    expect(doc.hookSpecificOutput.permissionDecisionReason).toMatch(/\[source: tools\/repo\/placement\.json#[a-z-]+\]$/)
    expect(doc.hookSpecificOutput.permissionDecisionReason).toContain("canonical:")
  })
  test("handles relative paths and notebook_path", () => {
    expect(preWrite(root, payload("note.md"), {})).toBeDefined()
    expect(preWrite(root, JSON.stringify({ tool_input: { notebook_path: "note.md" } }), {})).toBeDefined()
  })
  test("allows an existing file, outside-root paths, ignored paths and valid new paths", () => {
    expect(preWrite(root, payload(join(root, "existing-note.md")), {})).toBeUndefined()
    expect(preWrite(root, payload("/tmp/scratch.ts"), {})).toBeUndefined()
    expect(preWrite(root, payload(join(root, "wiki/Planning/Implementation-Plans/2026-11-03-x.md")), {})).toBeUndefined()
  })
  test("scratch dirs are exempt, but git-ignored root litter is still denied (real repo)", () => {
    expect(preWrite(REPO, payload(join(REPO, "note.md")), {})).toBeDefined()
    expect(preWrite(REPO, payload(join(REPO, ".superpowers/note.md")), {})).toBeUndefined()
    expect(preWrite(REPO, payload(join(REPO, ".repo-logs/scratch.log")), {})).toBeUndefined()
  })
  test("REPO_ALLOW with a reason overrides and is logged", () => {
    const out = preWrite(root, payload("note.md"), { REPO_ALLOW: "root-allowlist,no-stray-artifacts", REPO_ALLOW_REASON: "test" })
    expect(out).toBeUndefined()
    expect(existsSync(join(root, ".repo-logs", "overrides.jsonl"))).toBe(true)
    expect(preWrite(root, payload("note.md"), { REPO_ALLOW: "root-allowlist" })).toBeDefined()
  })
  test("fails open on garbage and logs the error", () => {
    const r2 = fixture({})
    expect(preWrite(r2, "not json", {})).toBeUndefined()
    expect(readFileSync(join(r2, ".repo-logs", "hook-errors.jsonl"), "utf8")).toContain("error")
    expect(preWrite(r2, JSON.stringify({ tool_input: {} }), {})).toBeUndefined()
  })
  test("fails open when placement.json is missing", () => {
    const r3 = mkdtempSync(join(tmpdir(), "repo-placement-"))
    dirs.push(r3)
    expect(preWrite(r3, payload("note.md"), {})).toBeUndefined()
  })
  test("fast on the real repo", () => {
    const t = performance.now()
    preWrite(REPO, payload(join(REPO, "note.md")), {})
    expect(performance.now() - t).toBeLessThan(300)
  })
})
