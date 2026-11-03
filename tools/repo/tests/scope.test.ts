import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { builtins, type BuiltinCtx } from "../src/lib/builtins.ts"
import { loadChecks, type CheckEntry } from "../src/lib/manifest.ts"
import { loadOwnership, nameAll, scopeFiles, workspaceDirs, type OwnershipEntry } from "../src/lib/ownership.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return { s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) }, out: () => o, err: () => e }
}

const E: readonly OwnershipEntry[] = [
  { glob: "packages/reasoning/src/kernel/**", owner: "kernel-warden", checks: ["c1"], docs: ["d1"] },
  { glob: "packages/tools/**", owner: "tools-warden", checks: [], docs: [] },
  { glob: "packages/core/**", owner: null, reason: "none", checks: [], docs: [] },
]

const ctx = (over: Partial<BuiltinCtx> = {}): BuiltinCtx => ({ today: "2026-11-03", commandNames: ["check", "help"], ...over })
const dummy: CheckEntry = { id: "x", script: "builtin:x", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" }

/** Temp root with the given files (relative path -> contents). */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-scope-"))
  dirs.push(root)
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}
const manifest = (name: string, body: object): Record<string, string> => ({
  [`tools/repo/${name}`]: JSON.stringify({ schemaVersion: 1, ...body }),
})

describe("scopeFiles", () => {
  test("kernel file -> kernel-warden", () => {
    const r = scopeFiles(["packages/reasoning/src/kernel/loop/runner.ts"], E)
    expect(r.owners).toEqual(["kernel-warden"])
    expect(r.checks).toEqual(["c1"])
    expect(r.docs).toEqual(["d1"])
  })
  test("owners sorted and deduped across packages", () => {
    const r = scopeFiles(["packages/tools/a.ts", "packages/tools/b.ts", "packages/reasoning/src/kernel/x.ts"], E)
    expect(r.owners).toEqual(["kernel-warden", "tools-warden"])
  })
  test("matching no row is unowned; null-owner row is covered but ownerless", () => {
    expect(scopeFiles(["README.md"], E).unowned).toEqual(["README.md"])
    const r = scopeFiles(["packages/core/x.ts"], E)
    expect(r.unowned).toEqual([])
    expect(r.owners).toEqual([])
  })
})

describe("real ownership.json", () => {
  const entries = loadOwnership(REPO)
  test("every owner has .claude/agents/<owner>.md", () => {
    for (const e of entries)
      if (e.owner !== null) expect(existsSync(join(REPO, ".claude", "agents", `${e.owner}.md`))).toBe(true)
  })
  test("every checks[] id exists in checks.json", () => {
    const ids = new Set(loadChecks(REPO).map((c) => c.id))
    for (const e of entries) for (const c of e.checks) expect(ids.has(c)).toBe(true)
  })
  test("null owner carries a reason", () => {
    for (const e of entries) if (e.owner === null) expect((e.reason ?? "").trim().length).toBeGreaterThan(0)
  })
  test("every packages/* and apps/* dir is covered", () => {
    for (const d of workspaceDirs(REPO)) expect(scopeFiles([`${d}/x`], entries).unowned).toEqual([])
  })
})

describe("ownership-coverage builtin", () => {
  const base = {
    ...manifest("checks.json", { checks: [] }),
    ...manifest("ownership.json", { entries: [{ glob: "packages/a/**", owner: null, reason: "r", checks: [], docs: [] }] }),
    "packages/a/x.ts": "",
  }
  test("covered fixture passes", () => {
    expect(builtins["ownership-coverage"]?.(fixture(base), dummy, ctx())?.ok).toBe(true)
  })
  test("new package fails with next: add ... to ownership.json", async () => {
    const root = fixture({ ...base, "packages/newpkg/x.ts": "" })
    const r = builtins["ownership-coverage"]?.(root, dummy, ctx())
    expect(r?.ok).toBe(false)
    expect(r?.next).toBe("add packages/newpkg/** to tools/repo/ownership.json")
    // End to end through `repo check --all` with the builtin registered.
    const reg = fixture({
      ...manifest("checks.json", {
        checks: [{ id: "ownership-coverage", script: "builtin:ownership-coverage", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" }],
      }),
      ...manifest("ownership.json", { entries: [] }),
      "packages/newpkg/x.ts": "",
    })
    const c = capture()
    expect(await main(["check", "--all", "--root", reg], c.s)).toBe(1)
    expect(c.err()).toContain("next: add packages/newpkg/** to tools/repo/ownership.json")
  })
  test("null owner with empty reason fails", () => {
    const root = fixture({
      ...manifest("checks.json", { checks: [] }),
      ...manifest("ownership.json", { entries: [{ glob: "packages/a/**", owner: null, reason: " ", checks: [], docs: [] }] }),
      "packages/a/x.ts": "",
    })
    expect(builtins["ownership-coverage"]?.(root, dummy, ctx())?.ok).toBe(false)
  })
  test("unknown check id and missing agent file fail", () => {
    const root = fixture({
      ...manifest("checks.json", { checks: [] }),
      ...manifest("ownership.json", { entries: [{ glob: "packages/a/**", owner: "ghost-warden", checks: ["nope"], docs: [] }] }),
      "packages/a/x.ts": "",
    })
    const r = builtins["ownership-coverage"]?.(root, dummy, ctx())
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain("ghost-warden")
    expect(r?.output).toContain("nope")
  })
})

describe("nameAll", () => {
  test("all names up to 5, then first 5 plus count", () => {
    expect(nameAll(["a", "b"])).toBe("a b")
    expect(nameAll(["a", "b", "c", "d", "e", "f", "g"])).toBe("a b c d e (+2 more; see output)")
  })
})

describe("doc-command-drift builtin", () => {
  test("unknown command fails with next: rename", () => {
    const root = fixture({ "AGENTS.md": "run `bun run repo route` now\n" })
    const r = builtins["doc-command-drift"]?.(root, dummy, ctx())
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain("AGENTS.md:1")
    expect(r?.next).toBe("rename to an existing command (bun run repo help)")
  })
  test("registered command passes; repo-drift-ignore line exempt", () => {
    const root = fixture({
      "AGENTS.md": "bun run repo check --all\n",
      ".agents/skills/s/SKILL.md": "bun run repo future-cmd # repo-drift-ignore\n",
      "wiki/Development/x.md": "bun run repo help\n",
    })
    expect(builtins["doc-command-drift"]?.(root, dummy, ctx())?.ok).toBe(true)
  })
  test("wiki/Planning is not scanned", () => {
    const root = fixture({ "wiki/Planning/p.md": "bun run repo bogus\n" })
    expect(builtins["doc-command-drift"]?.(root, dummy, ctx())?.ok).toBe(true)
  })
  test("real repo docs are clean against real commands", async () => {
    const { commands } = await import("../src/cli.ts")
    const r = builtins["doc-command-drift"]?.(REPO, dummy, ctx({ commandNames: commands.map((c) => c.name) }))
    expect(r?.output).toContain("match")
  })
})

describe("manifest-expiry builtin", () => {
  const with_ = (reviewBy: string, extra: Record<string, string> = {}): string =>
    fixture({
      ...manifest("checks.json", { checks: [{ id: "a", script: "builtin:x", scope: [], stages: ["ci"], owner: "t", reviewBy }] }),
      ...manifest("catalog.json", { entries: [] }),
      ...manifest("ownership.json", { entries: [] }),
      ...extra,
    })
  test("current passes", () => expect(builtins["manifest-expiry"]?.(with_("2027-02-03"), dummy, ctx())?.ok).toBe(true))
  test("past reviewBy warns but passes", () => {
    const r = builtins["manifest-expiry"]?.(with_("2026-10-20"), dummy, ctx())
    expect(r?.ok).toBe(true)
    expect(r?.output).toContain("warn")
  })
  test("past reviewBy + 30 days fails", () => {
    expect(builtins["manifest-expiry"]?.(with_("2026-09-01"), dummy, ctx())?.ok).toBe(false)
  })
  test("rules.json entries expire too; missing rules.json tolerated", () => {
    const rules = manifest("rules.json", { rules: [{ id: "r", reviewBy: "2026-01-01" }] })
    expect(builtins["manifest-expiry"]?.(with_("2027-02-03", rules), dummy, ctx())?.ok).toBe(false)
    expect(builtins["manifest-expiry"]?.(with_("2027-02-03"), dummy, ctx())?.ok).toBe(true)
  })
  test("bad or missing schemaVersion fails naming the file", () => {
    const root = with_("2027-02-03", { "tools/repo/catalog.json": JSON.stringify({ entries: [] }) })
    const r = builtins["manifest-expiry"]?.(root, dummy, ctx())
    expect(r?.ok).toBe(false)
    expect(r?.output).toContain("catalog.json")
  })
})

describe("repo scope", () => {
  test("clean git repo prints `no changes`, exit 0", async () => {
    const root = fixture({ ...manifest("ownership.json", { entries: [] }), "a.txt": "x" })
    const g = (...a: string[]): string => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" })
    g("init", "-q")
    g("add", "-A")
    g("commit", "-qm", "init")
    const c = capture()
    expect(await main(["scope", "--root", root], c.s)).toBe(0)
    expect(c.out()).toBe("no changes\n")
  })
  test("explicit file prints blocks and dispatch next", async () => {
    const c = capture()
    expect(await main(["scope", "packages/reasoning/src/kernel/loop/runner.ts"], c.s)).toBe(0)
    expect(c.out()).toContain("owners:\n  kernel-warden")
    expect(c.out().trimEnd().split("\n").pop()).toBe(
      "next: dispatch kernel-warden with a MissionBrief (.agents/skills/mission-brief/SKILL.md)",
    )
  })
  test("unowned file listed, no dispatch line", async () => {
    const c = capture()
    expect(await main(["scope", "README.md"], c.s)).toBe(0)
    expect(c.out()).toContain("unowned:\n  README.md")
    expect(c.out()).not.toContain("next:")
  })
  test("unknown flag exits 2", async () => {
    const c = capture()
    expect(await main(["scope", "--bogus"], c.s)).toBe(2)
  })
})

describe("repo check output cap", () => {
  test("failing check detail survives >40 preceding passing lines", async () => {
    const root = fixture({
      ...manifest("checks.json", {
        checks: [
          { id: "noisy", script: "scripts/check-noisy.sh", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" },
          { id: "bad", script: "scripts/check-bad.sh", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" },
        ],
      }),
      "scripts/check-noisy.sh": 'for i in $(seq 1 60); do echo "ok $i"; done\n',
      "scripts/check-bad.sh": 'echo "DETAIL-ONE"\necho "DETAIL-TWO"\nexit 1\n',
    })
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    expect(c.out()).toContain("── bad")
    expect(c.out()).toContain("DETAIL-ONE")
    expect(c.out()).toContain("DETAIL-TWO")
    expect(c.out()).not.toContain("ok 60")
  })
})

describe("output contract: next: is always last", () => {
  /** Captures both streams in arrival order. */
  function ordered(): { s: Streams; lines: () => string[] } {
    const log: string[] = []
    return { s: { stdout: (t) => void log.push(t), stderr: (t) => void log.push(t) }, lines: () => log.join("").split("\n").filter((l) => l.length > 0) }
  }
  test("scope over 60 files: overflow line precedes next:", async () => {
    const c = ordered()
    const files = ["packages/tools/src/a.ts", ...Array.from({ length: 60 }, (_, i) => `zz/f${i}.txt`)]
    expect(await main(["scope", ...files], c.s)).toBe(0)
    const lines = c.lines()
    expect(lines.some((l) => l.startsWith("... "))).toBe(true)
    expect(lines[lines.length - 1]).toStartWith("next:")
  })
  test("check failure path ends with next: after overflow", async () => {
    const root = fixture({
      ...manifest("checks.json", {
        checks: [
          { id: "noisy", script: "scripts/check-noisy.sh", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" },
          { id: "bad", script: "scripts/check-bad.sh", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" },
        ],
      }),
      "scripts/check-noisy.sh": 'for i in $(seq 1 60); do echo "ok $i"; done\n',
      "scripts/check-bad.sh": "echo DETAIL\nexit 1\n",
    })
    const c = ordered()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    const lines = c.lines()
    expect(lines[lines.length - 1]).toStartWith("next:")
    expect(lines).toContain("DETAIL")
    const more = lines.findIndex((l) => l.startsWith("... "))
    expect(more).toBeGreaterThan(-1)
    expect(more).toBeLessThan(lines.length - 1)
  })
})

describe("scope no-owner vs unowned", () => {
  test("covered null-owner rows report reason, separate from unowned", async () => {
    const r = scopeFiles(["packages/core/x.ts", "README.md"], E)
    expect(r.noOwner).toEqual([{ file: "packages/core/x.ts", reason: "none" }])
    expect(r.unowned).toEqual(["README.md"])
    const c = capture()
    await main(["scope", "packages/core/src/index.ts", "README.md"], c.s)
    expect(c.out()).toContain("no-owner:\n  packages/core/src/index.ts (reason:")
    expect(c.out()).toContain("unowned:\n  README.md")
  })
  test("harness reports map to harness-warden", () => {
    expect(scopeFiles(["wiki/Research/Harness-Reports/a.md"], loadOwnership(REPO)).owners).toEqual(["harness-warden"])
  })
  test("no duplicate globs; ignored dot dirs not required", () => {
    const globs = loadOwnership(REPO).map((e) => e.glob)
    expect(new Set(globs).size).toBe(globs.length)
    expect(workspaceDirs(REPO).every((d) => !d.split("/")[1]?.startsWith("."))).toBe(true)
  })
})

describe("manifestHealth boundaries (day 30 warn, day 31 fail)", () => {
  const cases: readonly [string, string, object][] = [
    ["rules.json", "rules", {}],
    ["catalog.json", "entries", {}],
    ["ownership.json", "entries", {}],
  ]
  for (const [file, key] of cases.map((c) => [c[0], c[1]] as const)) {
    const build = (reviewBy: string): string => {
      const base: Record<string, object> = {
        "checks.json": { checks: [] },
        "catalog.json": { entries: [] },
        "ownership.json": { entries: [] },
      }
      base[file] = { [key]: [{ id: "e", reviewBy }] }
      return fixture(Object.fromEntries(Object.entries(base).flatMap(([n, b]) => Object.entries(manifest(n, b)))))
    }
    test(`${file}: day 30 warns`, () => {
      const r = builtins["manifest-expiry"]?.(build("2026-10-04"), dummy, ctx())
      expect(r?.ok).toBe(true)
      expect(r?.output).toContain(`warn: past reviewBy: ${file}:e`)
    })
    test(`${file}: day 31 fails`, () => {
      expect(builtins["manifest-expiry"]?.(build("2026-10-03"), dummy, ctx())?.ok).toBe(false)
    })
  }
})
