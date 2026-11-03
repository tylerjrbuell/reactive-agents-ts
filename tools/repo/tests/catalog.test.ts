import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { loadCatalog, SCRIPT_KINDS, uncatalogued } from "../src/lib/catalog.ts"
import { loadChecks } from "../src/lib/manifest.ts"
import { OUTPUT_CAP } from "../src/lib/output.ts"

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

/** Temp root with a catalog, checks, a package.json and extra files. */
function fixture(files: Record<string, string>, catalog: unknown[] = [], checks: unknown[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "repo-catalog-"))
  dirs.push(root)
  const all: Record<string, string> = {
    "tools/repo/catalog.json": JSON.stringify({ schemaVersion: 1, entries: catalog }),
    "tools/repo/checks.json": JSON.stringify({ schemaVersion: 1, checks }),
    "package.json": JSON.stringify({ scripts: {} }),
    ...files,
  }
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}

describe("catalog coverage", () => {
  test("real repo: nothing uncatalogued", () => {
    expect(uncatalogued(REPO, loadCatalog(REPO), loadChecks(REPO))).toEqual([])
  })
  test("extra script in a temp root is reported alone", () => {
    const root = fixture({ "scripts/new-thing.ts": "" })
    expect(uncatalogued(root, loadCatalog(root), loadChecks(root))).toEqual(["scripts/new-thing.ts"])
  })
  test("unlisted root package.json script is reported", () => {
    const root = fixture({ "package.json": JSON.stringify({ scripts: { zap: "echo" } }) })
    expect(uncatalogued(root, [], [])).toEqual(["package.json#zap"])
  })
  test("repo check fails with the add-to-catalog next line", async () => {
    const entry = {
      id: "catalog-coverage", script: "builtin:catalog-coverage", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03",
    }
    const root = fixture({ "scripts/new-thing.ts": "" }, [], [entry])
    const c = capture()
    expect(await main(["check", "--all", "--root", root], c.s)).toBe(1)
    expect(c.out()).toContain("uncatalogued: scripts/new-thing.ts")
    expect(c.err()).toContain("next: add scripts/new-thing.ts to tools/repo/catalog.json (kind + summary)")
  })
})

describe("catalog entries", () => {
  test("summary <= 80 chars, invoke runnable, kind valid, ids unique", () => {
    const entries = loadCatalog(REPO)
    expect(entries.length).toBeGreaterThan(0)
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length)
    for (const e of entries) {
      expect(e.summary.length).toBeLessThanOrEqual(80)
      expect(e.invoke).toMatch(/^(bun|bash|cat|node) \S/)
      expect(SCRIPT_KINDS).toContain(e.kind)
    }
  })
})

describe("help --all", () => {
  test("--full groups under all 7 kind headings", async () => {
    const c = capture()
    expect(await main(["help", "--all", "--full"], c.s)).toBe(0)
    for (const k of SCRIPT_KINDS) expect(c.out()).toMatch(new RegExp(`^${k} \\(\\d+\\)$`, "m"))
  })
  test("default view shows every kind heading within the cap", async () => {
    const c = capture()
    expect(await main(["help", "--all"], c.s)).toBe(0)
    for (const k of SCRIPT_KINDS) expect(c.out()).toMatch(new RegExp(`^${k} \\(\\d+\\)$`, "m"))
    expect(c.out().trimEnd().split("\n").length).toBeLessThanOrEqual(OUTPUT_CAP + 12)
    expect(c.out()).toContain("(use --full)")
  })
  test.each([[["help"]], [["help", "--all"]], [["help", "--all", "--full"]]])("%p ends with Other tools footer", async (argv) => {
    const c = capture()
    await main(argv, c.s)
    const lines = c.out().trimEnd().split("\n")
    expect(lines.at(-3)).toBe("Other tools:")
    expect(lines.at(-2)).toMatch(/^ {2}rax +use\/operate agents/)
    expect(lines.at(-1)).toMatch(/^ {2}rax-diagnose +explain a run trace/)
  })
  test("--json includes otherTools and catalog", async () => {
    const c = capture()
    expect(await main(["help", "--all", "--json"], c.s)).toBe(0)
    const doc = JSON.parse(c.out()) as { otherTools: { name: string; useFor: string }[]; catalog: unknown[] }
    expect(doc.otherTools.map((t) => t.name)).toEqual(["rax", "rax-diagnose"])
    expect(doc.catalog.length).toBeGreaterThan(100)
  })
})

describe("output cap", () => {
  test("capped out drops past the limit and flush reports the count", async () => {
    const { makeIo } = await import("../src/lib/output.ts")
    const c = capture()
    const io = makeIo(false, c.s)
    for (let i = 0; i < OUTPUT_CAP + 5; i++) io.out(`l${i}`)
    io.result("kept")
    io.flush()
    const lines = c.out().trimEnd().split("\n")
    expect(lines.length).toBe(OUTPUT_CAP + 2)
    expect(lines.at(-2)).toBe("... 5 more (use --full)")
    expect(lines.at(-1)).toBe("kept")
    const full = capture()
    const io2 = makeIo(false, full.s, true)
    for (let i = 0; i < OUTPUT_CAP + 5; i++) io2.out(`l${i}`)
    io2.flush()
    expect(full.out().trimEnd().split("\n").length).toBe(OUTPUT_CAP + 5)
  })
})

describe("one-way dependency", () => {
  test("apps/cli never references the repo tool", () => {
    const hits: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else {
          const text = readFileSync(p, "utf8")
          if (text.includes("bun run repo") || text.includes("tools/repo")) hits.push(p)
        }
      }
    }
    walk(join(REPO, "apps", "cli"))
    expect(hits).toEqual([])
  })
})
