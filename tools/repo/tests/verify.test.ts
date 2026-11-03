import { describe, expect, test } from "bun:test"
import { main, type Streams } from "../src/cli.ts"
import { planVerify } from "../src/commands/verify.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return { s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) }, out: () => o, err: () => e }
}
const e = (id: string, script: string, scope: string[]): CheckEntry => ({
  id, script, scope, stages: ["ci"], owner: "t", reviewBy: "2027-02-03",
})

describe("planVerify", () => {
  test("orders test, typecheck, matching shell gates only", () => {
    const plan = planVerify("packages/tools", [
      e("a", "scripts/check-a.sh", ["packages/tools/**"]),
      e("b", "scripts/check-b.sh", ["packages/reasoning/**"]),
      e("c", "builtin:x", ["**"]),
    ])
    expect(plan).toEqual([
      "bun run repo test packages/tools",
      "bun run --cwd packages/tools typecheck",
      "bash scripts/check-a.sh",
    ])
  })
})

describe("repo verify", () => {
  test("unknown dir exits 2", async () => {
    const c = capture()
    expect(await main(["verify", "no/such/dir"], c.s)).toBe(2)
    expect(c.err().trimEnd().split("\n").at(-1)).toBe("next: bun run repo verify <pkg-dir>")
  })
  test("--dry-run prints plan without running", async () => {
    const c = capture()
    expect(await main(["verify", "tools/repo", "--dry-run"], c.s)).toBe(0)
    expect(c.out().split("\n")[0]).toBe("bun run repo test tools/repo")
    expect(c.out()).toContain("bun run --cwd tools/repo typecheck")
  })
  test("unknown flag exits 2", async () => {
    const c = capture()
    expect(await main(["verify", "tools/repo", "--bogus"], c.s)).toBe(2)
  })
})
