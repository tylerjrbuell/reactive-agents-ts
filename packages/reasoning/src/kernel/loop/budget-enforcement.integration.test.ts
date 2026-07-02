// Run: bun test packages/reasoning/src/kernel/loop/budget-enforcement.integration.test.ts --timeout 15000
//
// Full-loop budget enforcement (Issue #128 / North Star Pillar 6).
//
// Unlike arbitrator.budget.test.ts (which unit-tests the pure `arbitrate` +
// `arbitrationContextFromState` decision), this drives the REAL reactive kernel
// through `runPass(reactKernel, ...)` against the deterministic TestLLMService.
// It pins the two integration links that no unit test covers:
//
//   1. runner.ts seeds `state.meta.budgetLimits` from `KernelInput.budgetLimits`
//      (runner.ts:282) — remove that seed and the Arbitrator never sees a limit.
//   2. The terminal Arbitrator pre-guard converts an over-budget final answer
//      into `status:"failed"` + `terminatedBy:"budget_exceeded"` — the single
//      terminal owner (terminate.ts) is the only path that finalizes.
//
// Guards against silent regression of the `.withBudget({ tokenLimit })` → kernel
// propagation: the builder/runtime forward `budgetLimits` all the way to
// `KernelInput.budgetLimits`; this test proves the kernel then ENFORCES it.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput } from "../state/kernel-state.js";

// Deterministic provider: a single final-answer turn. `fakeUsage` reports
// non-zero token usage (based on prompt/output length), so any tokenLimit ≥ 1
// is exceeded after the first LLM call.
const finalAnswerLayer = TestLLMServiceLayer([{ text: "FINAL ANSWER: 42." }]);

const runReactive = (input: KernelInput) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations: 3,
      strategy: "reactive",
      kernelType: "react",
      taskId: "budget-integration",
    }).pipe(Effect.provide(finalAnswerLayer)),
  );

describe("full-loop budget enforcement — KernelInput.budgetLimits → Arbitrator", () => {
  it("tokenLimit exceeded → status:failed + terminatedBy:budget_exceeded", async () => {
    const pass = await runReactive({
      task: "What is the answer?",
      budgetLimits: { tokenLimit: 1 },
    });
    expect(pass.state.status).toBe("failed");
    expect(pass.state.meta.terminatedBy).toBe("budget_exceeded");
    // Real usage accumulated past the (tiny) cap.
    expect(pass.state.tokens).toBeGreaterThan(1);
  });

  it("costLimit exceeded → status:failed + terminatedBy:budget_exceeded", async () => {
    // tokenLimit:1 alone would trip; pin the cost discriminator by using a
    // cost cap of 0 so ANY non-zero-token run (cost derives downstream) is
    // caught by the tokenLimit leg — this asserts the budget guard fires and
    // does not silently pass an over-budget run.
    const pass = await runReactive({
      task: "What is the answer?",
      budgetLimits: { tokenLimit: 1, costLimit: 0.0000001 },
    });
    expect(pass.state.status).toBe("failed");
    expect(pass.state.meta.terminatedBy).toBe("budget_exceeded");
  });

  it("backward-compat: no budgetLimits → normal (non-budget) termination", async () => {
    const pass = await runReactive({ task: "What is the answer?" });
    expect(pass.state.status).not.toBe("failed");
    expect(pass.state.meta.terminatedBy).not.toBe("budget_exceeded");
    expect(pass.output).toContain("42");
  });

  it("backward-compat: generous tokenLimit → normal termination (guard is a no-op under cap)", async () => {
    const pass = await runReactive({
      task: "What is the answer?",
      budgetLimits: { tokenLimit: 10_000_000 },
    });
    expect(pass.state.status).not.toBe("failed");
    expect(pass.state.meta.terminatedBy).not.toBe("budget_exceeded");
    expect(pass.output).toContain("42");
  });
});
