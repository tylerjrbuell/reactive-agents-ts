// Targeted H3 verdict (src/h3/verdict.ts) + the attribution ledger entry it writes.
import { describe, expect, it } from "bun:test"
import { compareTargeted } from "../src/h3/verdict.js"
import { emptyLedger, recordAttributionOutcome } from "../src/ledger.js"
import type { H3Cell } from "../src/h3/run-h3.js"

const cell = (tier: string, taskId: string, run: number, solved: boolean, reason: string): H3Cell & { reason: string } => ({
  cellId: `${tier}|${taskId}|${run}`,
  taskId,
  variant: "ra-default",
  tier,
  run,
  accuracy: solved ? 1 : 0,
  solved,
  status: solved ? "success" : "failure",
  inconclusive: false,
  tokens: 100,
  billedTokens: 100,
  durationMs: 1000,
  iterations: 1,
  terminatedBy: "end_turn",
  causeLabel: "none",
  causeAuthority: null,
  toolSurface: [],
  traceFile: null,
  traceDir: "/tmp",
  failureModes: [],
  honestyLabel: null,
  reason,
})

const reasonOf = (c: H3Cell): string => (c as H3Cell & { reason: string }).reason
const five = (tier: string, task: string, solvedN: number, reason: string, failReason = reason) =>
  [0, 1, 2, 3, 4].map((i) => cell(tier, task, i, i < solvedN, i < solvedN ? "not-failed" : failReason))

describe("compareTargeted", () => {
  it("fixed: target goes to 0, no other harness reason rises", () => {
    const before = [...five("q", "rw-2", 0, "harness:tool-call-dropped"), ...five("q", "rw-3", 0, "model:ignored-guidance")]
    const after = five("q", "rw-2", 2, "not-failed", "model:had-evidence-wrong-output")
    const v = compareTargeted(before, after, "harness:tool-call-dropped", reasonOf)
    expect(v.decision).toBe("fixed")
    expect(v.targetBefore).toBe(5) // rw-3 baseline cells are NOT in the targeted set
    expect(v.targetAfter).toBe(0)
    expect(v.cells).toEqual(["q|rw-2"])
    expect(v.passRateResolvable).toBe(false) // 0/5 vs 2/5 overlaps at n=5
  })

  it("shifted: target drops but another harness reason rises", () => {
    const before = five("q", "rw-2", 0, "harness:tool-call-dropped")
    const after = five("q", "rw-2", 0, "harness:premature-stop")
    const v = compareTargeted(before, after, "harness:tool-call-dropped", reasonOf)
    expect(v.decision).toBe("shifted")
    expect(v.newHarnessReasons).toEqual({ "harness:premature-stop": { before: 0, after: 5 } })
  })

  it("improved: target drops but not to 0", () => {
    const before = five("q", "rw-2", 0, "harness:false-veto")
    const after = [...five("q", "rw-2", 3, "not-failed", "model:ignored-guidance").slice(0, 4), cell("q", "rw-2", 4, false, "harness:false-veto")]
    expect(compareTargeted(before, after, "harness:false-veto", reasonOf).decision).toBe("improved")
  })

  it("no-change when the target count is flat; flags a target absent from the baseline", () => {
    const before = five("q", "rw-2", 0, "model:ignored-guidance")
    const after = five("q", "rw-2", 0, "model:ignored-guidance")
    const v = compareTargeted(before, after, "harness:false-veto", reasonOf)
    expect(v.decision).toBe("no-change")
    expect(v.rationale).toContain("absent from the baseline")
  })

  it("regressed when the pooled pass rate drops resolvably", () => {
    const before = [...five("q", "a", 5, "x"), ...five("q", "b", 5, "x"), ...five("q", "c", 5, "x")]
    const after = [...five("q", "a", 0, "harness:false-veto"), ...five("q", "b", 0, "model:ignored-guidance"), ...five("q", "c", 0, "model:ignored-guidance")]
    const v = compareTargeted(before, after, "harness:tool-call-dropped", reasonOf)
    expect(v.passRateResolvable).toBe(true)
    expect(v.decision).toBe("regressed")
  })
})

describe("recordAttributionOutcome", () => {
  it("appends an attribution entry; fixed records adopted, shifted records rejected", () => {
    const base = {
      id: "1", createdAt: "2026-11-03T00:00:00.000Z", weakness: "w", hypothesis: "h", variantId: "ra-default",
      passRateDeltaPp: 20, tokenDeltaPct: null, rationale: "r",
      attribution: { reason: "harness:false-veto", before: 3, after: 0, newHarnessReasons: [], passRateResolvable: false, cells: ["q|t"] },
    }
    const l1 = recordAttributionOutcome(emptyLedger(), { ...base, decision: "fixed" })
    expect(l1.entries[0]!.status).toBe("adopted")
    expect(l1.entries[0]!.weaknessRef).toBe("harness:false-veto")
    expect(l1.entries[0]!.tokenOverheadPct).toBe(0)
    const l2 = recordAttributionOutcome(l1, { ...base, id: "2", decision: "shifted" })
    expect(l2.entries.map((e) => e.status)).toEqual(["adopted", "rejected"])
  })
})
