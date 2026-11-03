import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { findHits } from "../src/commands/find.ts"
import { outline } from "../src/commands/outline.ts"
import { classifyBash, loadRules } from "../src/lib/hook-rules.ts"
import { trackedFiles } from "../src/lib/tracked-files.ts"
import { indexWiki } from "../src/lib/wiki-index.ts"

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

/** Temp git repo containing `files`, all committed except `untracked`. */
function repo(files: Record<string, string>, untracked: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "repo-find-"))
  dirs.push(root)
  const put = (m: Record<string, string>): void => {
    for (const [p, c] of Object.entries(m)) {
      mkdirSync(join(root, p, ".."), { recursive: true })
      writeFileSync(join(root, p), c)
    }
  }
  const g = (...a: string[]): string => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" })
  g("init", "-q")
  put({ ".gitignore": "ignored.ts\n", ...files })
  g("add", "-A")
  g("commit", "-qm", "init")
  put(untracked)
  return root
}

const FIX = {
  "wiki/Architecture/Quasar.md": "---\ntitle: Quasar\nstatus: active\n---\n# Quasar\n\nbody text\n",
  "wiki/Notes/other.md": "# Other\n\nthe quasar appears only in the body here\n",
  "wiki/Notes/_archive/old.md": "# Old\n\nquasar archived mention\n",
  "wiki/Notes/dead.md": "---\nstatus: superseded\n---\n# Dead\n\nquasar superseded mention\n",
  "src/a.ts": "export function quasarThing(): number {\n  return 1\n}\nexport const other = 2\n",
  "src/ünusual name.ts": "// quasar in an oddly named file\n",
  "src/bin.ts": "quasar\0binary",
  "tools/repo/catalog.json": JSON.stringify({
    schemaVersion: 1,
    entries: [{ id: "scripts/make-quasar.sh", path: "scripts/make-quasar.sh", kind: "build", summary: "Builds the quasar bundle", invoke: "bash scripts/make-quasar.sh" }],
  }),
  "scripts/make-quasar.sh": "echo hi\n",
}

describe("file universe", () => {
  const root = repo(FIX, { "ignored.ts": "quasar", "untracked.ts": "quasar fresh" })
  test("gitignored never appears; untracked non-ignored does", () => {
    const files = trackedFiles(root)
    expect(files).not.toContain("ignored.ts")
    expect(files).toContain("untracked.ts")
    expect(files).toContain("src/ünusual name.ts")
  })
  test("findHits sees the oddly named file and skips ignored + binary", () => {
    const paths = findHits("quasar", "code", root, 50).map((h) => h.path)
    expect(paths).toContain("src/ünusual name.ts")
    expect(paths).not.toContain("ignored.ts")
    expect(paths).not.toContain("src/bin.ts")
  })
})

describe("ranking", () => {
  const root = repo(FIX)
  test("title match outranks body match; archive and superseded sort last with (stale)", () => {
    const hits = findHits("quasar", "wiki", root, 50)
    const paths = hits.map((h) => h.path)
    expect(paths[0]).toBe("wiki/Architecture/Quasar.md")
    expect(paths.indexOf("wiki/Notes/other.md")).toBeLessThan(paths.indexOf("wiki/Notes/_archive/old.md"))
    expect(paths.indexOf("wiki/Notes/other.md")).toBeLessThan(paths.indexOf("wiki/Notes/dead.md"))
    expect(hits.filter((h) => h.stale).map((h) => h.path).sort()).toEqual(["wiki/Notes/_archive/old.md", "wiki/Notes/dead.md"])
  })
  test("multi-word query ANDs words on a line", () => {
    expect(findHits("quasar appears", "wiki", root, 50).map((h) => h.path)).toEqual(["wiki/Notes/other.md"])
  })
  test("indexWiki marks title, status, headings", () => {
    const e = indexWiki(root).find((x) => x.path === "wiki/Architecture/Quasar.md")
    expect(e?.title).toBe("Quasar")
    expect(e?.status).toBe("active")
    expect(e?.headings).toEqual([{ text: "# Quasar", line: 5 }])
  })
})

describe("repo find output", () => {
  const root = repo(FIX)
  test("one hit per line, (stale) marker, capped at limit with a more-line", async () => {
    const c = capture()
    expect(await main(["find", "quasar", "--wiki", "--limit", "2", "--root", root], c.s)).toBe(0)
    const lines = c.out().trimEnd().split("\n")
    expect(lines.length).toBe(3)
    expect(lines[0]).toStartWith("wiki/Architecture/Quasar.md  ")
    expect(lines[2]).toStartWith("... 3 more")
    const all = capture()
    await main(["find", "quasar", "--wiki", "--root", root], all.s)
    expect(all.out()).toContain("wiki/Notes/dead.md:6  quasar superseded mention (stale)")
    expect(all.out()).toContain("wiki/Notes/other.md:3  the quasar appears")
  })
  test("long text is truncated to 100 chars", async () => {
    const long = repo({ "wiki/x.md": `# X\n\nquasar ${"y".repeat(300)}\n` })
    const c = capture()
    await main(["find", "quasar", "--wiki", "--root", long], c.s)
    const line = c.out().split("\n").find((l) => l.includes(":3  ")) as string
    expect(line.split("  ")[1]?.length).toBeLessThanOrEqual(100)
  })
  test("--json prints one document", async () => {
    const c = capture()
    expect(await main(["find", "quasar", "--code", "--json", "--root", root], c.s)).toBe(0)
    const doc = JSON.parse(c.out()) as { total: number; hits: { path: string }[] }
    expect(doc.total).toBeGreaterThan(0)
    expect(doc.hits[0]?.path).toBeDefined()
  })
  test("no results: message, next: with another scope, exit 0", async () => {
    const c = capture()
    expect(await main(["find", "zzzzqqq", "--wiki", "--root", root], c.s)).toBe(0)
    expect(c.out()).toBe('no results for "zzzzqqq"\nnext: bun run repo find "zzzzqqq" --code\n')
  })
  test("--scripts searches the catalog and prints invoke", async () => {
    const c = capture()
    expect(await main(["find", "quasar", "--scripts", "--root", root], c.s)).toBe(0)
    expect(c.out()).toContain("scripts/make-quasar.sh  bash scripts/make-quasar.sh  # Builds the quasar bundle")
  })
  test("usage errors exit 2", async () => {
    expect(await main(["find", "--root", root], capture().s)).toBe(2)
    expect(await main(["find", "x", "--wiki", "--code"], capture().s)).toBe(2)
    expect(await main(["find", "x", "--limit", "0"], capture().s)).toBe(2)
    expect(await main(["find", "(", "--regex", "--root", root], capture().s)).toBe(2)
  })
  test("--regex", async () => {
    const c = capture()
    await main(["find", "quas.r\\s+appears", "--wiki", "--regex", "--root", root], c.s)
    expect(c.out()).toContain("wiki/Notes/other.md:3")
  })
})

describe("repo outline", () => {
  const root = repo({
    "doc.md": "# Top\n\n```\n# not a heading\n```\n## Second\n#### too deep\n### Third\n",
    "m.ts": "import x from 'y'\nexport function foo() {}\nexport default class Bar {}\nexport const baz = 1\nexport type T = 1\nconst hidden = 1\n",
    "data.json": "{}",
  })
  test("markdown: line + heading, skips fences and h4, next: Read for first heading", async () => {
    const c = capture()
    expect(await main(["outline", "doc.md", "--root", root], c.s)).toBe(0)
    expect(c.out()).toBe("1  # Top\n6  ## Second\n8  ### Third\nnext: Read doc.md offset=1 limit=60\n")
  })
  test("ts: top-level exports only", () => {
    expect(outline(join(root, "m.ts"))).toEqual([
      { line: 2, text: "function foo" },
      { line: 3, text: "class Bar" },
      { line: 4, text: "const baz" },
      { line: 5, text: "type T" },
    ])
  })
  test("missing file fails with next:; unsupported type fails", async () => {
    const a = capture()
    expect(await main(["outline", "nope.md", "--root", root], a.s)).toBe(1)
    expect(a.err()).toContain("next: bun run repo find")
    expect(await main(["outline", "data.json", "--root", root], capture().s)).toBe(1)
    expect(await main(["outline"], capture().s)).toBe(2)
  })
})

describe("real repo performance", () => {
  test("--wiki < 1.5 s, --code < 3 s (warm)", async () => {
    await main(["find", "ownership", "--wiki"], capture().s)
    let t = performance.now()
    await main(["find", "ownership", "--wiki"], capture().s)
    expect(performance.now() - t).toBeLessThan(1500)
    t = performance.now()
    await main(["find", "classifyBash", "--code"], capture().s)
    expect(performance.now() - t).toBeLessThan(3000)
  }, 20000)
})

describe("hook rule no-shell-grep-repo", () => {
  const rules = loadRules(REPO)
  const verdict = (cmd: string): string => {
    const v = classifyBash(cmd, rules, {})
    return v.decision === "deny" ? v.ruleId : "allow"
  }
  test.each([
    "grep -r foo wiki/",
    "rg foo packages/",
    "find . -name '*.ts' | xargs grep x",
    "grep -rn foo packages && echo done",
    "ugrep -r foo wiki",
    "FOO=1 grep -R x wiki",
  ])("denies %s", (cmd) => expect(verdict(cmd)).toBe("no-shell-grep-repo"))
  test("deny text names the alternative", () => {
    const v = classifyBash("grep -r foo wiki/", rules, {})
    expect(v.decision === "deny" && v.reason).toContain('bun run repo find "<query>"')
  })
  test.each([
    "git grep -n x -- file",
    "grep -c foo one-file.txt | head",
    'echo "grep -r"',
    "git log --oneline | grep fix",
    "git log | grep -i x | head",
    "ls | rg y",
    "bun run repo test x | cat",
    "grep -n foo packages/core/src/x.ts",
    "grep --include=x foo file.txt",
    "grep -rn foo /tmp/scratch",
    "rg --version",
    "git commit -m 'use grep -r or rg'",
    "bun run repo find \"grep -r\" --wiki",
    "# rg foo packages",
    "cat > f.sh <<'EOF'\ngrep -r foo wiki\nrg x packages\nEOF",
  ])("allows %s", (cmd) => expect(verdict(cmd)).toBe("allow"))
})

describe("fix round 1: stale, ranking, output", () => {
  const root = repo({
    "wiki/Home.md": "# Home\n\nzeta hub\n",
    "wiki/MOCs/Index.md": "# Index\n\nzeta moc\n",
    "wiki/Notes/prose1.md": "---\nstatus: SUPERSEDED (2026-07-19) — replaced by X\n---\n# P1\n\nzeta one\n",
    "wiki/Notes/prose2.md": "---\nStatus: superseded (2026-07-31 wiki-lint run)\n---\n# P2\n\nzeta two\n",
    "wiki/Notes/live.md": "---\nstatus: active\n---\n# Live\n\nzeta live\n",
    "wiki/Architecture/Specs/spec.md": "# Spec\n\nzeta in a spec\n",
    "wiki/Planning/Implementation-Plans/plan.md": "# Plan\n\nzeta in a plan\n",
    "packages/p/src/impl.ts": "// zeta is documented here\nimport { zeta } from './x'\nexport function zeta(): void {}\nclass B {\n  zeta(a: number) {}\n}\n",
    "packages/p/tests/t.test.ts": "export function zeta(): void {}\n",
    "tools/repo/checks.json": JSON.stringify({
      schemaVersion: 1,
      checks: [{ id: "check-file-size", script: "scripts/check-file-size.sh", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" }],
    }),
  })
  test("Home, MOCs, prose and capitalised statuses are stale and sort last", () => {
    const hits = findHits("zeta", "wiki", root, 50)
    const stale = hits.filter((h) => h.stale).map((h) => h.path).sort()
    expect(stale).toEqual(["wiki/Home.md", "wiki/MOCs/Index.md", "wiki/Notes/prose1.md", "wiki/Notes/prose2.md"])
    const firstStale = hits.findIndex((h) => h.stale)
    expect(hits.slice(0, firstStale).every((h) => !h.stale)).toBe(true)
    expect(hits[0]?.path).toBe("wiki/Architecture/Specs/spec.md")
    expect(hits.findIndex((h) => h.path.includes("Implementation-Plans"))).toBeGreaterThan(
      hits.findIndex((h) => h.path.endsWith("live.md")),
    )
  })
  test("definition line beats import/comment/call; src beats tests", () => {
    const hits = findHits("zeta", "code", root, 50)
    expect(hits[0]).toMatchObject({ path: "packages/p/src/impl.ts", line: 3 })
    const lines = hits.filter((h) => h.path === "packages/p/src/impl.ts").map((h) => h.line)
    expect(lines).toEqual([3, 5])
    expect(hits.findIndex((h) => h.path.includes("tests/"))).toBeGreaterThan(0)
  })
  test("name hit prints path once; frontmatter lines are not content hits", async () => {
    const c = capture()
    await main(["find", "live", "--wiki", "--root", root], c.s)
    expect(c.out()).toContain("wiki/Notes/live.md  Live\n")
    expect(c.out()).not.toContain("status: active")
    const code = capture()
    await main(["find", "impl", "--code", "--root", root], code.s)
    expect(code.out().split("\n")[0]).toBe("packages/p/src/impl.ts")
  })
  test("--scripts finds registered checks and shows the invoke", async () => {
    const c = capture()
    await main(["find", "check-file-size", "--scripts", "--root", root], c.s)
    expect(c.out()).toContain("scripts/check-file-size.sh  bun run repo check --only check-file-size")
  })
})

describe("hook rule no-shell-grep-repo: operands", () => {
  const rules = loadRules(REPO)
  const at = (cmd: string): string => {
    const v = classifyBash(cmd, rules, {}, { root: "/work/repo" })
    return v.decision === "deny" ? v.ruleId : "allow"
  }
  test.each([
    "grep -rn foo wiki ~",
    "grep -rn foo /work/repo/wiki",
    "grep -r foo wiki /tmp/x",
    "rg foo",
    "rg -t ts foo packages",
    "grep -r -e foo wiki",
    "grep -rA 3 foo wiki/",
    "grep -r foo -- wiki",
    'grep -rn "a b" "wiki/x y"',
    "a && grep -r foo wiki",
  ])("denies %s", (cmd) => expect(at(cmd)).toBe("no-shell-grep-repo"))
  test.each([
    "grep -rn foo ./node_modules/pkg",
    "grep -r foo node_modules/pkg/lib",
    "grep -r foo /home/other/dir",
    "grep -r foo /tmp/x /var/log",
    'grep -rn foo "/tmp/my dir"',
    "grep -r foo ~/notes $HOME/x",
    "grep -- -r file",
    "grep -n -- foo -r",
    "rg foo /home/other",
    "rg --help",
    "echo x | grep -r foo",
    "grep foo file.txt",
  ])("allows %s", (cmd) => expect(at(cmd)).toBe("allow"))
  test("known false allow: git ls-files | xargs grep", () => expect(at("git ls-files | xargs grep foo")).toBe("allow"))
})

describe("output cap contract", () => {
  test("find with many hits ends within 40 lines + overflow line", async () => {
    const many = repo(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`wiki/p${i}.md`, "# P\n\nneedle\n"])))
    const c = capture()
    await main(["find", "needle", "--wiki", "--limit", "55", "--root", many], c.s)
    const lines = c.out().trimEnd().split("\n")
    expect(lines.length).toBeLessThanOrEqual(41)
    expect(lines[lines.length - 1]).toStartWith("... ")
  })
})
