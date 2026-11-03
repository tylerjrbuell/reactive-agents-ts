import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { main, type Streams } from "../src/cli.ts"
import { classifyBash, loadRules } from "../src/lib/hook-rules.ts"
import { preBash } from "../src/commands/hook.ts"
import { describeRun, pruneRunLogs } from "../src/commands/test.ts"
import { fillBase } from "../src/lib/friction.ts"
import { mirrorRepo, REPO_ROOT } from "./mirror.ts"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), p))
  dirs.push(d)
  return d
}

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return { s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) }, out: () => o, err: () => e }
}

function checksJson(checks: readonly object[]): string {
  return JSON.stringify({ schemaVersion: 1, checks })
}
const entry = (over: object): object => ({ scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2099-01-01", ...over })

function root(checks: string, files: Record<string, string> = {}): string {
  const r = tmp("repo-wave-")
  mkdirSync(join(r, "tools", "repo"), { recursive: true })
  writeFileSync(join(r, "tools", "repo", "checks.json"), checks)
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(r, p, ".."), { recursive: true })
    writeFileSync(join(r, p), c)
  }
  return r
}

describe("internal errors exit 3", () => {
  test("malformed checks.json: exit 3, last line is next:", async () => {
    const r = root("{ not json")
    const c = capture()
    expect(await main(["check", "--all", "--root", r], c.s)).toBe(3)
    const lines = c.err().trim().split("\n")
    expect(lines[0]).toStartWith("internal error:")
    expect(lines[lines.length - 1]).toBe("next: bun run repo check --help")
  })
  test("a real check failure stays exit 1", async () => {
    const r = root(checksJson([entry({ id: "c", script: "scripts/check-c.sh" })]), { "scripts/check-c.sh": "exit 1\n" })
    const c = capture()
    expect(await main(["check", "--all", "--root", r], c.s)).toBe(1)
  })
})

describe("expiry never blocks hooks or pre-commit", () => {
  const stale = (): string =>
    root(checksJson([entry({ id: "c", script: "scripts/check-c.sh", stages: ["ci", "pre-commit"], reviewBy: "2020-01-01" })]), {
      "scripts/check-c.sh": "exit 0\n",
    })
  test("ci stage: fails", async () => {
    const c = capture()
    expect(await main(["check", "--all", "--root", stale()], c.s)).toBe(1)
    expect(c.err()).toContain("past reviewBy + 30 days")
  })
  test("pre-commit stage: one warn line, exit 0", async () => {
    const c = capture()
    expect(await main(["check", "--all", "--stage", "pre-commit", "--root", stale()], c.s)).toBe(0)
    expect(c.out()).toContain("warn: past reviewBy + 30 days: c")
  })
  test("real repo: manifest-expiry is CI only", async () => {
    const { loadChecks } = await import("../src/lib/manifest.ts")
    expect(loadChecks(REPO_ROOT).find((e) => e.id === "manifest-expiry")?.stages).toEqual(["ci"])
  })
})

describe("check --staged", () => {
  function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
    const r = spawnSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" })
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`)
  }
  function repo(): string {
    const r = root(
      checksJson([
        entry({ id: "reasoning-gate", script: "scripts/check-r.sh", scope: ["packages/reasoning/src/**"], stages: ["pre-commit"] }),
      ]),
      { "scripts/check-r.sh": "exit 1\n", "packages/reasoning/src/a.ts": "1\n", "docs/x.md": "x\n" },
    )
    git(r, ["init", "-q"])
    git(r, ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"])
    git(r, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"])
    return r
  }
  test("an unstaged dirty reasoning file does not select reasoning gates", async () => {
    const r = repo()
    writeFileSync(join(r, "packages/reasoning/src/a.ts"), "2\n") // dirty, NOT staged
    writeFileSync(join(r, "docs/x.md"), "y\n")
    git(r, ["add", "docs/x.md"])
    const c = capture()
    expect(await main(["check", "--staged", "--stage", "pre-commit", "--root", r], c.s)).toBe(0)
    const d = capture()
    expect(await main(["check", "--changed", "--stage", "pre-commit", "--root", r], d.s)).toBe(1) // the working diff does select it
  })
  test("staging the reasoning file selects the gate", async () => {
    const r = repo()
    writeFileSync(join(r, "packages/reasoning/src/a.ts"), "2\n")
    git(r, ["add", "packages/reasoning/src/a.ts"])
    const c = capture()
    expect(await main(["check", "--staged", "--stage", "pre-commit", "--root", r], c.s)).toBe(1)
  })
  test("honors GIT_INDEX_FILE and ignores untracked files", async () => {
    const r = repo()
    const idx = join(tmp("repo-idx-"), "index")
    git(r, ["read-tree", "HEAD"], { GIT_INDEX_FILE: idx })
    writeFileSync(join(r, "packages/reasoning/src/new.ts"), "n\n") // untracked
    const before = process.env.GIT_INDEX_FILE
    process.env.GIT_INDEX_FILE = idx
    try {
      const c = capture()
      expect(await main(["check", "--staged", "--stage", "pre-commit", "--root", r], c.s)).toBe(0)
      git(r, ["add", "packages/reasoning/src/new.ts"], { GIT_INDEX_FILE: idx })
      const d = capture()
      expect(await main(["check", "--staged", "--stage", "pre-commit", "--root", r], d.s)).toBe(1)
    } finally {
      if (before === undefined) delete process.env.GIT_INDEX_FILE
      else process.env.GIT_INDEX_FILE = before
    }
  })
  test("--staged conflicts with --all", async () => {
    const c = capture()
    expect(await main(["check", "--staged", "--all"], c.s)).toBe(2)
  })
})

describe("pre-commit hook against the real repo", () => {
  const idx = join(tmp("repo-hookidx-"), "index")
  const env = { ...process.env, GIT_INDEX_FILE: idx }
  const sh = (cmd: string, args: string[], over: Record<string, string> = {}): { status: number | null; out: string } => {
    const r = spawnSync(cmd, args, { cwd: REPO_ROOT, env: { ...env, ...over }, encoding: "utf8" })
    return { status: r.status, out: `${r.stdout}${r.stderr}` }
  }
  test("clean index is silent and fast; unregistered staged script fails with next:; a crashing tool fails open", () => {
    expect(sh("git", ["read-tree", "HEAD"]).status).toBe(0)
    const t = performance.now()
    const clean = sh("bash", [".githooks/pre-commit"])
    expect(clean.status).toBe(0)
    expect(clean.out).toBe("")
    expect(performance.now() - t).toBeLessThan(1000 * (Number(process.env.REPO_BUDGET_FACTOR ?? "1") || 1))

    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: REPO_ROOT, input: "#!/bin/bash\n", encoding: "utf8" }).stdout.trim()
    expect(sh("git", ["update-index", "--add", "--cacheinfo", `100755,${blob},scripts/zz-new.sh`]).status).toBe(0)
    const bad = sh("bash", [".githooks/pre-commit"])
    expect(bad.status).toBe(1)
    expect(bad.out).toContain("next: add scripts/zz-new.sh to tools/repo/catalog.json")

    const fake = tmp("repo-fakebun-")
    writeFileSync(join(fake, "bun"), "#!/bin/bash\nexit 7\n")
    chmodSync(join(fake, "bun"), 0o755)
    const open = sh("bash", [".githooks/pre-commit"], { PATH: `${fake}:${process.env.PATH ?? ""}` })
    expect(open.status).toBe(0)
    expect(open.out).toContain("commit allowed")
  })
})

describe("REPO_HOOKS=off prefix", () => {
  const payload = (command: string): string => JSON.stringify({ tool_input: { command } })
  test("prefix lets one piped bun test through; without it, denied", () => {
    const r = mirrorRepo()
    expect(preBash(r, payload("bun test a | tail -3"), {})).toContain("deny")
    expect(preBash(r, payload("REPO_HOOKS=off bun test a | tail -3"), {})).toBeUndefined()
  })
})

describe("no-cd-prefix only fires on in-repo cd && forms", () => {
  const rules = loadRules(REPO_ROOT)
  const decide = (c: string): string => classifyBash(c, rules, {}, { root: REPO_ROOT }).decision
  test("warns", () => {
    expect(decide("cd packages/core && ls")).toBe("warn")
    expect(decide(`cd ${REPO_ROOT}/tools && ls`)).toBe("warn")
  })
  test("allows outside-repo, bare cd, and ; forms", () => {
    for (const c of ["cd /tmp && ls", "cd /tmp/x/y && ls", "cd /tmp; ls", "cd packages/core", "cd packages/core; ls"])
      expect(decide(c)).toBe("allow")
  })
})

describe("run log rotation", () => {
  test("keeps the newest N test-/verify- logs and never touches jsonl", () => {
    const d = tmp("repo-logs-")
    for (let i = 0; i < 60; i++) {
      const f = join(d, `${i % 2 === 0 ? "test" : "verify"}-${String(i).padStart(3, "0")}.log`)
      writeFileSync(f, "x")
      utimesSync(f, 1_000_000 + i, 1_000_000 + i)
    }
    writeFileSync(join(d, "denies.jsonl"), "{}\n")
    pruneRunLogs(d, 50)
    const left = readdirSync(d)
    expect(left.filter((f) => f.endsWith(".log")).length).toBe(50)
    expect(left).toContain("denies.jsonl")
    expect(left).not.toContain("test-000.log")
    expect(left).toContain("verify-059.log")
  })
})

describe("timeout output", () => {
  test("only fail, log; no counts", () => {
    const lines = describeRun({
      exit: 143,
      summary: { pass: null, fail: null, skip: null, failures: [] },
      log: ".repo-logs/test-x.log",
      failed: true,
      timedOut: true,
      maxSeconds: 9,
    })
    expect(lines).toEqual(["fail: timeout after 9s", "log: .repo-logs/test-x.log"])
  })
})

describe("place hint by extension", () => {
  test("md -> wiki, ts -> package src, other -> no extension path", () => {
    const t = "create it in {where}"
    expect(fillBase(t, "note.md")).toContain("wiki/")
    expect(fillBase(t, "note.md")).not.toContain("packages/<name>/src")
    expect(fillBase(t, "scratch.ts")).toContain("packages/<name>/src/scratch.ts")
    expect(fillBase(t, "x.log")).not.toContain("src/")
    expect(fillBase(t, "x.log")).not.toContain("x.log")
  })
})

describe("scope path normalization", () => {
  test("absolute repo path works; outside path is labelled", async () => {
    const c = capture()
    expect(await main(["scope", join(REPO_ROOT, "tools/repo/src/cli.ts"), "/etc/hosts"], c.s)).toBe(0)
    expect(c.out()).toContain("no-owner")
    expect(c.out()).not.toContain("unowned")
    expect(c.out()).toContain("outside repo: /etc/hosts")
  })
  test("only outside paths", async () => {
    const c = capture()
    expect(await main(["scope", "/etc/hosts"], c.s)).toBe(0)
    expect(c.out().trim()).toBe("outside repo: /etc/hosts")
  })
})
