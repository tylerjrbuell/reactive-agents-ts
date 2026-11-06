// Run: bun test packages/benchmarks/tests/h3-harness-flags.test.ts --timeout 15000
// `run-h3 --harness <flag>` arms any suite (it used to need --suite long-horizon,
// so the 2f re-ablation on h3-todo-heavy needed a hand-written driver, 2026-11-06).
import { describe, expect, it } from "bun:test"
import { H3_VARIANT, runH3, withHarnessFlags } from "../src/h3/run-h3.js"

describe("run-h3 harness-flag arms", () => {
  it("switches the flag on in config.harness and gives the arm its own id", () => {
    const v = withHarnessFlags(H3_VARIANT, ["loopProgressAware"])
    expect(v.id).toBe("ra-default+loopProgressAware")
    expect(v.type === "internal" ? v.config.harness : undefined).toEqual({ loopProgressAware: true })
    expect(v.type === "internal" ? v.config.tools : undefined).toBe(true)
  })

  it("no flags leaves the variant untouched (same object)", () => {
    expect(withHarnessFlags(H3_VARIANT, [])).toBe(H3_VARIANT)
  })

  it("rejects an unknown flag before running anything", async () => {
    const r = await runH3({ out: "/tmp/x.json", traceRoot: "/tmp/x", tiers: ["qwen3:4b"], k: 1, budgetSec: 1, cellTimeoutSec: 1, harnessFlags: ["notAFlag"] })
    expect(r.ran).toBe(0)
    expect(r.error).toContain("unknown --harness flag notAFlag")
  })
})
