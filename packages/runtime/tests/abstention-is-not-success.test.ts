// Run: bun test packages/runtime/tests/abstention-is-not-success.test.ts
//
// F7, second half (2026-07-28) — an abstained run reported itself a SUCCESS.
//
// The kernel reports `status: "completed"` for a forced abstention, because the
// decline itself completed cleanly. `execution-engine.ts` read that straight
// through into `executionSucceeded`, so a run that delivered nothing and said so
// published `AgentCompleted.success: true` and a trace `run-completed.status:
// "success"`.
//
// `deriveRunOutcome` has mapped `abstained -> "failure"` since 2026-07-23,
// precisely so the learning loop is not taught that declining is a win — but
// that classifier governs only the debrief and learning lanes. The terminal
// status was a SEPARATE, disagreeing rule, so the gate lane
// (`testing/src/gate/runner.ts` reads `run-completed.status`) still scored
// abstentions as successes. Same dishonest-success shape as F1, one lane over.
//
// The decline stays honest and machine-readable — `terminatedBy` is "abstained"
// and the abstention descriptor survives. Only the coarse success bit moves.
//
// RED-ON-CUT: delete the `terminatedByRaw === "abstained"` block in
// execution-engine.ts and the first cell goes green-to-red.
//
// The second cell is what stops this passing vacuously: a change that simply
// reported failure everywhere would also satisfy the first.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

/** Forces the `requiredToolUnavailable` abstention trigger: a required tool that
 *  is never registered can never be satisfied, so the run must decline. */
async function runAbstaining() {
  const agent = await ReactiveAgents.create()
    .withName("abstain-status")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([
      { text: "I cannot ground this without the required tool." },
      { text: "I cannot ground this without the required tool." },
    ] as never)
    .withTools({ builtins: [], adaptive: false } as never)
    .withRequiredTools({ tools: ["tool-that-does-not-exist"] })
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();
  const result = await agent.run("What is the population of the fictional city of Aetheria?");
  await agent.dispose();
  return result;
}

async function runOrdinary() {
  const agent = await ReactiveAgents.create()
    .withName("ordinary-status")
    .withProvider("test")
    .withModel("test")
    .withTestScenario([{ text: "FINAL ANSWER: 42." }] as never)
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();
  const result = await agent.run("What is 6 times 7?");
  await agent.dispose();
  return result;
}

describe("an abstention is not reported as a success", () => {
  it("a run that declined does not claim success", async () => {
    const result = await runAbstaining();

    // Precondition — if this run stops taking the abstention path for some
    // unrelated reason, the cell must fail loudly rather than pass on a run it
    // never exercised. `terminatedBy` is not surfaced on AgentResult.metadata,
    // so the abstention sentinel's own text is the available signal.
    expect(String(result.output)).toContain("Could not complete the task");
    expect(String(result.output)).toContain("Cause:");

    // The load-bearing assertion.
    expect(result.success).toBe(false);
  }, 20000);

  it("an ordinary answered run still reports success", async () => {
    const result = await runOrdinary();

    expect(result.success).toBe(true);
  }, 20000);
});
