import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, sep } from "node:path"
import { frontmatter } from "./frontmatter.ts"
import { classifyBash, loadRules, type HookRule } from "./hook-rules.ts"
import { readManifest } from "./manifest.ts"

/** One problem found in a skill, symlink or warden file. `skill` is the dir name or the file's repo path. */
export interface SkillProblem {
  skill: string
  problem: string
}

/** Opening and closing markers of the shared warden tooling paragraph. */
export const TOOLING_OPEN = "<!-- repo-tooling -->"
export const TOOLING_CLOSE = "<!-- /repo-tooling -->"

/** Top-level dirs a backticked path may start with even when absent, so a deleted dir is still flagged. */
const KNOWN_TOP = new Set(["packages", "apps", "wiki", "scripts", "tools", "docs", ".agents", ".claude", ".github", ".githooks", ".changeset"])
const SKIP_PATH = /YYYY|MM-DD|NN-|<|>|\*|\{|\}|\$|\.\.\.|\[|\]|\?|\s/
/** `bun run repo` inside a fenced example may be deliberately wrong; this line marker exempts a line. */
const IGNORE = "repo-drift-ignore"
const COMMAND = /bun run repo\s+([A-Za-z][\w-]*)/g
const SHELL_FENCE = /^```\s*(?:bash|sh|shell|console|zsh)?\s*$/

/**
 * True when git ignores `path`: a runtime artifact (e.g. `.repo-logs/overrides.jsonl`) that a skill may name but a
 * fresh clone never has. Only consulted for paths that are missing, so the git spawn is rare. No git → not ignored.
 */
export function gitIgnored(root: string, path: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: root }).status === 0
}

interface SkillsManifest {
  /** Skill dirs absent from AGENTS.md "Project Skills Index", tolerated until the index is fixed. */
  indexMissing: readonly string[]
  /** Names the index still lists although the skill dir was removed, tolerated until the index is fixed. */
  indexStale: readonly string[]
  /** Canonical warden paragraph body (lines between the markers). */
  wardenParagraph: readonly string[]
}

function names(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return []
  return v.map((e: unknown) => (typeof e === "string" ? e : typeof e === "object" && e !== null ? String((e as { skill?: unknown }).skill ?? "") : ""))
}

/** Load `tools/repo/skills.json`. Missing file means no tolerated mismatches and no canonical paragraph. */
export function loadSkillsManifest(root: string): SkillsManifest {
  if (!existsSync(join(root, "tools", "repo", "skills.json"))) return { indexMissing: [], indexStale: [], wardenParagraph: [] }
  const doc = readManifest(root, "skills.json")
  const para = Array.isArray(doc.wardenParagraph) ? doc.wardenParagraph.filter((l): l is string => typeof l === "string") : []
  return { indexMissing: names(doc.indexMissing), indexStale: names(doc.indexStale), wardenParagraph: para }
}

/** Dirs under `.agents/skills` that hold a SKILL.md or are plain dirs; sorted. */
function skillDirs(root: string): readonly string[] {
  const base = join(root, ".agents", "skills")
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function topLevel(root: string): ReadonlySet<string> {
  return new Set([...KNOWN_TOP, ...readdirSync(root)])
}

/** Inline-code tokens that look like a concrete repo path, with their 1-based line (fences and ignored lines skipped). */
function pathMentions(text: string, tops: ReadonlySet<string>): readonly { path: string; line: number }[] {
  const out: { path: string; line: number }[] = []
  let fenced = false
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      return
    }
    if (fenced || line.includes(IGNORE)) return
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = (m[1] as string).replace(/[:#].*$/, "").replace(/\/$/, "")
      if (!tok.includes("/") || SKIP_PATH.test(tok) || !/^[.\w@-][\w@./-]*$/.test(tok)) continue
      if (!tops.has(tok.split("/")[0] as string)) continue
      out.push({ path: tok, line: i + 1 })
    }
  })
  return out
}

/** Lines of shell-fenced code blocks, with 1-based line numbers. */
function shellLines(text: string): readonly { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  let shell: boolean | null = null
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      shell = shell === null ? SHELL_FENCE.test(line.trim()) : null
      return
    }
    if (shell === true && !line.includes(IGNORE)) out.push({ text: line.replace(/^\s*\$\s+/, ""), line: i + 1 })
  })
  return out
}

function commandProblems(label: string, text: string, commandNames: readonly string[] | undefined): SkillProblem[] {
  if (commandNames === undefined) return []
  const known = new Set(commandNames)
  const out: SkillProblem[] = []
  text.split("\n").forEach((line, i) => {
    if (line.includes(IGNORE)) return
    for (const m of line.matchAll(COMMAND))
      if (!known.has(m[1] as string)) out.push({ skill: label, problem: `line ${i + 1}: unknown command "bun run repo ${m[1] as string}"` })
  })
  return out
}

function indexedSkills(root: string): readonly string[] | null {
  const p = join(root, "AGENTS.md")
  if (!existsSync(p)) return null
  const lines = readFileSync(p, "utf8").split("\n")
  const start = lines.findIndex((l) => /^##\s+Project Skills Index/.test(l))
  if (start < 0) return null
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (/^(##\s|---\s*$)/.test(l)) break
    const m = /^- `([a-z0-9][a-z0-9-]*)`/.exec(l)
    if (m) out.push(m[1] as string)
  }
  return out
}

function indexProblems(root: string, dirs: readonly string[], man: SkillsManifest): SkillProblem[] {
  const indexed = indexedSkills(root)
  if (indexed === null) return []
  const out: SkillProblem[] = []
  const inIndex = new Set(indexed)
  const onDisk = new Set(dirs)
  for (const n of indexed)
    if (!onDisk.has(n) && !man.indexStale.includes(n)) out.push({ skill: n, problem: "listed in AGENTS.md index but .agents/skills has no such dir (remove the line or list it in skills.json#indexStale)" })
  for (const n of dirs)
    if (!inIndex.has(n) && !man.indexMissing.includes(n)) out.push({ skill: n, problem: "not in AGENTS.md Project Skills Index (add it or list it in skills.json#indexMissing)" })
  for (const n of man.indexStale)
    if (!inIndex.has(n) || onDisk.has(n)) out.push({ skill: n, problem: "skills.json#indexStale entry is no longer stale; remove it" })
  for (const n of man.indexMissing)
    if (inIndex.has(n) || !onDisk.has(n)) out.push({ skill: n, problem: "skills.json#indexMissing entry is resolved; remove it" })
  return out
}

function symlinkProblems(root: string): SkillProblem[] {
  const base = join(root, ".claude", "skills")
  if (!existsSync(join(root, ".agents", "skills"))) return []
  const skills = realpathSync(join(root, ".agents", "skills"))
  const out: SkillProblem[] = []
  for (const name of readdirSafe(base)) {
    const p = join(base, name)
    if (!lstatSync(p).isSymbolicLink()) continue
    let real: string
    try {
      real = realpathSync(p)
    } catch {
      out.push({ skill: `.claude/skills/${name}`, problem: "dangling symlink (git rm it)" })
      continue
    }
    if (!real.startsWith(skills + sep)) out.push({ skill: `.claude/skills/${name}`, problem: "symlink does not resolve into .agents/skills" })
  }
  return out
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

function wardenProblems(root: string, commandNames: readonly string[] | undefined, man: SkillsManifest): SkillProblem[] {
  const dir = join(root, ".claude", "agents")
  const out: SkillProblem[] = []
  for (const f of readdirSafe(dir).filter((n) => n.endsWith(".md"))) {
    const label = `.claude/agents/${f}`
    const text = readFileSync(join(dir, f), "utf8")
    const a = text.indexOf(TOOLING_OPEN)
    const b = text.indexOf(TOOLING_CLOSE)
    if (a < 0 || b < a) {
      out.push({ skill: label, problem: `missing ${TOOLING_OPEN} ... ${TOOLING_CLOSE} paragraph (text lives in tools/repo/skills.json#wardenParagraph)` })
    } else if (man.wardenParagraph.length > 0) {
      const body = text.slice(a + TOOLING_OPEN.length, b).trim()
      if (body !== man.wardenParagraph.join("\n").trim()) out.push({ skill: label, problem: "repo-tooling paragraph differs from skills.json#wardenParagraph" })
    }
    out.push(...commandProblems(label, text, commandNames))
  }
  return out
}

/**
 * Audit `.agents/skills`, the `.claude/skills` symlinks and the `.claude/agents` wardens. Empty means valid.
 * Checks: frontmatter `name` equals the dir and `description` is set; backticked repo paths exist;
 * `bun run repo <cmd>` names a registered command (needs `commandNames`); shell-fenced lines pass the hook rules
 * (no piped `bun test`, scripted edits, `cd <abs> &&`, recursive repo grep); AGENTS.md index matches the dirs
 * (tolerated gaps live in `skills.json`); `.claude/skills` symlinks resolve; every warden carries the shared paragraph.
 */
export function auditSkills(root: string, commandNames?: readonly string[], rules?: readonly HookRule[]): readonly SkillProblem[] {
  const man = loadSkillsManifest(root)
  let hookRules: readonly HookRule[] = rules ?? []
  if (rules === undefined)
    try {
      hookRules = loadRules(root)
    } catch {
      hookRules = []
    }
  const tops = topLevel(root)
  const dirs = skillDirs(root)
  const out: SkillProblem[] = []
  for (const dir of dirs) {
    const file = join(root, ".agents", "skills", dir, "SKILL.md")
    if (!existsSync(file)) {
      out.push({ skill: dir, problem: "no SKILL.md" })
      continue
    }
    const text = readFileSync(file, "utf8")
    const fm = frontmatter(text)
    if (fm === null) out.push({ skill: dir, problem: "missing or malformed frontmatter" })
    else {
      if (fm.name !== dir) out.push({ skill: dir, problem: `frontmatter name ${JSON.stringify(fm.name)} must equal dir "${dir}"` })
      if (typeof fm.description !== "string" || fm.description.trim().length === 0) out.push({ skill: dir, problem: "frontmatter description is empty" })
    }
    for (const m of pathMentions(text, tops))
      if (!existsSync(join(root, m.path)) && !gitIgnored(root, m.path))
        out.push({ skill: dir, problem: `line ${m.line}: path does not exist: ${m.path}` })
    out.push(...commandProblems(dir, text, commandNames))
    for (const l of shellLines(text)) {
      const d = classifyBash(l.text, hookRules, {}, { root })
      if (d.decision !== "allow") out.push({ skill: dir, problem: `line ${l.line}: forbidden pattern (${d.ruleId}): ${l.text.trim().slice(0, 60)}` })
    }
  }
  out.push(...indexProblems(root, dirs, man), ...symlinkProblems(root), ...wardenProblems(root, commandNames, man))
  return out
}
