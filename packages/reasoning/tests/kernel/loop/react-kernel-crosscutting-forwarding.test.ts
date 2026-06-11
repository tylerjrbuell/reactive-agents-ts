/**
 * react-kernel-crosscutting-forwarding.test.ts
 *
 * FM-I (GH #195), Layer-3 (kernel inner literal).
 *
 * `executeReActKernel` (react-kernel.ts) re-builds its `KernelInput` as a
 * hand-written literal before calling `runKernel`. Historically that literal
 * forwarded the per-pass + tool-gating fields but DROPPED the run-wide
 * cross-cutting fields — `harnessPipeline`, `budgetLimits`, `calibration`,
 * `auditRationale`. plan-execute's per-step path goes through
 * `executeReActKernel`, so a `.withHarness(h => h.before('think', …))` hook
 * registered on the agent went DEAD on every plan-execute step.
 *
 * This test pins the harnessPipeline channel end-to-end: a `before('think')`
 * phase hook passed via `ReActKernelInput.harnessPipeline` must fire at least
 * once during a real (1-iteration) `executeReActKernel` run.
 *
 * RED before the inner literal forwards `harnessPipeline`; GREEN after.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "../../../src/kernel/loop/react-kernel.js";

describe("executeReActKernel — cross-cutting field forwarding (FM-I Layer-3)", () => {
  it("fires a before('think') harness hook passed via ReActKernelInput.harnessPipeline", async () => {
    let thinkHookFires = 0;

    const rh = new RegistrationHarness();
    rh.before("think", () => {
      thinkHookFires += 1;
    });
    const harnessPipeline = new HarnessPipeline(rh._collected);

    await Effect.runPromise(
      executeReActKernel({
        task: "say hello",
        availableToolSchemas: [],
        harnessPipeline,
        maxIterations: 1,
      }).pipe(
        Effect.provide(TestLLMServiceLayer([{ text: "FINAL ANSWER: done" }])),
      ),
    );

    expect(thinkHookFires).toBeGreaterThanOrEqual(1);
  }, 20000);
});
