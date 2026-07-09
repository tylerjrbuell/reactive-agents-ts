// Run: bun test packages/reasoning/src/strategies/honest-partial.integration.test.ts --timeout 20000
//
// H5 / P0 — the honest-partial channel, pinned AT THE RESULT BOUNDARY.
//
// `pace-terminal.integration.test.ts` already proves the kernel STATE carries
// `meta.budgetTerminalPartial` + `meta.verificationWarning` on an over-budget
// run. But those meta fields had ZERO readers: the strategy mapped
// `state.status === "done"` straight to `"completed"`, and
// `reasoning-post-think.ts:85` derives `success = status === "completed"`. So the
// caller saw a clean success and the "honest partial" died inside the kernel.
//
// Asserting on `state.meta` cannot catch that — it is exactly the
// unit-tests-the-value-not-the-consumer gap the wiring audit was about. These
// tests assert on the `ReasoningResult` the caller actually receives, and fail if
// any strategy stops routing through `resolveCompletionStatus`.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReactive } from "./reactive.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

const scenario = () =>
  TestLLMServiceLayer([
    { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
    { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
    { text: "FINAL ANSWER: unsynthesized guess." },
  ]);

const TASK = "Research the topic thoroughly and write your findings to report.md.";

const runReactive = (extra: Record<string, unknown>) =>
  Effect.runPromise(
    executeReactive({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: "",
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      maxIterations: 6,
      ...extra,
    } as never).pipe(Effect.provide(Layer.merge(scenario(), gatherToolLayer))),
  );

describe("H5 — an unverified ship never reaches the caller as `completed`", () => {
  it("budget-terminal partial: result.status is PARTIAL, not completed", async () => {
    // horizonProfile long → the terminal pace band forces a synthesis one notch
    // before the budget cliff, and ships an honestly-partial answer with
    // report.md still outstanding.
    const result = await runReactive({
      horizonProfile: "long",
      budgetLimits: { tokenLimit: 1 },
    });

    // The answer IS preserved — we are not throwing away real work...
    expect(result.output).toBeTruthy();
    // ...but the caller is told the truth. `success` is derived downstream as
    // `status === "completed"` (reasoning-post-think.ts:85), so this IS the
    // success flag the user sees.
    expect(result.status).toBe("partial");
    expect(result.status).not.toBe("completed");
  });

  it("budget-terminal partial: the verification warning reaches result.metadata", async () => {
    const result = await runReactive({
      horizonProfile: "long",
      budgetLimits: { tokenLimit: 1 },
    });
    const meta = result.metadata as Record<string, unknown>;
    // The warning names what stayed unmet. Before H5 it lived only on
    // state.meta and never crossed the result boundary.
    expect(typeof meta.verificationWarning).toBe("string");
    expect(String(meta.verificationWarning)).toContain("report.md");
    expect(meta.budgetTerminalPartial).toBe(true);
  });

  it("CONTROL: an ordinary completed run still reports `completed` with no warning", async () => {
    const result = await Effect.runPromise(
      executeReactive({
        taskDescription: "What is 2 + 2?",
        taskType: "qa",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
        maxIterations: 3,
      } as never).pipe(
        Effect.provide(
          Layer.merge(TestLLMServiceLayer([{ text: "FINAL ANSWER: 4." }]), gatherToolLayer),
        ),
      ),
    );
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.verificationWarning).toBeUndefined();
    expect(meta.budgetTerminalPartial).toBeUndefined();
  });
});
