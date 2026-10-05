// Run: bun test packages/reasoning/src/strategies/plan-execute-cumulative-budget.integration.test.ts --timeout 20000
//
// Cumulative run-budget enforcement for plan-execute-reflect.
//
// Live evidence (2026-10, stackblitz 03 demo): `.withBudget({ tokenLimit: 20000 })`
// on a plan-execute-reflect run reached 25,675 cumulative tokens without halting.
// Root cause: the Arbitrator pre-intent guard counts `state.tokens` SPENT SINCE
// KERNEL START, and plan-execute threads the same full `tokenLimit` into EVERY
// step kernel (step-executor.ts) - each step gets a fresh budget pool - while
// the outer loop's own LLM calls (plan generation, analysis steps, reflection,
// synthesis, quality gate) are never guarded at all.
//
// These tests pin the STRATEGY-LEVEL fix: the outer loop accounts cumulative
// spend and (a) stops launching new work once spend >= the declared limit,
// terminating honestly (partial + budgetTerminalPartial markers, mirroring
// blueprint's budget-capped join semantics), and (b) threads only the REMAINING
// budget into each subsequent wave's step kernels (unit-pinned in
// budget/remaining-budget.test.ts; behavior-pinned here by the stop, which is
// the observable half of the same accounting).
//
// No network: deterministic TestLLMService turns, fakeUsage reports per-call
// token usage from prompt/output length.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executePlanExecute } from "./plan-execute.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";
import { provideTestEnvelope } from "../kernel/envelope/run-envelope.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

// ~50,000 fakeUsage output tokens (1 token per 4 chars). Sized so the BETA
// analysis call ALONE crosses the 40,000 tokenLimit below, while plan
// generation + the small ALPHA composite kernel (few-KB prompts) cannot come
// close to it - the cut therefore lands deterministically AFTER BETA and
// BEFORE GAMMA without depending on exact prompt lengths.
const LONG_TEXT = "L".repeat(200_000);

// Three steps chained by dependsOn so computeWaves schedules three SEQUENTIAL
// waves (one step each):
// - ALPHA (s1): composite sub-kernel (gather call, then a final answer) - small
//   spend; its kernel receives tokenLimit minus plan-generation spend
// - BETA (s2):  analysis step - one direct gatewayComplete call, NOT guarded
//   by any sub-kernel budget; its 200k-char output crosses the run limit
// - GAMMA (s3): tool_call step - must NEVER LAUNCH once spend >= limit.
//   (Deliberately NOT a composite kernel: a huge prior-result blob threaded
//   into a sub-kernel TASK text trips a separate, PRE-EXISTING
//   catastrophic-backtracking defect in kernel/capabilities/verify/
//   derive-conditions.ts PATH_TOKEN (O(n^3) on dot-free tokens; 5k chars
//   measured ~30s). Tracked as a follow-on gap in the warden report; this
//   test must not absorb it.)
const PLAN = {
  steps: [
    {
      title: "ALPHA research pass",
      instruction: "Gather the core facts about the topic with the tools.",
      type: "composite",
    },
    {
      title: "BETA long draft",
      instruction: "Draft the long-form findings section.",
      type: "analysis",
      dependsOn: ["s1"],
    },
    {
      title: "GAMMA verify write",
      instruction: "Persist the verified findings.",
      type: "tool_call",
      toolName: "gather",
      toolArgs: { q: "verify" },
      dependsOn: ["s2"],
    },
  ],
};

const TASK =
  "Research the topic, draft the findings section, verify them, and produce a report.";

const scenario = () =>
  TestLLMServiceLayer([
    // 1. plan generation (completeStructured, harness channel, consumes json)
    { json: PLAN },
    // 2-3. ALPHA composite sub-kernel: think to gather, then final answer
    { match: "ALPHA", toolCall: { name: "gather", args: { q: "topic" } } },
    { match: "ALPHA", text: "alpha findings: the metric rose 12 percent." },
    // 4. BETA analysis step: single direct LLM call, huge output
    { match: "BETA", text: LONG_TEXT },
    // 5. REFLECT pass (only reached when the run does not budget-stop).
    // NOTE: no GAMMA turn is scripted. The tool_call dispatch consumes no
    // LLM turn, and leaving an earlier "GAMMA"-guarded turn in the scenario
    // would let the reflect call (whose prompt recites every step title)
    // match it instead of the STEP RESULTS turn.
    { match: "STEP RESULTS", text: "SATISFIED: the goal is fully addressed." },
    // 6. SYNTHESIS + quality gate fallback (unconditional, repeats)
    { text: "FINAL REPORT: combined answer." },
  ]);

const runPlanExecute = (extra: Record<string, unknown>) =>
  Effect.runPromise(
    executePlanExecute({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      ...extra,
    } as never).pipe(
      Effect.provide(Layer.merge(scenario(), gatherToolLayer)),
      provideTestEnvelope,
    ),
  );

const stepContents = (result: { steps: readonly { content?: string }[] }) =>
  result.steps.map((s) => s.content ?? "");

describe("plan-execute cumulative budget - run-scoped tokenLimit stops new work", () => {
  it("stops before launching the next step once cumulative spend >= tokenLimit, terminating honestly", async () => {
    const result = await runPlanExecute({
      budgetLimits: { tokenLimit: 40_000 },
    });

    const contents = stepContents(result);
    // Work done BEFORE the cliff is preserved…
    expect(contents.some((c) => c.startsWith("[EXEC s1"))).toBe(true);
    expect(contents.some((c) => c.startsWith("[EXEC s2"))).toBe(true);
    // …but GAMMA's step kernel must NEVER LAUNCH: pre-fix, every step kernel
    // received a FRESH full 40k pool and the outer loop never consulted
    // cumulative spend, so s3 executed and the run overshot the limit.
    expect(contents.some((c) => c.startsWith("[EXEC s3"))).toBe(false);
    // The reflect pass (another unguarded outer LLM call) must not run either.
    expect(contents.some((c) => c.startsWith("[REFLECT"))).toBe(false);

    // Honest termination (blueprint budget-capped join semantics): a partial,
    // never a silent completed ship past the budget.
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBe(true);
    expect(meta.harnessAuthoredOutput).toBe(true);
    // Raw open-string channel, kernel-parity shape: budget-limit:tokens:<spent>/<limit>
    expect(String(meta.rawTerminatedBy)).toMatch(/^budget-limit:tokens:\d+\/40000$/);
    // The recorded spend really did cross the limit at stop time (the budget
    // accounting is cumulative, not per-kernel).
    const spent = Number(meta.tokensUsed);
    expect(spent).toBeGreaterThanOrEqual(40_000);
  });

  it("CONTROL: with no budgetLimits the same plan runs to completion (no false stop)", async () => {
    const result = await runPlanExecute({});
    const contents = stepContents(result);
    expect(contents.some((c) => c.startsWith("[EXEC s3"))).toBe(true);
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
  });

  it("CONTROL: a generous tokenLimit far above total spend also runs to completion", async () => {
    const result = await runPlanExecute({
      budgetLimits: { tokenLimit: 100_000_000 },
    });
    const contents = stepContents(result);
    expect(contents.some((c) => c.startsWith("[EXEC s3"))).toBe(true);
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
    expect(String(meta.rawTerminatedBy ?? "")).not.toContain("budget-limit");
  });
});
