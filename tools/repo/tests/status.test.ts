import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { collectStatus, renderStatus } from "../src/commands/status.ts"

const TODAY = "2026-11-03"
const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "repo-status-"))
  dirs.push(root)
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true })
    writeFileSync(join(root, p), c)
  }
  return root
}
const plan = (status: string, title: string): string => `---\nstatus: ${status}\n---\n\n# ${title}\n\nbody\n`
const AUTH = "wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md"
const authDoc = [
  "---",
  "type: spec",
  "---",
  "# Title",
  "SECRET-BODY-LINE-ONE",
  "## 1. The one goal",
  "SECRET-BODY-LINE-TWO",
  "## 4. Verified state (2026-08-12)",
  "SECRET-BODY-LINE-THREE",
  "## 7. Recent (2026-10-20)",
  "```",
  "## not a heading",
  "```",
].join("\n")

describe("collectStatus", () => {
  test("active plans counted by exact status", () => {
    const root = fixture({
      "wiki/Planning/Implementation-Plans/a.md": plan("active", "Plan A"),
      "wiki/Planning/Implementation-Plans/b.md": plan("active", "Plan B"),
      "wiki/Planning/Implementation-Plans/c.md": plan("completed", "Plan C"),
      "wiki/Planning/Implementation-Plans/d.md": plan("proposed", "Plan D"),
    })
    const r = collectStatus(root, TODAY)
    expect(r.activePlans.map((p) => p.title)).toEqual(["Plan A", "Plan B"])
    expect(r.planStatusCounts).toEqual({ completed: 1, proposed: 1 })
    expect(renderStatus(r)).toContain("plans: 2 active, 1 proposed")
  })
  test("hotUpdated from wiki/Hot.md frontmatter", () => {
    const root = fixture({ "wiki/Hot.md": "---\nupdated: 2026-11-03\n---\n# Hot\n" })
    expect(collectStatus(root, TODAY).hotUpdated).toBe("2026-11-03")
  })
  test("openDebt counts register entries not marked RESOLVED", () => {
    const root = fixture({
      "wiki/Architecture/DEBT-REGISTER.md": "# R\n### D-1 — a — OPEN\nx\n### D-2 — b — ✅ RESOLVED\n### D-3 — c — tracked\n",
    })
    expect(collectStatus(root, TODAY).openDebt).toBe(2)
  })
  test("missing or entry-less register is n/a, not a guess", () => {
    expect(collectStatus(fixture({}), TODAY).openDebt).toBeNull()
    expect(renderStatus(collectStatus(fixture({}), TODAY))).toContain("openDebt: n/a (see wiki/Architecture/DEBT-REGISTER.md)")
  })
  test("testsPassing from metrics-cache.json; null when absent", () => {
    const root = fixture({ "apps/docs/src/data/metrics-cache.json": '{"tests": 12100}' })
    expect(collectStatus(root, TODAY).testsPassing).toBe(12100)
    expect(collectStatus(fixture({}), TODAY).testsPassing).toBeNull()
  })
  test("pointer not inference: headings with line numbers, no body text", () => {
    const out = renderStatus(collectStatus(fixture({ [AUTH]: authDoc }), TODAY)).join("\n")
    expect(out).toContain(`authority: ${AUTH}`)
    expect(out).toContain("L6 ## 1. The one goal")
    expect(out).not.toContain("SECRET-BODY")
    expect(out).not.toContain("not a heading")
  })
  test("heading dated >60 days is flagged; recent one is not", () => {
    const out = renderStatus(collectStatus(fixture({ [AUTH]: authDoc }), TODAY)).join("\n")
    expect(out).toContain("## 4. Verified state (2026-08-12) (dated 2026-08-12 — confirm before relying)")
    expect(out).toContain("## 7. Recent (2026-10-20)")
    expect(out).not.toContain("(dated 2026-10-20")
  })
  test("3 overrides of one rule flag it; 2 do not", () => {
    const line = (id: string): string => JSON.stringify({ ruleId: id, reason: "r" })
    const root = fixture({ ".repo-logs/overrides.jsonl": [line("no-cd-prefix"), line("no-cd-prefix"), line("no-cd-prefix"), line("other"), line("other"), "{torn"].join("\n") })
    const out = renderStatus(collectStatus(root, TODAY)).join("\n")
    expect(out).toContain("rule no-cd-prefix may be wrong — review tools/repo/rules.json")
    expect(out).not.toContain("rule other")
  })
  test("expired rule listed under `expired rules:`", () => {
    const root = fixture({
      "tools/repo/rules.json": JSON.stringify({ schemaVersion: 1, rules: [{ id: "old", reviewBy: "2026-10-01" }, { id: "fresh", reviewBy: "2027-01-01" }] }),
    })
    const r = collectStatus(root, TODAY)
    expect(r.expiredRules).toEqual(["rules.json:old"])
    expect(renderStatus(r).join("\n")).toContain("expired rules: rules.json:old")
  })
  test("deterministic: same inputs, same output; <=40 lines; first line answers; next: last", () => {
    const root = fixture({ [AUTH]: authDoc, "wiki/Hot.md": "---\nupdated: 2026-11-03\n---\n" })
    const a = renderStatus(collectStatus(root, TODAY))
    expect(renderStatus(collectStatus(root, TODAY))).toEqual(a)
    expect(a.length).toBeLessThanOrEqual(40)
    expect(a[0]).toMatch(/^branch .+ \| 0 active plans \| debt n\/a \| hot 2026-11-03 \| \d+ dirty$/)
    expect(a[a.length - 1]).toBe("next: bun run repo scope")
  })
})

describe("repo status", () => {
  test("real repo: exit 0, <=40 lines, next: last", async () => {
    let out = ""
    const s: Streams = { stdout: (t) => void (out += t), stderr: () => undefined }
    expect(await main(["status"], s)).toBe(0)
    const lines = out.trimEnd().split("\n")
    expect(lines.length).toBeLessThanOrEqual(40)
    expect(lines[lines.length - 1]).toBe("next: bun run repo scope")
  })
})
