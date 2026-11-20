import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { decideDocsSkip, docsSkipFor, isDocsPath, nearestVerified, parseVerified } from "../src/lib/docs-only-push.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const A = "a".repeat(40)
const B = "b".repeat(40)

describe("isDocsPath", () => {
  test("wiki, .agents and root *.md are docs", () => {
    for (const p of ["wiki/Hot.md", "wiki/Research/x/y.png", ".agents/MEMORY.md", ".agents/skills/repo-tool/SKILL.md", "AGENTS.md", "CHANGELOG.md", "README.MD"])
      expect(isDocsPath(p)).toBe(true)
  })
  test("everything else is code", () => {
    for (const p of ["packages/core/README.md", "apps/docs/x.md", "tools/repo/src/cli.ts", ".github/workflows/ci.yml", "package.json", "wikifoo/a.md", ".agentsrc", "VERSION"])
      expect(isDocsPath(p)).toBe(false)
  })
})

describe("decideDocsSkip", () => {
  test("docs-only since a verified ancestor: skip", () => {
    expect(decideDocsSkip(A, ["wiki/Hot.md", "AGENTS.md"])).toEqual({ skip: true, base: A, files: 2 })
  })
  test("any code file: run, naming it", () => {
    const d = decideDocsSkip(A, ["wiki/Hot.md", "scripts/release.ts"])
    expect(d.skip).toBe(false)
    if (!d.skip) expect(d.reason).toContain("scripts/release.ts")
  })
  test("no verified ancestor: run", () => {
    expect(decideDocsSkip(undefined, ["wiki/Hot.md"])).toEqual({ skip: false, reason: "no mirror-verified ancestor" })
  })
  test("nearestVerified picks the newest verified ancestor", () => {
    expect(nearestVerified(["c".repeat(40), B, A], new Set([A, B]))).toBe(B)
    expect(nearestVerified([B], new Set([A]))).toBeUndefined()
  })
  test("parseVerified reads ci-verified.jsonl and ignores bad lines", () => {
    expect(parseVerified(`{"sha":"${A}","ts":"x"}\nnot json\n{"sha":"short"}\n`)).toEqual(new Set([A]))
  })
})

describe("docsSkipFor on a real git history", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-only-push-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim()
  const commit = (files: Record<string, string>, rm: string[] = []): string => {
    for (const [p, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true })
      writeFileSync(join(dir, p), body)
    }
    for (const p of rm) git("rm", "-q", p)
    git("add", "-A")
    git("commit", "-q", "-m", "c")
    return git("rev-parse", "HEAD")
  }
  const verify = (sha: string): void => {
    mkdirSync(join(dir, ".repo-logs"), { recursive: true })
    writeFileSync(join(dir, ".repo-logs/ci-verified.jsonl"), `{"sha":"${sha}","ts":"t","seconds":1}\n`)
  }
  git("init", "-q")
  const base = commit({ ".gitignore": ".repo-logs/\n", "src/a.ts": "export const a = 1\n", "wiki/x.md": "x\n" })

  test("no verified ancestor: run", () => {
    expect(docsSkipFor(dir, base).skip).toBe(false)
  })
  test("docs-only commits after a verified ancestor: skip", () => {
    verify(base)
    commit({ "wiki/x.md": "y\n" })
    const head = commit({ "AGENTS.md": "a\n", ".agents/MEMORY.md": "m\n" })
    expect(docsSkipFor(dir, head)).toEqual({ skip: true, base, files: 3 })
  })
  test("a code commit anywhere after the verified ancestor: run", () => {
    commit({ "src/a.ts": "export const a = 2\n" })
    const head = commit({ "wiki/x.md": "z\n" })
    const d = docsSkipFor(dir, head)
    expect(d.skip).toBe(false)
    if (!d.skip) expect(d.reason).toContain("src/a.ts")
  })
  test("a code file moved into wiki/ counts as code (rename detection off)", () => {
    const v = commit({ "src/b.ts": "export const b = 'a long enough body for rename detection'\n" })
    verify(v)
    writeFileSync(join(dir, "wiki/b.ts"), readFileSync(join(dir, "src/b.ts")))
    const head = commit({}, ["src/b.ts"])
    const d = docsSkipFor(dir, head)
    expect(d.skip).toBe(false)
    if (!d.skip) expect(d.reason).toContain("src/b.ts")
  })
  test("CLI: exit 0 and a reason line on skip, exit 1 otherwise", () => {
    const v = git("rev-parse", "HEAD")
    verify(v)
    const docs = commit({ "wiki/y.md": "y\n" })
    const script = join(REPO, "tools/repo/src/lib/docs-only-push.ts")
    const skip = spawnSync("bun", [script, docs], { cwd: dir, encoding: "utf8" })
    expect(skip.status).toBe(0)
    expect(skip.stdout).toContain("docs-only since mirror-verified")
    const code = commit({ "src/c.ts": "c\n" })
    const run = spawnSync("bun", [script, code], { cwd: dir, encoding: "utf8" })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain("src/c.ts")
  })
})

describe("pre-push hook on the docs-only path (fake bun on PATH)", () => {
  // The fake bun answers the docs-only decision with FAKE_DOCS (0 skip, 1 run), `check --all` with
  // FAKE_CHECK, and `ci` with 0; each call is appended to calls.log.
  const dir = mkdtempSync(join(tmpdir(), "pre-push-hook-"))
  const bin = join(dir, "bin")
  const work = join(dir, "work")
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(bin, { recursive: true })
  mkdirSync(join(work, "tools/repo/src"), { recursive: true })
  writeFileSync(join(work, "tools/repo/src/cli.ts"), "")
  writeFileSync(
    join(bin, "bun"),
    [
      "#!/bin/bash",
      `echo "$*" >> "${join(dir, "calls.log")}"`,
      'case "$*" in',
      '  *docs-only-push.ts*) echo "docs-only since mirror-verified abc"; exit "${FAKE_DOCS:-0}" ;;',
      '  *"check --all"*) if [[ "${FAKE_CHECK:-0}" == 1 ]]; then echo "checks: 37 pass, 1 fail"; echo "failed: agents-md-size"; echo "next: shrink AGENTS.md"; fi; exit "${FAKE_CHECK:-0}" ;;',
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  )
  chmodSync(join(bin, "bun"), 0o755)
  const g = (...args: string[]): string =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: work, encoding: "utf8" }).trim()
  g("init", "-q")
  g("commit", "-q", "--allow-empty", "-m", "c")
  const sha = g("rev-parse", "HEAD")
  const push = (ref: string, env: Record<string, string>): { status: number | null; err: string; calls: string[]; log: string } => {
    rmSync(join(dir, "calls.log"), { force: true })
    rmSync(join(work, ".repo-logs"), { recursive: true, force: true })
    const r = spawnSync("bash", [join(REPO, ".githooks/pre-push")], {
      cwd: work,
      input: `${ref} ${sha} ${ref} ${"0".repeat(40)}\n`,
      env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      encoding: "utf8",
    })
    const read = (p: string): string => {
      try {
        return readFileSync(p, "utf8")
      } catch {
        return ""
      }
    }
    return { status: r.status, err: r.stderr, calls: read(join(dir, "calls.log")).split("\n").filter(Boolean), log: read(join(work, ".repo-logs/pre-push.jsonl")) }
  }

  test("docs-only + check --all passes: mirror skipped, logged docs-only", () => {
    const r = push("refs/heads/dev", {})
    expect(r.status).toBe(0)
    expect(r.calls.some((c) => c.includes("check --all"))).toBe(true)
    expect(r.calls.some((c) => c.includes(" ci "))).toBe(false)
    expect(r.err).toContain("CI mirror skipped for")
    expect(r.err).toContain("check --all passed")
    expect(r.log).toContain('"note":"docs-only"')
  })
  test("docs-only + check --all fails: push blocked naming the check, never logged docs-only", () => {
    const r = push("refs/heads/dev", { FAKE_CHECK: "1" })
    expect(r.status).toBe(1)
    expect(r.err).toContain("push blocked")
    expect(r.err).toContain("failed: agents-md-size")
    expect(r.calls.some((c) => c.includes(" ci "))).toBe(false)
    expect(r.log).not.toContain('"note":"docs-only"')
    expect(r.log).toContain('"note":"docs-only-check-fail"')
  })
  test("check --all tool error: full mirror runs", () => {
    const r = push("refs/heads/dev", { FAKE_CHECK: "3" })
    expect(r.status).toBe(0)
    expect(r.calls.some((c) => c.includes(`ci --rev ${sha}`))).toBe(true)
    expect(r.log).toContain('"note":"pass"')
  })
  test("not docs-only: full mirror, no check --all", () => {
    const r = push("refs/heads/dev", { FAKE_DOCS: "1" })
    expect(r.calls.some((c) => c.includes("check --all"))).toBe(false)
    expect(r.calls.some((c) => c.includes(`ci --rev ${sha}`))).toBe(true)
  })
  test("tag push: never docs-only, full mirror", () => {
    const r = push("refs/tags/v9.9.9", {})
    expect(r.calls.some((c) => c.includes("docs-only-push.ts"))).toBe(false)
    expect(r.calls.some((c) => c.includes(`ci --rev ${sha}`))).toBe(true)
  })
})
