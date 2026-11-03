import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { REPO_ROOT } from "./mirror.ts"

const AGENTS = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8")
const MEMORY = readFileSync(join(REPO_ROOT, ".agents", "MEMORY.md"), "utf8")
const COUNT = /\b\d{1,3}(,\d{3})+ (pass|tests?|files)\b/
const TOPS = new Set(["packages", "apps", "wiki", "scripts", "tools", "docs", ".agents", ".claude", ".github", ".githooks", ".changeset"])
const SKIP = /YYYY|MM-DD|NN-|<|>|\*|\{|\}|\$|\.\.\.|\[|\]|\?|\s/

/** Backticked tokens outside code fences that name a concrete repo path. */
function pathMentions(text: string): readonly { path: string; line: number }[] {
  const out: { path: string; line: number }[] = []
  let fenced = false
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced) return
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = (m[1] as string).replace(/[:#].*$/, "").replace(/\/$/, "")
      if (SKIP.test(tok) || !/^[.\w@-][\w@./-]*$/.test(tok)) continue
      const rootFile = !tok.includes("/") && /^[A-Z][\w-]*\.md$/.test(tok)
      if (!rootFile && !(tok.includes("/") && TOPS.has(tok.split("/")[0] as string))) continue
      out.push({ path: tok, line: i + 1 })
    }
  })
  return out
}

/** Skill names listed under `## Project Skills Index` (lines `- \`name\` ...`). */
function indexedSkills(text: string): readonly string[] {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => /^##\s+Project Skills Index/.test(l))
  const out: string[] = []
  if (start < 0) return out
  for (const l of lines.slice(start + 1)) {
    if (/^(##\s|---\s*$)/.test(l)) break
    const m = /^- `([a-z0-9][a-z0-9-]*)`/.exec(l)
    if (m) out.push(m[1] as string)
  }
  return out
}

describe("AGENTS.md contract", () => {
  test("is at most 20,000 bytes", () => {
    expect(Buffer.byteLength(AGENTS, "utf8")).toBeLessThanOrEqual(20_000)
  })

  test("routes through the repo tool and ownership manifest", () => {
    expect(AGENTS).toContain("bun run repo status")
    expect(AGENTS).toContain("bun run repo scope")
    expect(AGENTS).toContain("tools/repo/ownership.json")
  })

  test("every concrete backticked repo path exists", () => {
    const missing = pathMentions(AGENTS)
      .filter((m) => !existsSync(join(REPO_ROOT, m.path)))
      .map((m) => `line ${m.line}: ${m.path}`)
    expect(missing).toEqual([])
  })

  test("one line distinguishes repo, rax and rax-diagnose; rax is annotated as the user CLI", () => {
    const lines = AGENTS.split("\n")
    expect(lines.some((l) => l.includes("`bun run repo`") && l.includes("`rax`") && l.includes("`rax-diagnose`"))).toBe(true)
    expect(lines.some((l) => l.includes("bun run rax") && l.includes("user CLI, not for repo checks"))).toBe(true)
  })

  test("no hand-written test/file counts in AGENTS.md or .agents/MEMORY.md", () => {
    expect(AGENTS.match(COUNT)?.[0] ?? null).toBeNull()
    expect(MEMORY.match(COUNT)?.[0] ?? null).toBeNull()
  })

  test("Project Skills Index matches .agents/skills dirs exactly", () => {
    const base = join(REPO_ROOT, ".agents", "skills")
    const dirs = readdirSync(base)
      .filter((n) => statSync(join(base, n)).isDirectory())
      .sort()
    expect([...indexedSkills(AGENTS)].sort()).toEqual(dirs)
  })
})
