import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { matchesGlob } from "../src/lib/glob.ts"
import { expiry, loadChecks, readManifest, selectChecks, type CheckEntry } from "../src/lib/manifest.ts"

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

function entry(over: Partial<CheckEntry> & { id: string; script: string }): CheckEntry {
  return { scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03", ...over }
}

/** Temp repo root with a checks.json and the given files. */
function fixture(checks: readonly CheckEntry[], files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-check-"))
  dirs.push(root)
  mkdirSync(join(root, "tools", "repo"), { recursive: true })
  writeFileSync(join(root, "tools", "repo", "checks.json"), JSON.stringify({ schemaVersion: 1, checks }))
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}

describe("registry", () => {
  test("real repo: exactly one entry per scripts/check-*.sh", () => {
    const entries = loadChecks(REPO)
    const onDisk = readdirSync(join(REPO, "scripts")).filter((f) => /^check-.*\.sh$/.test(f))
    expect(onDisk.length).toBeGreaterThan(0)
    for (const f of onDisk) expect(entries.filter((e) => e.script === `scripts/${f}`).length).toBe(1)
  })
  test("real repo: every entry has owner and reviewBy", () => {
    for (const e of loadChecks(REPO)) {
      expect(e.owner.length).toBeGreaterThan(0)
      expect(e.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
  test("selectChecks includes matching scope and excludes other scope", () => {
    const docs = entry({ id: "docs-only", script: "scripts/check-docs.sh", scope: ["apps/docs/**"] })
    const all = [...loadChecks(REPO), docs]
    const ids = selectChecks(all, ["packages/reasoning/src/kernel/x.ts"], "ci").map((c) => c.id)
    expect(ids).toContain("check-run-contract")
    expect(ids).not.toContain("docs-only")
  })
  test("selectChecks respects stage", () => {
    const c = entry({ id: "h", script: "scripts/check-h.sh", stages: ["hook"] })
    expect(selectChecks([c], ["a"], "ci")).toEqual([])
    expect(selectChecks([c], ["a"], "hook")).toEqual([c])
  })
  test("manifest without schemaVersion throws naming the file", () => {
    const root = fixture([], {})
    writeFileSync(join(root, "tools", "repo", "checks.json"), JSON.stringify({ checks: [] }))
    expect(() => readManifest(root, "checks.json")).toThrow("checks.json")
  })
  test("expiry: warn after reviewBy, fail after 30 more days", () => {
    const c = entry({ id: "x", script: "scripts/check-x.sh", reviewBy: "2027-02-03" })
    expect(expiry([c], "2027-02-03")).toEqual({ warn: [], fail: [] })
    expect(expiry([c], "2027-02-04")).toEqual({ warn: ["x"], fail: [] })
    expect(expiry([c], "2027-03-05")).toEqual({ warn: ["x"], fail: [] })
    expect(expiry([c], "2027-03-06")).toEqual({ warn: [], fail: ["x"] })
  })
})

describe("matchesGlob", () => {
  test("** crosses directories", () => expect(matchesGlob("a/b/c.ts", "a/**")).toBe(true))
  test("* stays in one segment", () => {
    expect(matchesGlob("a/b.ts", "a/*/c.ts")).toBe(false)
    expect(matchesGlob("a/x/c.ts", "a/*/c.ts")).toBe(true)
  })
  test("**/ matches zero directories", () => expect(matchesGlob("c.ts", "**/c.ts")).toBe(true))
  test("regex metacharacters are literal", () => expect(matchesGlob("axb", "a.b")).toBe(false))
})

describe("repo check", () => {
  test("unregistered script exits 1, names it, ends with next:", async () => {
    const root = fixture(
      [entry({ id: "check-ok", script: "scripts/check-ok.sh" })],
      { "scripts/check-ok.sh": "exit 0\n", "scripts/check-new.sh": "exit 0\n" },
    )
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    expect(c.err()).toContain("check-new.sh")
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: add check-new to tools/repo/checks.json")
  })
  test("--all runs each script once and reports counts; failure gives next:", async () => {
    const root = fixture(
      [
        entry({ id: "check-ok", script: "scripts/check-ok.sh" }),
        entry({ id: "check-bad", script: "scripts/check-bad.sh" }),
      ],
      {
        "scripts/check-ok.sh": "echo ran >> \"$(dirname \"$0\")/count\"\nexit 0\n",
        "scripts/check-bad.sh": "echo nope\nexit 1\n",
      },
    )
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    expect(c.out()).toContain("nope")
    expect(c.err()).toContain("checks: 1 pass, 1 fail")
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo check --only check-bad")
    expect(readFileSync(join(root, "scripts", "count"), "utf8")).toBe("ran\n")
  })
  test("all pass exits 0", async () => {
    const root = fixture([entry({ id: "check-ok", script: "scripts/check-ok.sh" })], { "scripts/check-ok.sh": "exit 0\n" })
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(0)
    expect(c.out()).toContain("checks: 1 pass, 0 fail")
  })
  test("entry past reviewBy + 30 days fails", async () => {
    const root = fixture(
      [entry({ id: "check-ok", script: "scripts/check-ok.sh", reviewBy: "2020-01-01" })],
      { "scripts/check-ok.sh": "exit 0\n" },
    )
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    expect(c.err()).toContain("check-ok")
  })
  test("unknown flag exits 2 with next: --help", async () => {
    const c = capture()
    expect(await main(["check", "--bogus"], c.s)).toBe(2)
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo check --help")
  })
})

describe("repo ratchet", () => {
  /** Fixture whose as-unknown-as src count is `n`, ceiling `ceiling`. */
  function ratchetFixture(n: number, ceiling: number): { root: string; file: string } {
    const file = "packages/p/test/ceil.test.ts"
    const c = entry({
      id: "ratchet-x",
      script: "builtin:ratchet",
      stages: [],
      ratchet: [{ file, constant: "CEILING", measure: "as-unknown-as-src" }],
    })
    const root = fixture([c], {
      [file]: `const CEILING = ${ceiling};\n`,
      "packages/p/src/a.ts": "const v = x as unknown as T\n".repeat(n),
    })
    return { root, file: join(root, file) }
  }
  test("measured below ceiling prints old → new, exits 0, writes nothing without --write", async () => {
    const { root, file } = ratchetFixture(90, 100)
    const c = capture()
    expect(await main(["ratchet", "--root", root], c.s)).toBe(0)
    expect(c.out()).toContain("100 → 90")
    expect(readFileSync(file, "utf8")).toBe("const CEILING = 100;\n")
  })
  test("--write tightens the ceiling", async () => {
    const { root, file } = ratchetFixture(90, 100)
    expect(await main(["ratchet", "--write", "--root", root], capture().s)).toBe(0)
    expect(readFileSync(file, "utf8")).toBe("const CEILING = 90;\n")
  })
  test("measured above ceiling prints overage, exits 1, never raises", async () => {
    const { root, file } = ratchetFixture(110, 100)
    const c = capture()
    expect(await main(["ratchet", "--write", "--root", root], c.s)).toBe(1)
    expect(c.out()).toContain("over by 10")
    expect(readFileSync(file, "utf8")).toBe("const CEILING = 100;\n")
    expect(c.err().trimEnd().split("\n").at(-1)).toContain("next: ")
  })
})

describe("scopes", () => {
  test("cross-cutting is selected for runtime and apps changes", () => {
    const checks = loadChecks(REPO)
    for (const f of ["packages/runtime/src/x.ts", "apps/cli/src/x.ts"])
      expect(selectChecks(checks, [f], "ci").map((c) => c.id)).toContain("check-cross-cutting")
  })
  test("ledger-writes is selected for runtime src changes", () => {
    expect(selectChecks(loadChecks(REPO), ["packages/runtime/src/x.ts"], "ci").map((c) => c.id)).toContain("check-ledger-writes")
  })
})

describe("repo ratchet unpinned", () => {
  test("a * key with no ceiling in the file is reported unpinned, not over", async () => {
    const file = "scripts/check-type-escape-hatches.sh"
    const c = entry({
      id: "te",
      script: "builtin:ratchet",
      stages: [],
      ratchet: [{ file, constant: "*", measure: "type-escape-hatches" }],
    })
    const root = fixture([c], { [file]: "declare -A BASELINE=(\n)\n", "packages/p/src/a.ts": "const a = x as any\n" })
    const r = capture()
    expect(await main(["ratchet", "--root", root], r.s)).toBe(1)
    expect(r.out()).toContain("unpinned")
    expect(r.out()).not.toContain("over by")
  })
})
