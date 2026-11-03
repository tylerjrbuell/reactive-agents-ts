import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { preBash } from "../src/commands/hook.ts"
import { classifyBash, loadRules, ruleProblems } from "../src/lib/hook-rules.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const rules = loadRules(REPO)
const cmdPiped = "bun test a | tail"
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function reasonOf(cmd: string, env: Record<string, string> = {}): string {
  const v = classifyBash(cmd, rules, env)
  if (v.decision !== "deny") throw new Error(`expected deny: ${cmd}`)
  return v.reason
}
const allowed = (cmd: string): boolean => classifyBash(cmd, rules, {}).decision === "allow"

function root(rulesJson: string | undefined, checks = false): string {
  const r = mkdtempSync(join(tmpdir(), "repo-hook-"))
  dirs.push(r)
  mkdirSync(join(r, "tools", "repo"), { recursive: true })
  if (rulesJson !== undefined) writeFileSync(join(r, "tools", "repo", "rules.json"), rulesJson)
  if (checks)
    writeFileSync(
      join(r, "tools", "repo", "checks.json"),
      JSON.stringify({
        schemaVersion: 1,
        checks: [{ id: "rules-valid", script: "builtin:rules-valid", scope: ["**"], stages: ["ci"], owner: "t", reviewBy: "2027-02-03" }],
      }),
    )
  return r
}
const payload = (command: string): string => JSON.stringify({ tool_input: { command } })

describe("rules", () => {
  test("denies with alternatives", () => {
    expect(reasonOf("timeout 590 bun test packages/x 2>&1 | tail -5")).toContain("bun run repo test packages/x")
    expect(reasonOf("python3 - <<'EOF'\nx = s.replace('a','b')\nEOF")).toContain("use the Edit tool")
    expect(reasonOf("sed -i 's/a/b/' packages/core/src/x.ts")).toContain("use the Edit tool")
    expect(reasonOf("cd /home/u/repo && git status")).toContain("absolute paths")
  })
  test("allows look-alikes", () => {
    for (const c of [
      'echo "bun test | grep"',
      'git commit -m "fix: python3 - replace"',
      "cat <<'EOF' > notes.txt\nsed -i\nEOF",
      "bun test packages/x --timeout 15000",
      "sed -n '1,5p' file",
      "git diff | head",
      "(cd /a && ls)",
      "cd /a",
      'git commit -m "$(cat <<\'EOF\'\nuse sed -i\nEOF\n)"',
    ])
      expect(allowed(c)).toBe(true)
  })
  test("every deny reason ends with its source", () => {
    for (const r of rules) for (const d of r.examples.deny) expect(reasonOf(d).endsWith(`[source: tools/repo/rules.json#${r.id}]`)).toBe(true)
  })
  test("rules verify themselves", () => {
    expect(ruleProblems(rules)).toEqual([])
    const bad = [{ ...(rules[0] as (typeof rules)[number]), examples: { allow: ["ls"], deny: [] } }]
    expect(ruleProblems(bad)[0]?.next).toBe(`add examples to tools/repo/rules.json#${rules[0]?.id}`)
  })
  test("2,000-char command classifies in <5 ms", () => {
    const cmd = `echo ${"abc 'q' ".repeat(250)}`.slice(0, 2000)
    classifyBash(cmd, rules, {})
    const t = performance.now()
    classifyBash(cmd, rules, {})
    expect(performance.now() - t).toBeLessThan(5)
  })
})

describe("regressions", () => {
  test("heredoc to filename ending in .sh/.py is not executed", () => {
    for (const body of ["cd /x && ls", "bun test a | tail", "sed -i s/a/b/ f"])
      for (const open of ["cat > f.sh <<'EOF'", "tee run.sh <<EOF", "cat > x.py <<'EOF'"])
        expect(allowed(`${open}\n${body}\nEOF`)).toBe(true)
  })
  test("executed heredocs still count", () => {
    expect(allowed("bash <<EOF\nsed -i s/a/b/ f\nEOF")).toBe(false)
    expect(allowed("cat x | python3 -\nfoo")).toBe(true)
    expect(allowed("timeout 5 python3 - <<EOF\ns.replace('a','b')\nEOF")).toBe(false)
  })
  test("comments are stripped, # elsewhere is not a comment", () => {
    for (const c of ["# bun test | tail", "echo foo # sed -i", "ls\n# cd /x && ls", "echo a#b | wc"]) expect(allowed(c)).toBe(true)
    expect(allowed("echo ${#x} $# | wc; sed -i s/a/b/ f")).toBe(false)
    expect(allowed("echo a#b; bun test x | tail")).toBe(false)
  })
  test("nested quotes inside $() inside double quotes", () => {
    for (const c of [
      'echo "$(echo "bun test | tail")"',
      'git commit -m "$(printf "%s" "see bun test | tail")"',
    ])
      expect(allowed(c)).toBe(true)
    expect(allowed('echo "$(echo "x")" && bun test a | tail')).toBe(false)
  })
  test("perl and awk in-place edits", () => {
    for (const c of ["perl -pi -e 's/a/b/' f", "perl -i f", "perl -pi.bak -e 'x' f", "awk -i inplace '{print}' f"])
      expect(allowed(c)).toBe(false)
    for (const c of ["perl -ne 'print' f", "perl script.pl"]) expect(allowed(c)).toBe(true)
  })
  test("other piped test runners", () => {
    for (const c of ["bun run test | tail", "npm test | tail", "npm run test | tail", "pnpm test | tail", "yarn test | tail"])
      expect(allowed(c)).toBe(false)
    for (const c of ["bun run repo test x", "ls | wc -l", "git log | head", "bun test --help | head", "bun test --version | head"])
      expect(allowed(c)).toBe(true)
  })
  test("alternative lists up to 3 paths", () => {
    expect(reasonOf("bun test a b c d | tail")).toContain("bun run repo test a b c ")
    expect(reasonOf("bun test a b | tail")).toContain("bun run repo test a b ")
  })
})

describe("override", () => {
  test("env with reason allows and logs", () => {
    const r = root(readFileSync(join(REPO, "tools/repo/rules.json"), "utf8"))
    expect(preBash(r, payload(cmdPiped), { REPO_ALLOW: "no-piped-test", REPO_ALLOW_REASON: "x" })).toBeUndefined()
    const line = JSON.parse(readFileSync(join(r, ".repo-logs", "overrides.jsonl"), "utf8").trim()) as Record<string, string>
    expect(line.ruleId).toBe("no-piped-test")
    expect(line.reason).toBe("x")
    expect(line.command).toBe(cmdPiped)
    expect(typeof line.ts).toBe("string")
  })
  test("command-prefix form works", () => {
    expect(classifyBash('REPO_ALLOW=no-cd-prefix REPO_ALLOW_REASON="why not" cd /a && ls', rules, {}).decision).toBe("allow")
    expect(classifyBash("FOO=1 cd /a && ls", rules, {}).decision).toBe("deny")
  })
  test("no reason still denies and says how to override", () => {
    expect(classifyBash(cmdPiped, rules, { REPO_ALLOW: "no-piped-test" }).decision).toBe("deny")
    expect(reasonOf(cmdPiped)).toContain("REPO_ALLOW=no-piped-test REPO_ALLOW_REASON=")
  })
})

describe("fail open / closed", () => {
  test("malformed rules.json: hook allows and logs; check --all exits 1", async () => {
    const r = root("{ not json", true)
    expect(preBash(r, payload(cmdPiped), {})).toBeUndefined()
    expect(existsSync(join(r, ".repo-logs", "hook-errors.jsonl"))).toBe(true)
    let err = ""
    const s: Streams = { stdout: () => undefined, stderr: (t) => void (err += t) }
    expect(await main(["check", "--all", "--root", r], s)).toBe(1)
    expect(err).toContain("rules-valid")
  })
  test("garbage stdin allows", () => {
    expect(preBash(root(undefined), "garbage", {})).toBeUndefined()
  })
  test("deny JSON shape", () => {
    const out = preBash(REPO, payload(cmdPiped), {})
    const doc = JSON.parse(out as string) as { hookSpecificOutput: Record<string, string> }
    expect(doc.hookSpecificOutput.hookEventName).toBe("PreToolUse")
    expect(doc.hookSpecificOutput.permissionDecision).toBe("deny")
    expect(doc.hookSpecificOutput.permissionDecisionReason).toContain("[source: tools/repo/rules.json#no-piped-test]")
  })
})
