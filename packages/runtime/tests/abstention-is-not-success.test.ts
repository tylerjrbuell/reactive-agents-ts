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
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    // never exercised. Owner decision 2026-11-10: the abstention ships output
    // "" and its sentinel is the cause on `error`.
    expect(result.terminatedBy).toBe("abstained");
    expect(result.output).toBe("");
    expect(String(result.error)).toContain("Could not complete the task");
    expect(String(result.error)).toContain("Cause:");

    // The load-bearing assertion.
    expect(result.success).toBe(false);
  }, 20000);

  it("an ordinary answered run still reports success", async () => {
    const result = await runOrdinary();

    expect(result.success).toBe(true);
  }, 20000);

  // Task 3 (2026-09-14): run-completed carries the raw termination reason
  // end-to-end. `totalCostUsd` is the sibling field on the same event, but the
  // `test` provider always reports cost 0 (DEBT-REGISTER B3), so it can't be
  // proven non-zero through this harness — that half is proven at the unit
  // level only (packages/trace/tests/run-completed-truth.test.ts).
  //
  // RED-ON-CUT: delete the `totalCostUsd` spread in run-finalize.ts and this
  // test is unaffected (it asserts terminatedBy, not cost) — deleting the
  // `terminationReason` spread instead is what turns this cell red.
  it("run-completed trace event carries terminatedBy for an abstained run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-t3-terminated-by-"));

    const agent = await ReactiveAgents.create()
      .withName("abstain-trace")
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
      .withObservability({ tracing: { dir } })
      .build();

    await agent.run("What is the population of the fictional city of Aetheria?");
    await agent.dispose();

    const names = await readdir(dir);
    const rows: { kind?: string; terminatedBy?: string; totalCostUsd?: number }[] = [];
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const text = await readFile(join(dir, name), "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        rows.push(JSON.parse(trimmed));
      }
    }

    const runCompleted = rows.find((r) => r.kind === "run-completed");
    expect(runCompleted).toBeDefined();
    expect(runCompleted!.terminatedBy).toBe("abstained");
    // Sibling field present and well-typed even though the test provider
    // cannot exercise a non-zero value (see comment above).
    expect(runCompleted!.totalCostUsd).toBe(0);
  }, 20000);
});
