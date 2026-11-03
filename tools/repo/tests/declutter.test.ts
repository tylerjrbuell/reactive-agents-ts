import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const at = (p: string): string => join(REPO, p)

const DELETED = [
  ".agents/CORTEX-PUBLISH-GUIDE.md",
  ".agents/KNOWN-ISSUES.md",
  ".agents/PATCH-ISSUES-v0.11.0.md",
  ".agents/PHASE-1-SYNTHESIS.md",
  ".agents/RELEASE-SWEEP-SUMMARY.md",
  ".agents/V0_11_0-PATCH-VERIFICATION.md",
  "scripts/add-package-keywords.ts",
]

const MOVED: ReadonlyArray<readonly [string, string]> = [
  [".agents/MEMORY-ARCHIVE.md", "wiki/Research/Agent-Memory-Archive.md"],
  ["scripts/build-judge-container.sh", "packages/judge-server/scripts/build-judge-container.sh"],
  ["scripts/judge-up.sh", "packages/judge-server/scripts/judge-up.sh"],
  ["scripts/run-frozen-judge-regression.sh", "packages/judge-server/scripts/run-frozen-judge-regression.sh"],
  ["scripts/capture-golden-run.ts", "packages/benchmarks/scripts/capture-golden-run.ts"],
  ["scripts/telegram-session.sh", "docker/telegram-session.sh"],
  ["scripts/signal-register.sh", "docker/signal-mcp/register.sh"],
  [".superpowers/sdd/progress.md", "wiki/Research/Debriefs/_archive/2026-07-sdd/progress.md"],
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

describe("declutter", () => {
  test("deleted paths are absent", () => {
    for (const p of DELETED) expect(existsSync(at(p)), p).toBe(false)
  })

  test("moved sources are absent and destinations exist", () => {
    for (const [from, to] of MOVED) {
      expect(existsSync(at(from)), `${from} should be gone`).toBe(false)
      expect(existsSync(at(to)), `${to} should exist`).toBe(true)
    }
  })

  test(".agents/ holds only MEMORY.md and skills/", () => {
    expect(readdirSync(at(".agents")).sort()).toEqual(["MEMORY.md", "skills"])
  })

  test("moved judge scripts resolve the repo root from their new depth", () => {
    for (const f of ["build-judge-container.sh", "judge-up.sh", "run-frozen-judge-regression.sh"]) {
      const text = readFileSync(at(`packages/judge-server/scripts/${f}`), "utf8")
      expect(text, f).toContain('"$(dirname "$0")/../../.."')
    }
  })

  test("wiki hubs point at the canonical index and are marked stale", () => {
    const hubs = ["wiki/Home.md", ...readdirSync(at("wiki/MOCs")).map((f) => `wiki/MOCs/${f}`)]
    for (const h of hubs) {
      const text = readFileSync(at(h), "utf8")
      expect(text, h).toContain("Canonical Wiki Index")
      expect(text, h).toContain("Repo-Navigation")
      expect(text, h).toMatch(/^---\n[\s\S]*?status: stale\n[\s\S]*?---\n/)
      expect(text.split("\n").length, h).toBeLessThan(20)
    }
  })

  test("copilot instructions point at AGENTS.md and the repo CLI", () => {
    const text = readFileSync(at(".github/copilot-instructions.md"), "utf8")
    expect(text).toContain("AGENTS.md")
    expect(text).toContain("bun run repo help")
    expect(text).not.toContain("claude-mem")
  })

  test("no skill instructs a piped `bun test`", () => {
    const re = /bun test[^\n`]*\|/
    for (const f of walk(at(".agents/skills")).filter((p) => statSync(p).isFile() && p.endsWith(".md"))) {
      expect(re.test(readFileSync(f, "utf8")), f).toBe(false)
    }
  })
})
