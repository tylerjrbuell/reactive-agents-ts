import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { commands } from "../src/cli.ts"
import { loadRules } from "../src/lib/hook-rules.ts"
import { auditSkills, TOOLING_CLOSE, TOOLING_OPEN } from "../src/lib/skills.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const NAMES = commands.map((c) => c.name)
const rules = loadRules(REPO)
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const PARA = ["tooling line one", "tooling line two"]
const MANIFEST = { schemaVersion: 1, indexMissing: [], indexStale: [], wardenParagraph: PARA }
const WARDEN = `# w\n\n${TOOLING_OPEN}\n${PARA.join("\n")}\n${TOOLING_CLOSE}\n`
const skill = (name: string, body = "body"): string => `---\nname: ${name}\ndescription: Use when testing ${name}.\n---\n\n${body}\n`

function fixture(files: Record<string, string>, links: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "repo-skills-"))
  dirs.push(root)
  const all: Record<string, string> = {
    "tools/repo/skills.json": JSON.stringify(MANIFEST),
    "AGENTS.md": "## Project Skills Index\n\n- `alpha` - a\n\n---\n",
    ".claude/agents/w.md": WARDEN,
    ".agents/skills/alpha/SKILL.md": skill("alpha"),
    ...files,
  }
  for (const [p, c] of Object.entries(all)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  mkdirSync(join(root, ".claude", "skills"), { recursive: true })
  for (const [name, target] of Object.entries(links)) symlinkSync(target, join(root, ".claude", "skills", name))
  return root
}

const audit = (root: string): string[] => auditSkills(root, NAMES, rules).map((p) => `${p.skill}: ${p.problem}`)

describe("auditSkills fixtures", () => {
  test("a consistent tree is valid", () => {
    expect(audit(fixture({}, { alpha: "../../.agents/skills/alpha" }))).toEqual([])
  })

  test("frontmatter name must equal dir and description must be set", () => {
    const bad = fixture({ ".agents/skills/alpha/SKILL.md": "---\nname: other\ndescription: \"\"\n---\nx\n" })
    const out = audit(bad)
    expect(out.some((l) => l.includes('must equal dir "alpha"'))).toBe(true)
    expect(out.some((l) => l.includes("description is empty"))).toBe(true)
  })

  test("missing backticked repo path is flagged; globs, placeholders and fences are not", () => {
    const root = fixture({
      ".agents/skills/alpha/SKILL.md": skill("alpha", "see `packages/gone/src/x.ts` and `packages/*/src` and `wiki/<x>/y.md`\n\n```\n`packages/fenced/x.ts`\n```"),
    })
    expect(audit(root)).toEqual(["alpha: line 6: path does not exist: packages/gone/src/x.ts"])
  })

  test("a missing path that git ignores is a runtime artifact, not drift", () => {
    const root = fixture({
      ".gitignore": "tools/runtime-logs/\n",
      ".agents/skills/alpha/SKILL.md": skill("alpha", "logged to `tools/runtime-logs/overrides.jsonl`; see `tools/gone/x.ts`"),
    })
    expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0)
    expect(audit(root)).toEqual(["alpha: line 6: path does not exist: tools/gone/x.ts"])
  })

  test("unknown `bun run repo` command is flagged", () => {
    const root = fixture({ ".agents/skills/alpha/SKILL.md": skill("alpha", "run `bun run repo nope`") })
    expect(audit(root).join("\n")).toContain('unknown command "bun run repo nope"')
  })

  test("forbidden shell patterns in fenced bash are flagged, prose mentions are not", () => {
    const root = fixture({
      ".agents/skills/alpha/SKILL.md": skill("alpha", "never `bun test | tail`\n\n```bash\nbun test packages/x | tail -5\n```"),
    })
    const out = audit(root)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain("forbidden pattern (no-piped-test)")
  })

  test("AGENTS.md index mismatches are flagged both ways and tolerated via skills.json", () => {
    const files = { ".agents/skills/beta/SKILL.md": skill("beta"), "AGENTS.md": "## Project Skills Index\n\n- `alpha` - a\n- `ghost` - g\n\n---\n" }
    const out = audit(fixture(files, { alpha: "../../.agents/skills/alpha" }))
    expect(out.some((l) => l.startsWith("ghost: listed in AGENTS.md index"))).toBe(true)
    expect(out.some((l) => l.startsWith("beta: not in AGENTS.md"))).toBe(true)
    const tolerated = fixture({
      ...files,
      "tools/repo/skills.json": JSON.stringify({ ...MANIFEST, indexMissing: ["beta"], indexStale: ["ghost"] }),
    })
    expect(audit(tolerated)).toEqual([])
  })

  test("a resolved tolerance entry must be removed", () => {
    const root = fixture({ "tools/repo/skills.json": JSON.stringify({ ...MANIFEST, indexMissing: ["alpha"] }) })
    expect(audit(root).join("\n")).toContain("alpha: skills.json#indexMissing entry is resolved")
  })

  test(".claude/skills symlinks: dangling and foreign targets fail, real dirs are tolerated", () => {
    const root = fixture(
      { ".claude/skills/third-party/SKILL.md": "x" },
      { alpha: "../../.agents/skills/alpha", dead: "../../.agents/skills/missing", foreign: "../agents" },
    )
    const out = audit(root)
    expect(out).toContain(".claude/skills/dead: dangling symlink (git rm it)")
    expect(out).toContain(".claude/skills/foreign: symlink does not resolve into .agents/skills")
    expect(out.filter((l) => l.startsWith(".claude/skills/"))).toHaveLength(2)
  })

  test("wardens need the shared paragraph, identical to skills.json", () => {
    const missing = fixture({ ".claude/agents/w.md": "# no paragraph\n" })
    expect(audit(missing).join("\n")).toContain(".claude/agents/w.md: missing <!-- repo-tooling -->")
    const drift = fixture({ ".claude/agents/w.md": `${TOOLING_OPEN}\nother text\n${TOOLING_CLOSE}\n` })
    expect(audit(drift).join("\n")).toContain("differs from skills.json#wardenParagraph")
    const cmd = fixture({ ".claude/agents/w.md": `${WARDEN}\nrun bun run repo bogus\n` })
    expect(audit(cmd).join("\n")).toContain('unknown command "bun run repo bogus"')
  })
})

describe("auditSkills on the real repo", () => {
  test("is clean", () => {
    expect(auditSkills(REPO, NAMES).map((p) => `${p.skill}: ${p.problem}`)).toEqual([])
  })
})
