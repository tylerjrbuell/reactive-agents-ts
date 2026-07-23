// harness-hook-envelope-coverage.test.ts — cross-cutting cascade Task 6, scope C.
//
// `ReasoningService.execute` is called from FOUR places in the runtime, not one.
// `reasoning-think.ts` (the main think pass) builds the `RunEnvelope`; the
// post-think harness hooks re-run reasoning and — until 2026-07-22 — built their
// request WITHOUT one. The consequence was concrete: on a
// `.withCustomTermination()` retry the approval gate was DISARMED, so a tool the
// caller declared `requiresApproval: true` executed unattended on the
// continuation even though the identical call would have paused on the first pass.
//
// This pins the retry pass. Cutting `envelope: continuationEnvelope` from
// `reasoning-harness-hooks.ts`'s `buildExecuteRequest` makes the gated handler
// run and fails the `executions` assertion.
import { describe, it, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

const dir = mkdtempSync(join(tmpdir(), "ra-hook-envelope-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("harness hooks carry the RunEnvelope (cascade scope C)", () => {
  it("withCustomTermination retry: the approval gate is still armed on the continuation", async () => {
    let executions = 0;

    const agent = await ReactiveAgents.create()
      .withName("hook-envelope-gate")
      .withProvider("test")
      // First pass answers with NO tool call, so the run completes and the
      // custom-termination predicate (never satisfied) triggers the retry.
      // The test provider consumes turns SEQUENTIALLY (callIndex never rewinds),
      // so turn 0 is the first pass's answer and turn 1 — the gated tool call —
      // can only be reached by the retry pass.
      .withTestScenario([
        { text: "Here is an initial answer with no tools." },
        { toolCall: { name: "risky-tool", args: { input: "go" } } },
      ] as never)
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
      .withMaxIterations(3)
      .withDurableRuns({ dir, checkpointEvery: 1 })
      .withApprovalPolicy({ tools: ["risky-tool"], mode: "detach" })
      // Never satisfied → the hook always re-runs reasoning.
      .withCustomTermination(() => false)
      .build();

    await agent.run("do the risky thing");

    // The retry pass asked for the gated tool. It must have PAUSED, exactly as
    // the first pass would have — not executed unattended.
    expect(executions).toBe(0);
  }, 30_000);
});
