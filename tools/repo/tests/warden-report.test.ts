import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { checkUpwardReport, guidance } from "../src/commands/warden-report.ts"
import { splitArgs } from "../src/lib/args.ts"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const report = (fields: string): string => `prose before\n\n\`\`\`yaml\nupward-report:\n${fields
  .split("\n")
  .map((l) => `  ${l}`)
  .join("\n")}\n\`\`\`\n`
const VERIFIED = 'verification:\n  - "bun run repo verify packages/x -> pass"\n'
const base = (status: string, confidence: number, extra = ""): string =>
  report(`status: ${status}\nconfidence: ${confidence}\nescalation-required: false\n${VERIFIED}${extra}`.trimEnd())

describe("checkUpwardReport FSM", () => {
  test("completed 0.8 -> verify", () => {
    expect(checkUpwardReport(base("completed", 0.8), 0)).toEqual({ valid: true, errors: [], next: "verify" })
  })
  test("completed 0.5 -> verify-with-ablation", () => {
    expect(checkUpwardReport(base("completed", 0.5), 0).next).toBe("verify-with-ablation")
  })
  test("completed exactly 0.7 -> verify", () => {
    expect(checkUpwardReport(base("completed", 0.7), 0).next).toBe("verify")
  })
  test("failed + blockers + retries 1 -> redispatch", () => {
    expect(checkUpwardReport(base("failed", 0.3, "blockers:\n  - src/x.ts:4 type error"), 1).next).toBe("redispatch")
  })
  test("failed + retries 0 -> escalate", () => {
    expect(checkUpwardReport(base("failed", 0.3, "blockers:\n  - src/x.ts:4 type error"), 0).next).toBe("escalate")
  })
  test("failed without blockers -> escalate even with retries", () => {
    expect(checkUpwardReport(base("failed", 0.3), 2).next).toBe("escalate")
  })
  test("failed with escalation-required -> escalate even with retries", () => {
    const t = report("status: failed\nconfidence: 0.2\nblockers:\n  - b\nescalation-required: true\nescalation-reason: needs authority")
    expect(checkUpwardReport(t, 2).next).toBe("escalate")
  })
  test("denied-by-authority -> reroute to the owning warden", () => {
    expect(checkUpwardReport(base("denied-by-authority", 0.9), 3)).toEqual({ valid: true, errors: [], next: "reroute" })
  })
  test("denied-by-authority + escalation-required -> escalate", () => {
    const t = report("status: denied-by-authority\nconfidence: 0.9\nescalation-required: true\nescalation-reason: no owner for apps/x")
    expect(checkUpwardReport(t, 3).next).toBe("escalate")
  })
  test("blocked -> surface-blocker", () => {
    expect(checkUpwardReport(base("blocked", 0.9), 3).next).toBe("surface-blocker")
  })
  test("needs-approval + planned-actions -> gate", () => {
    const r = checkUpwardReport(base("needs-approval", 0.8, "planned-actions:\n  - delete src/old.ts"), 1)
    expect(r.next).toBe("gate")
    expect(r.pendingActions).toBe(1)
  })
  test("needs-approval without planned-actions -> invalid", () => {
    expect(checkUpwardReport(base("needs-approval", 0.8), 1).errors).toContain("needs-approval requires planned-actions")
  })
})

describe("contract v2: confidence tied to verification", () => {
  const unverified = (c: number): string => report(`status: completed\nconfidence: ${c}\nescalation-required: false`)
  test("completed >= 0.7 without verification -> invalid", () => {
    const r = checkUpwardReport(unverified(0.9), 0)
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain("requires verification")
  })
  test("completed < 0.7 without verification is honest -> verify-with-ablation", () => {
    expect(checkUpwardReport(unverified(0.5), 0).next).toBe("verify-with-ablation")
  })
  test("verification of only `none` counts as empty", () => {
    const t = report('status: completed\nconfidence: 0.9\nescalation-required: false\nverification:\n  - none')
    expect(checkUpwardReport(t, 0).valid).toBe(false)
  })
})

describe("checkUpwardReport validation", () => {
  test("no upward-report key -> invalid, escalate", () => {
    const r = checkUpwardReport("just prose, no report", 1)
    expect(r.valid).toBe(false)
    expect(r.next).toBe("escalate")
    expect(r.errors[0]).toContain("no `upward-report:` block")
  })
  test("confidence outside 0-1 -> invalid", () => {
    expect(checkUpwardReport(base("completed", 1.5), 0).valid).toBe(false)
    expect(checkUpwardReport(base("completed", -0.1), 0).valid).toBe(false)
  })
  test("unknown status and missing fields -> invalid with errors", () => {
    const r = checkUpwardReport(report("status: done"), 0)
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })
  test("unfilled template (status: completed | failed ...) -> invalid", () => {
    const t = report("status: completed | failed | blocked | denied-by-authority\nconfidence: 0.0-1.0\nescalation-required: true | false")
    expect(checkUpwardReport(t, 0).valid).toBe(false)
  })
  test("escalation-required true needs a reason", () => {
    expect(checkUpwardReport(report("status: failed\nconfidence: 0.2\nescalation-required: true"), 0).valid).toBe(false)
  })
  test("the LAST upward-report block wins", () => {
    const t = `${base("blocked", 0.9)}\nrevised:\n${base("completed", 0.9)}`
    expect(checkUpwardReport(t, 0).next).toBe("verify")
  })
  test("bare (unfenced, top-level) block with trailing prose parses", () => {
    const t = "text\nupward-report:\n  status: blocked\n  confidence: 0.4\n  escalation-required: false\n\nthanks\n"
    expect(checkUpwardReport(t, 0).next).toBe("surface-blocker")
  })
})

describe("escalation, approval gate, none-blockers", () => {
  const esc = (status: string): string =>
    report(`status: ${status}\nconfidence: 0.9\nescalation-required: true\nescalation-reason: need schema decision\n${VERIFIED}`.trimEnd())
  test("completed + escalation-required -> escalate, guidance names reason and defers verify", () => {
    const r = checkUpwardReport(esc("completed"), 1)
    expect(r.valid).toBe(true)
    expect(r.next).toBe("escalate")
    expect(guidance(r).pop()).toBe(
      "next: escalate — ask the user (AskUserQuestion) about: need schema decision; verify only after the user answers",
    )
  })
  test("planned actions add a gate line before next:, next action unchanged", () => {
    const r = checkUpwardReport(base("completed", 0.9, "planned-actions-pending-approval:\n  - delete file X\n  - rename API Y"), 0)
    expect(r.next).toBe("verify")
    const g = guidance(r)
    expect(g[0]).toBe("gate: 2 pending action(s) need parent approval before execution")
    expect(g[g.length - 1]).toStartWith("next: verify")
  })
  test("pending actions of only `none` add no gate", () => {
    expect(guidance(checkUpwardReport(base("completed", 0.9, "planned-actions-pending-approval:\n  - None"), 0))).toHaveLength(1)
  })
  test("blockers [\"none\"] count as empty (failed -> escalate even with retries)", () => {
    expect(checkUpwardReport(base("failed", 0.3, "blockers:\n  - None"), 2).next).toBe("escalate")
    expect(checkUpwardReport(base("failed", 0.3, "blockers:\n  - NONE\n  - real"), 2).next).toBe("redispatch")
  })
})

describe("stdin `-`", () => {
  test("splitArgs treats a lone - as a positional", () => {
    expect(splitArgs(["-", "--retries", "1"], ["--retries"])).toEqual({ positionals: ["-"], flagTokens: ["--retries", "1"] })
  })
  test("real CLI reads the report from stdin", () => {
    const cli = join(import.meta.dir, "..", "src", "cli.ts")
    const p = spawnSync("bun", [cli, "warden-report", "-"], { input: base("completed", 0.9), encoding: "utf8" })
    expect(p.status).toBe(0)
    expect(p.stdout).toContain("valid: true")
    expect(p.stdout.trimEnd().split("\n").pop()).toStartWith("next: verify")
  })
})

describe("repo warden-report", () => {
  function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = ""
    let err = ""
    const s: Streams = { stdout: (t) => void (out += t), stderr: (t) => void (err += t) }
    return main(argv, s).then((code) => ({ code, out, err }))
  }
  function file(text: string): string {
    const d = mkdtempSync(join(tmpdir(), "repo-warden-"))
    dirs.push(d)
    const p = join(d, "r.md")
    writeFileSync(p, text)
    return p
  }
  test("valid file: exit 0, `valid: true`, next: last", async () => {
    const r = await run(["warden-report", file(base("completed", 0.9))])
    expect(r.code).toBe(0)
    expect(r.out.split("\n")[0]).toBe("valid: true")
    expect(r.out.trimEnd().split("\n").pop()).toBe("next: verify — run bun run repo verify <pkg-dir> for the files in the report")
  })
  test("--retries feeds the FSM", async () => {
    const p = file(base("failed", 0.3, "blockers:\n  - b"))
    expect((await run(["warden-report", p, "--retries", "1"])).out).toContain("next: redispatch")
    expect((await run(["warden-report", p])).out).toContain("next: escalate")
  })
  test("invalid: exit 1, valid: false, errors, next: last on stderr", async () => {
    const r = await run(["warden-report", file("nothing here")])
    expect(r.code).toBe(1)
    expect(r.err).toContain("valid: false")
    expect(r.err).toContain("error: no `upward-report:` block")
    expect(r.err.trimEnd().split("\n").pop()).toStartWith("next: escalate")
  })
  test("missing file and bad args exit 2", async () => {
    expect((await run(["warden-report", "/nonexistent/x.md"])).code).toBe(2)
    expect((await run(["warden-report"])).code).toBe(2)
    expect((await run(["warden-report", "x", "--bogus"])).code).toBe(2)
    expect((await run(["warden-report", "x", "--retries", "-1"])).code).toBe(2)
  })
})
