// Run: bun test packages/runtime/tests/budget-inheritance-subagent.test.ts --timeout 15000
/**
 * Wave 5.4: budget inheritance pinned (Local-Tier Reliability program).
 *
 * The defect: `.withBudget({ tokenLimit })` armed a run-scoped meter that only
 * EVER counted the PARENT's own LLM calls. A delegated child's spend landed on
 * neither the parent's meter nor its accumulator, so a parent+child double
 * spend stayed invisible and the child could never halt at the parent boundary.
 * The run-budget-arm.ts header comment asserted the opposite ("sub-agents get
 * their own"): comment-to-invariant drift, corrected in this commit to the
 * REAL invariant: ONE meter per ROOT run; every delegated child's spend folds
 * into it.
 *
 * Pins:
 *  1. DELTA (RED at HEAD): with budget armed, `metadata.runBudgetSpend.tokens`
 *     (the ambient run meter, exposed at finalize) must exceed the parent's own
 *     `metadata.tokensUsed` by the child's contribution. At HEAD the meter
 *     equals the parent total exactly (child invisible).
 *  2. BOUNDARY (enforcement witness): a limit under the run's total spend
 *     gates the run through the shared meter (halt shape: throw or non-final
 *     output). Load-bearing proof, green both sides; pin 1 is the red-on-cut
 *     inheritance witness.
 *  3. REGRESSION: generous limit + no budget: runs complete byte-identically
 *     and no runBudgetSpend rides when un-metered (wire-or-delete honesty).
 *
 * Killswitch/harness propagation to child kernels: the child inherits
 * taskContract / fabricationGuard / grounding / approvalPolicy via
 * createLightRuntime (sub-agent-executor.ts:477-486); killswitch + budget
 * enforcement INSIDE the child kernel is NOT propagated (child kernels are
 * separate light runtimes): DISCLOSED GAP, see w5-runtime-report.md.
 *
 * Delegation scenario mirrors subagent/nesting-depth.test.ts: trigger marker
 * past the 200-char "Parent task:" bleed so only the parent matches the spawn
 * turn; the child answers the CHILDWORK turn.
 */
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

const filler = "prime the delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} BUDGET_ROOT_TRIGGER: begin the delegation.`;

async function delegationRun(limit?: number) {
  const builder = ReactiveAgents.create()
    .withName("w54-deleg")
    .withProvider("test")
    .withModel("test-model")
    .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 2 })
    .withTools()
    .withTestScenario([
      {
        match: "BUDGET_ROOT_TRIGGER",
        toolCall: { name: "spawn-agent", args: { task: "CHILDWORK do the child work", name: "kid" } },
      },
      { match: "CHILDWORK", text: "child done" },
      { text: "Done." },
    ]);
  const agent = await (limit === undefined ? builder : builder.withBudget({ tokenLimit: limit })).build();
  try {
    return await agent.run(parentTask);
  } finally {
    await agent.dispose();
  }
}

describe("Budget inheritance: delegated child spend lands in the parent run meter (5.4)", () => {
  it("runBudgetSpend.tokens counts the CHILD's spend, not just the parent's", async () => {
    const r = await delegationRun(50_000);
    const spend = r.metadata.runBudgetSpend;
    // The meter seam exists at all (undefined at HEAD: field never minted).
    expect(spend).toBeDefined();
    const parentOnly = r.metadata.tokensUsed;
    // RED at HEAD: spend === parentOnly (child invisible to the meter).
    // After the fix the child's scripted spend (~224 tok) folds in.
    expect(spend!.tokens).toBeGreaterThan(parentOnly);
  }, 15000);

  it("sub-300 limit gates the run through the shared meter (boundary enforcement witness)", async () => {
    // Measured scripted spends (probe, this exact scenario): parent call1 =
    // 262, child = 224, parent call2 = 246. Enforcement of the run meter is
    // real at both HEAD (parent-only 508 crosses 300 at a later boundary) and
    // post-fix (486 crosses it before the final call). This pin proves the
    // meter is load-bearing; pin 1 is the red-on-cut inheritance witness.
    let halted = false;
    let output: unknown = "Done.";
    try {
      const r = await delegationRun(300);
      output = r.output;
    } catch {
      halted = true;
    }
    expect(halted || output !== "Done.").toBe(true);
  }, 15000);

  it("regression: generous limit completes; un-budgeted runs carry no runBudgetSpend", async () => {
    const generous = await delegationRun(50_000);
    expect(generous.output).toBe("Done.");
    expect(generous.success).toBe(true);

    const plain = await delegationRun();
    expect(plain.output).toBe("Done.");
    expect(plain.metadata.runBudgetSpend).toBeUndefined();
  }, 15000);
});
