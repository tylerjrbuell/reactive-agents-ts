// Run: bun test packages/runtime/tests/pause-goal-achieved.test.ts
//
// Task review fix (2026-08-14) — deriveTaskOutcome (engine/finalize/derive-outcome.ts)
// computed `deliverables` unconditionally when called from reactive-agent.ts's
// run(), even for a PAUSED run (awaiting-approval / awaiting-interaction). A
// paused run with a declared-but-not-yet-produced deliverable (e.g. a required
// tool that hasn't executed because it's sitting behind the approval gate) then
// made `resolveGoalAchieved` see "declared but not produced" and return a
// definitive `false` — "goal not achieved" — instead of the correct ambiguous
// `null` a still-unfinished run should report (see resolveGoalAchieved's JSDoc,
// builder/helpers.ts, and DeriveTaskOutcomeCtx.isPausedRun's JSDoc).
//
// execute-stream.ts's runStream() path never had this bug — its isPausedRun
// ternary already wrapped the WHOLE deriveTaskOutcome call. Fixed by threading
// `isPausedRun` into DeriveTaskOutcomeCtx so deriveTaskOutcome itself forces
// `deliverables` to `undefined` (matching the pre-extraction behavior) before
// computing `goalAchieved`, not just gating the returned `receipt`.
//
// Pattern lifted from approval-gate-strategy-coverage.test.ts (gated tool +
// .withApprovalPolicy({mode:"detach"})). The task text names a file path
// (./report.md) — deriveDeliverablePaths (reasoning/src/kernel/capabilities/
// verify/derive-conditions.ts) compiles that into a RunContract deliverable
// the artifact scan can mark produced/missing. A bare .withRequiredTools()
// declaration alone does NOT do this (it only feeds the RunContract's
// `requirements` list, not `deliverables[]` — see derive-outcome.test.ts's
// comment), so the file-path phrasing is what actually reproduces the bug.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

const dir = mkdtempSync(join(tmpdir(), "ra-pause-goal-achieved-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("goalAchieved on a paused run with a declared, not-yet-produced deliverable", () => {
  it("reports null (ambiguous), not false, when the run pauses for approval before the required tool runs", async () => {
    let executions = 0;
    const agent = await ReactiveAgents.create()
      .withName("pause-goal-achieved")
      .withProvider("test")
      .withTestScenario([{ toolCall: { name: "risky-tool", args: { input: "go" } } }] as never)
      .withTools({
        tools: [
          {
            definition: {
              name: "risky-tool",
              description: "Mutates state — requires approval.",
              parameters: [
                { name: "input", type: "string" as const, description: "Input", required: true },
              ],
              riskLevel: "high" as const,
              requiresApproval: true,
              timeoutMs: 5_000,
              source: "function" as const,
            },
            handler: () =>
              Effect.sync(() => {
                executions += 1;
                return "ran";
              }),
          },
        ],
      })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(4)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      .build();

    // "./report.md" is the declared-but-not-yet-produced deliverable: the
    // gate blocks risky-tool (which would produce it) from ever running, so
    // for as long as the run stays paused the artifact scan reads it as
    // "declared but not produced" — precisely the shape that exposed the bug.
    const result = await agent.run("Write the results to ./report.md using the risky tool");

    expect(executions).toBe(0);
    expect(result.status).toBe("awaiting-approval");
    expect(result.goalAchieved).toBeNull();
  }, 30_000);
});
