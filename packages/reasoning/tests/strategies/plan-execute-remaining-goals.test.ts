// File: tests/strategies/plan-execute-remaining-goals.test.ts
//
// D-2026-07-28-C: `goal_state.remaining` had a full consumer chain
// (EventLog → volatileTailStage → "Remaining steps: …" in the message tail)
// but zero producers anywhere in the codebase — a dead-signal defect of the
// same shape as the H1 composed-but-never-rendered regression. `Plan.steps`
// is the one typed sub-goal ledger in RA (2026-07-08 audit), so plan-execute's
// composite branch now threads the titles of every OTHER pending/in_progress
// step as `KernelInput.remainingGoals`, which `fromKernelState` turns into a
// `goal_state` event.
//
// This is a red-on-cut BEHAVIORAL proof, not a fixture pin: it drives the
// real strategy end to end over the deterministic test provider and asserts
// on what the SUB-KERNEL actually saw in its own prompt (via TestLLMService's
// `match` guard against the live request), not a hand-built AssemblyInput.
// Revert step-executor.ts's `remainingGoals` computation and this goes red:
// turn 1's guard never fires, Step A falls to the "unwired" turn instead, and
// the final assertion fails.
//
// `buildStepExecutionPrompt` (plan-prompts.ts) renders the OVERALL GOAL
// (shared across every step) plus the CURRENT step's own title+instruction —
// never another step's title, unless `remainingGoals` puts it there. So the
// task/instruction text below is deliberately generic at the goal level and
// distinct per step, to avoid a false-positive match against the shared goal.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

// Two COMPOSITE steps — Step A dispatches first, while Step B is still
// pending, so Step A's sub-kernel is the one that should see Step B recited
// as a remaining goal. Step B dispatches after A completes, with nothing
// left pending, so it should see none.
const PLAN = {
  steps: [
    { title: "Step A", instruction: "Summarize the ALPHA findings.", type: "composite" },
    { title: "Step B", instruction: "Summarize the BETA findings.", type: "composite" },
  ],
};

const TASK = "Write a two-part findings report.";

const scenario = () =>
  TestLLMServiceLayer([
    // 1. plan generation (completeStructured).
    { json: PLAN },
    // 2. Step A's sub-kernel think call. Only fires if `remainingGoals`
    //    reached `fromKernelState` and volatileTailStage rendered it into the
    //    message tail the test provider's `extractSearchText` inspects.
    { match: "Remaining steps:.*Step B", text: "FINAL ANSWER: A saw B pending." },
    // 3. Fallback for Step A if the wiring is broken (guard above never
    //    matches) — scoped to Step A's own instruction text (unique to its
    //    own CURRENT STEP block) so it can never accidentally answer Step B's
    //    call instead.
    { match: "ALPHA findings", text: "FINAL ANSWER: A saw nothing." },
    // 4. Step B's sub-kernel think call — no other step is pending, so it
    //    must NOT see a "Remaining steps:" line at all.
    { match: "BETA findings", text: "FINAL ANSWER: B done." },
  ]);

describe("D-2026-07-28-C — plan-execute composite steps recite remaining sub-goals", () => {
  it("Step A's sub-kernel sees Step B as a remaining goal, and it reaches the final result", async () => {
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: TASK,
          taskType: "simple",
          memoryContext: "",
          availableTools: [],
          availableToolSchemas: [],
          config: defaultReasoningConfig,
        } as never).pipe(Effect.provide(scenario())),
      ),
    );

    expect(result.status).toBe("completed");
    expect(result.output).toContain("A saw B pending");
    expect(result.output).not.toContain("A saw nothing");
  });
});
