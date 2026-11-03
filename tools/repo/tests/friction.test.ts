import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { preBash, preWrite } from "../src/commands/hook.ts"
import { measureSessions } from "../src/commands/session-stats.ts"
import { collectStatus, renderStatus } from "../src/commands/status.ts"
import { budgetProblem, MAX_CHARS, MAX_LINES } from "../src/lib/friction.ts"
import { builtins } from "../src/lib/builtins.ts"
import { loadRules, renderRuleText, ruleProblems, type HookRule } from "../src/lib/hook-rules.ts"
import { loadChecks } from "../src/lib/manifest.ts"
import { loadPlacement, placeFile, placementProblems, renderPlacementText, type PlacementRule } from "../src/lib/placement.ts"
import { mirrorRepo, REPO_ROOT as REPO } from "./mirror.ts"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "repo-friction-"))
  dirs.push(d)
  return d
}
const bashPayload = (command: string): string => JSON.stringify({ tool_input: { command } })
const writePayload = (file_path: string): string => JSON.stringify({ tool_input: { file_path } })
const PIPED = "bun test packages/x | tail"
const log = (root: string, file: string): Record<string, unknown>[] =>
  existsSync(join(root, ".repo-logs", file))
    ? readFileSync(join(root, ".repo-logs", file), "utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>)
    : []

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = ""
  let err = ""
  const s: Streams = { stdout: (t) => void (out += t), stderr: (t) => void (err += t) }
  const code = await main(args, s)
  return { code, out, err }
}

describe("kill switch REPO_HOOKS=off", () => {
  test("pre-bash allows a denied command silently and logs it", () => {
    const r = mirrorRepo()
    expect(preBash(r, bashPayload(PIPED), {})).toBeDefined()
    const r2 = mirrorRepo()
    expect(preBash(r2, bashPayload(PIPED), { REPO_HOOKS: "off" })).toBeUndefined()
    expect(log(r2, "denies.jsonl")).toEqual([])
    expect(log(r2, "overrides.jsonl")[0]).toMatchObject({ hook: "pre-bash", reason: "REPO_HOOKS=off" })
  })
  test("pre-write allows a denied path silently and logs it", () => {
    const r = mirrorRepo()
    expect(preWrite(r, writePayload("docs/x.md"), { REPO_HOOKS: "off" })).toBeUndefined()
    expect(log(r, "overrides.jsonl")[0]).toMatchObject({ hook: "pre-write", reason: "REPO_HOOKS=off" })
    expect(preWrite(r, writePayload("docs/x.md"), { REPO_HOOKS: "on" })).toBeDefined()
  })
})

describe("mode: warn | deny", () => {
  const rule = (extra: object): string =>
    JSON.stringify({
      schemaVersion: 1,
      rules: [
        {
          id: "r1", match: { command: "forbidden" }, reason: "No forbidden.", alternative: "use `allowed`", owner: "t", reviewBy: "2027-02-03",
          examples: { deny: ["forbidden a", "forbidden b"], allow: ["fine a", "fine b"] }, ...extra,
        },
      ],
    })
  const rootWith = (json: string): string => {
    const r = tmp()
    mkdirSync(join(r, "tools", "repo"), { recursive: true })
    writeFileSync(join(r, "tools", "repo", "rules.json"), json)
    return r
  }
  test("hook rule: mode defaults to deny", () => {
    const r = rootWith(rule({}))
    expect(loadRules(r)[0]?.mode).toBe("deny")
    const doc = JSON.parse(preBash(r, bashPayload("forbidden x"), {}) as string) as { hookSpecificOutput: Record<string, string> }
    expect(doc.hookSpecificOutput.permissionDecision).toBe("deny")
  })
  test("hook rule: warn emits additionalContext with the same text, never denies", () => {
    const r = rootWith(rule({ mode: "warn" }))
    const doc = JSON.parse(preBash(r, bashPayload("forbidden x"), {}) as string) as { hookSpecificOutput: Record<string, string> }
    expect(doc.hookSpecificOutput.permissionDecision).toBeUndefined()
    const text = doc.hookSpecificOutput.additionalContext ?? ""
    expect(text).toContain("No forbidden.")
    expect(text).toContain("use `allowed`")
    expect(text).toContain("[source: tools/repo/rules.json#r1]")
    expect(log(r, "denies.jsonl")[0]).toMatchObject({ hook: "pre-bash", ruleId: "r1", mode: "warn", target: "forbidden x" })
    expect(preBash(r, bashPayload("fine"), {})).toBeUndefined()
  })
  test("any other mode fails manifest load", () => {
    expect(() => loadRules(rootWith(rule({ mode: "block" })))).toThrow(/mode/)
    const r = mirrorRepo()
    const doc = JSON.parse(readFileSync(join(r, "tools", "repo", "placement.json"), "utf8")) as { rules: object[] }
    writeFileSync(join(r, "tools", "repo", "placement.json"), JSON.stringify({ ...doc, rules: [{ ...doc.rules[0], mode: "maybe" }] }))
    expect(() => loadPlacement(r)).toThrow(/mode/)
  })
  test("placement warn: allows with additionalContext; deny-mode rules still block", () => {
    const r = mirrorRepo()
    const warn = JSON.parse(preWrite(r, writePayload("note.md"), {}) as string) as { hookSpecificOutput: Record<string, string> }
    expect(warn.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(warn.hookSpecificOutput.additionalContext).toContain("[source: tools/repo/placement.json#no-stray-artifacts]")
    const deny = JSON.parse(preWrite(r, writePayload("docs/x.md"), {}) as string) as { hookSpecificOutput: Record<string, string> }
    expect(deny.hookSpecificOutput.permissionDecision).toBe("deny")
    expect(log(r, "denies.jsonl").map((e) => `${String(e.ruleId)}:${String(e.mode)}`)).toEqual(["no-stray-artifacts:warn", "no-docs-dir:deny"])
  })
  test("warn text omits the override / place --allow hint; placement warn ends with the CI note", () => {
    const hook = loadRules(REPO).find((x) => x.id === "no-cd-prefix") as HookRule
    expect(renderRuleText(hook)).not.toContain("REPO_ALLOW")
    const p = loadPlacement(REPO).rules.find((x) => x.id === "no-stray-artifacts") as PlacementRule
    const text = renderPlacementText(p, "note.md")
    expect(text).toContain("CI placement check will fail until this moves")
    expect(text).not.toContain("place --allow")
    expect(budgetProblem(text)).toBeUndefined()
  })
  test("placement: a deny rule listed after a warn rule wins for the same path", () => {
    const base = loadPlacement(REPO).rules[0] as PlacementRule
    const warnRule: PlacementRule = { ...base, id: "w", mode: "warn", deny: ["x.txt"], allow: [], scope: undefined, exempt: undefined }
    const denyRule: PlacementRule = { ...warnRule, id: "d", mode: "deny" }
    expect(placeFile("x.txt", [warnRule, denyRule])).toMatchObject({ ok: false, ruleId: "d", mode: "deny" })
    expect(placeFile("x.txt", [warnRule])).toMatchObject({ ok: false, ruleId: "w", mode: "warn" })
  })
  test("shipped modes: no-cd-prefix is the only warn hook rule; the four broad placement rules warn", () => {
    expect(loadRules(REPO).filter((x) => x.mode === "warn").map((x) => x.id)).toEqual(["no-cd-prefix"])
    const warn = loadPlacement(REPO).rules.filter((x) => x.mode === "warn").map((x) => x.id).sort()
    expect(warn).toEqual(["no-stray-artifacts", "root-allowlist", "scripts-only", "tests-beside-code"])
  })
})

describe("message budget", () => {
  const hookRule = loadRules(REPO)[0] as HookRule
  test("every shipped hook and placement message fits and names a fix", () => {
    expect(ruleProblems(loadRules(REPO))).toEqual([])
    expect(placementProblems(loadPlacement(REPO).rules)).toEqual([])
    for (const r of loadRules(REPO)) {
      expect(budgetProblem(renderRuleText(r))).toBeUndefined()
      expect(r.alternative).toMatch(/`[^`]+`/)
    }
  })
  test("budgetProblem enforces 4 lines and 400 chars", () => {
    expect(budgetProblem("a\nb\nc\nd")).toBeUndefined()
    expect(budgetProblem("a\nb\nc\nd\ne")).toContain(`max ${MAX_LINES}`)
    expect(budgetProblem("x".repeat(MAX_CHARS + 1))).toContain(`max ${MAX_CHARS}`)
  })
  test("rules-valid rejects a long message, an empty alternative and a command-less alternative", () => {
    expect(ruleProblems([{ ...hookRule, reason: "x".repeat(450) }]).some((p) => p.message.includes("rendered message"))).toBe(true)
    expect(ruleProblems([{ ...hookRule, reason: "a\nb\nc\nd" }]).some((p) => p.message.includes("rendered message"))).toBe(true)
    expect(ruleProblems([{ ...hookRule, alternative: "" }]).some((p) => p.message.includes("alternative"))).toBe(true)
    expect(ruleProblems([{ ...hookRule, alternative: "be careful" }]).some((p) => p.message.includes("alternative"))).toBe(true)
    const r = tmp()
    mkdirSync(join(r, "tools", "repo"), { recursive: true })
    writeFileSync(
      join(r, "tools", "repo", "rules.json"),
      JSON.stringify({ schemaVersion: 1, rules: [{ ...hookRule, alternative: "be careful" }] }),
    )
    const check = builtins["rules-valid"]
    const res = check?.(r, loadChecks(REPO)[0] as never, { today: "2026-11-03", commandNames: [] })
    expect(res?.ok).toBe(false)
  })
  test("placement self-check rejects a long message and a multi-line nextHint", () => {
    const rule = loadPlacement(REPO).rules[0] as PlacementRule
    expect(placementProblems([{ ...rule, canonical: "y".repeat(450) }]).some((p) => p.message.includes("rendered message"))).toBe(true)
    expect(placementProblems([{ ...rule, nextHint: "a\nb" }]).some((p) => p.message.includes("nextHint"))).toBe(true)
  })
  test("hook deny text for every placement rule fits 4 lines / 400 chars", () => {
    for (const r of loadPlacement(REPO).rules) {
      const longest = [...r.examples.bad].sort((a, b) => b.length - a.length)[0] as string
      expect(budgetProblem(renderPlacementText(r, longest))).toBeUndefined()
    }
  })
  test("`repo place` failure output: <=4 lines, one concrete next: last, per rule", async () => {
    for (const r of loadPlacement(REPO).rules) {
      const bad = r.examples.bad[0] as string
      const res = await cli(["place", bad, "--root", REPO])
      expect(res.code).toBe(1)
      const lines = (res.out + res.err).split("\n").filter((l) => l.length > 0)
      expect(lines.length).toBeLessThanOrEqual(MAX_LINES)
      expect((res.out + res.err).length).toBeLessThanOrEqual(MAX_CHARS + 100)
      const nexts = lines.filter((l) => l.startsWith("next: "))
      expect(nexts).toHaveLength(1)
      expect(lines[lines.length - 1]).toBe(nexts[0] as string)
      expect(nexts[0]).not.toContain("\n")
      expect((nexts[0] as string).length).toBeLessThan(170)
    }
  })
})

describe("latency budgets (REPO_BUDGET_FACTOR multiplies every budget; default 1)", () => {
  const factor = Number(process.env.REPO_BUDGET_FACTOR ?? "1") || 1
  const cli_ = ["tools/repo/src/cli.ts"]
  function timed(args: string[], input?: string): { ms: number; status: number | null } {
    const t = performance.now()
    const r = spawnSync("bun", [...cli_, ...args], { cwd: REPO, input: input ?? "", encoding: "utf8" })
    return { ms: performance.now() - t, status: r.status }
  }
  test("hook pre-bash and pre-write < 300 ms", () => {
    const b = timed(["hook", "pre-bash"], bashPayload("git status"))
    const w = timed(["hook", "pre-write"], writePayload(join(REPO, "README.md")))
    expect(b.status).toBe(0)
    expect(w.status).toBe(0)
    expect(b.ms).toBeLessThan(300 * factor)
    expect(w.ms).toBeLessThan(300 * factor)
  })
  test("scope, place, find < 1.5 s", () => {
    for (const args of [["scope", "README.md"], ["place", "README.md"], ["find", "classifyBash", "--code"]]) {
      const r = timed(args)
      expect(r.status).toBe(0)
      expect(r.ms).toBeLessThan(1500 * factor)
    }
  })
})

describe("pre-commit budget", () => {
  const factor = Number(process.env.REPO_BUDGET_FACTOR ?? "1") || 1
  const run = (args: string[]): number => {
    const t = performance.now()
    spawnSync("bun", ["tools/repo/src/cli.ts", ...args], { cwd: REPO, encoding: "utf8" })
    return performance.now() - t
  }
  test("`check --changed --stage pre-commit` < 1 s", () => {
    expect(run(["check", "--changed", "--stage", "pre-commit"])).toBeLessThan(1000 * factor)
  })
  // TODO(Task 12): that task marks checks with stage "pre-commit"; until then this loop is vacuous.
  test("every check marked pre-commit runs in <= 1 s (vacuous while none is marked)", () => {
    const marked = loadChecks(REPO).filter((e) => e.stages.includes("pre-commit"))
    if (marked.length > 0) expect(marked.length).toBeGreaterThanOrEqual(1)
    for (const c of marked) expect(run(["check", "--only", c.id, "--stage", "pre-commit"])).toBeLessThanOrEqual(1000 * factor)
  })
})

describe("friction metrics", () => {
  const turn = (...blocks: object[]): string => JSON.stringify({ type: "assistant", message: { role: "assistant", content: blocks } })
  const denied = (id: string, rule: string): string =>
    JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `x\n[source: tools/repo/rules.json#${rule}]` }] },
    })
  function sessions(perSession: readonly (readonly string[])[]): { dir: string; paths: string[] } {
    const dir = tmp()
    const paths = perSession.map((rules, i) => {
      const p = join(dir, `s${i}.jsonl`)
      writeFileSync(p, [turn({ type: "text", text: "hi" }), ...rules.map((r, j) => denied(`d${i}-${j}`, r))].join("\n"))
      return p
    })
    return { dir, paths }
  }
  test("3 denies of one rule in one session -> repeatedDenies; spread over sessions does not", () => {
    expect(measureSessions(sessions([["no-cd-prefix", "no-cd-prefix", "no-cd-prefix"]]).paths).repeatedDenies).toEqual({ "no-cd-prefix": 3 })
    expect(measureSessions(sessions([["no-cd-prefix", "no-cd-prefix"], ["no-cd-prefix", "no-cd-prefix"]]).paths).repeatedDenies).toEqual({})
  })
  test("breach prints the friction line and exits 1 only under --since", async () => {
    const { dir } = sessions([["no-cd-prefix", "no-cd-prefix", "no-cd-prefix"], [], []])
    const root = tmp()
    const base = ["session-stats", "--dir", dir, "--root", root]
    const without = await cli(base)
    expect(without.code).toBe(0)
    expect(without.out).not.toContain("friction:")
    const withSince = await cli([...base, "--since", "2000-01-01"])
    expect(withSince.out).toContain("friction: rule no-cd-prefix denied 3× — fix or relax the rule (tools/repo/rules.json#no-cd-prefix)")
    expect(withSince.code).toBe(1)
    expect(withSince.out).toContain("FAIL repeated-denies")
  })
  test("unparseable deny markers are not actionable: no friction line, no failed check, counted in --json", async () => {
    const dir = tmp()
    for (const n of ["a", "b", "c"]) {
      const body = Array.from({ length: n === "a" ? 4 : 0 }, (_, j) => denied(`u${j}`, "x").replace("rules.json#x]", "rules.json#]")).join("\n")
      writeFileSync(join(dir, `${n}.jsonl`), [turn({ type: "text", text: "hi" }), body].join("\n"))
    }
    const r = await cli(["session-stats", "--dir", dir, "--root", tmp(), "--since", "2000-01-01", "--json"])
    const doc = JSON.parse(r.out) as { unparsedDenies: number; metrics: { repeatedDenies: object } }
    expect(doc.unparsedDenies).toBe(4)
    expect(doc.metrics.repeatedDenies).toEqual({})
    expect((await cli(["session-stats", "--dir", dir, "--root", tmp(), "--since", "2000-01-01"])).out).not.toContain("friction:")
  })
  test("hook denies <=5 per session; warns counted from denies.jsonl", async () => {
    const { dir } = sessions([["a", "b", "c", "d", "e", "f"], [], []])
    const root = tmp()
    mkdirSync(join(root, ".repo-logs"), { recursive: true })
    writeFileSync(
      join(root, ".repo-logs", "denies.jsonl"),
      [{ mode: "warn" }, { mode: "deny" }, { mode: "warn" }].map((e) => JSON.stringify({ ts: new Date().toISOString(), ...e })).join("\n"),
    )
    const r = await cli(["session-stats", "--dir", dir, "--root", root, "--since", "2000-01-01", "--json"])
    const doc = JSON.parse(r.out) as { metrics: { warns: number }; checks: { id: string; ok: boolean }[] }
    expect(doc.metrics.warns).toBe(2)
    expect(doc.checks.find((c) => c.id === "hook-denies")?.ok).toBe(true)
    const heavy = sessions([["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"], [], []])
    const r2 = await cli(["session-stats", "--dir", heavy.dir, "--root", root, "--since", "2000-01-01", "--json"])
    expect((JSON.parse(r2.out) as { checks: { id: string; ok: boolean }[] }).checks.find((c) => c.id === "hook-denies")?.ok).toBe(false)
  })
})

describe("pruning signal in repo status", () => {
  const entry = (ts: string, ruleId: string): string => JSON.stringify({ ts, hook: "pre-bash", ruleId, mode: "deny", target: "x" })
  function rootWithLog(lines: string[]): string {
    const r = mirrorRepo()
    mkdirSync(join(r, ".repo-logs"), { recursive: true })
    writeFileSync(join(r, ".repo-logs", "denies.jsonl"), lines.join("\n"))
    return r
  }
  test("lists rules that never fired in 30d once the log spans >=7 days", () => {
    const r = rootWithLog([entry("2026-10-01T00:00:00Z", "no-cd-prefix"), entry("2026-10-25T00:00:00Z", "no-piped-test")])
    const s = collectStatus(r, "2026-11-03")
    expect(s.quietRules).not.toContain("no-piped-test")
    expect(s.quietRules).toContain("no-scripted-edit")
    expect(s.quietRules).toContain("no-docs-dir")
    expect(renderStatus(s).join("\n")).toContain("rules with 0 denies in 30d (removal candidates): ")
  })
  test("silent when the log is younger than 7 days or absent", () => {
    expect(collectStatus(rootWithLog([entry("2026-11-01T00:00:00Z", "no-cd-prefix")]), "2026-11-03").quietRules).toEqual([])
    expect(collectStatus(mirrorRepo(), "2026-11-03").quietRules).toEqual([])
    expect(renderStatus(collectStatus(mirrorRepo(), "2026-11-03")).join("\n")).not.toContain("removal candidates")
  })
  test("lists rules overridden >=3x", () => {
    const r = mirrorRepo()
    mkdirSync(join(r, ".repo-logs"), { recursive: true })
    const o = (id: string): string => JSON.stringify({ ts: "2026-11-02T00:00:00Z", ruleId: id, reason: "x" })
    writeFileSync(join(r, ".repo-logs", "overrides.jsonl"), [o("no-cd-prefix"), o("no-cd-prefix"), o("no-cd-prefix"), o("no-piped-test")].join("\n"))
    const s = collectStatus(r, "2026-11-03")
    expect(s.overriddenRules).toEqual(["no-cd-prefix"])
    expect(renderStatus(s).join("\n")).toContain("rule no-cd-prefix may be wrong — review tools/repo/rules.json (3 overrides)")
    expect(renderStatus(s).join("\n")).not.toContain("rules overridden")
    expect(renderStatus(s).length).toBeLessThanOrEqual(40)
  })
})
