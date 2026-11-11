// Run: bun test packages/reasoning/tests/kernel/seam-budget-exhausted-terminal.test.ts --timeout 15000
//
// A run the Arbitrator's budget pre-guard ends (`.withBudget({ tokenLimit })` →
// `KernelInput.budgetLimits` → terminatedBy "budget_exceeded") publishes
// BudgetExhausted with the budget kind, limit and spend. Before the
// `budget-exhausted` terminal step, only the `budgetLimit()` killswitch path
// published it; a builder-budget stop surfaced only as terminatedBy on the
// terminal event.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput } from "../../src/kernel/state/kernel-state.js";
import { exhaustedBudgets } from "../../src/kernel/capabilities/decide/budget-signal.js";

type Seen = { agentId: string; budgetType: string; limit: number; used: number; timestamp: number };

const run = (input: KernelInput) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sink = yield* Ref.make<readonly Seen[]>([]);
      const bus = yield* EventBus;
      yield* bus.on("BudgetExhausted", (ev) => Ref.update(sink, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, {
        maxIterations: 3,
        strategy: "reactive",
        kernelType: "react",
        taskId: "budget-exhausted-terminal",
      });
      return { pass, seen: yield* Ref.get(sink) };
    }).pipe(
      Effect.provide(Layer.mergeAll(TestLLMServiceLayer([{ text: "FINAL ANSWER: 42." }]), EventBusLive)),
    ),
  );

describe("budget-exhausted terminal step", () => {
  it("tokenLimit stop publishes BudgetExhausted with kind, limit and spend", async () => {
    const { pass, seen } = await run({
      task: "What is the answer?",
      agentId: "budget-agent",
      budgetLimits: { tokenLimit: 1 },
    } as KernelInput);

    expect(pass.state.meta.terminatedBy).toBe("budget_exceeded");
    expect(seen.length).toBe(1);
    expect(seen[0]?.agentId).toBe("budget-agent");
    expect(seen[0]?.budgetType).toBe("tokens");
    expect(seen[0]?.limit).toBe(1);
    expect(seen[0]?.used).toBe(pass.state.tokens);
    expect(seen[0]?.used).toBeGreaterThan(0);
  });

  it("a run under budget publishes no BudgetExhausted", async () => {
    const { pass, seen } = await run({
      task: "What is the answer?",
      budgetLimits: { tokenLimit: 10_000_000 },
    } as KernelInput);

    expect(pass.state.meta.terminatedBy).not.toBe("budget_exceeded");
    expect(seen.length).toBe(0);
  });

  it("exhaustedBudgets lists each exceeded dimension, nothing when not exceeded", () => {
    expect(
      exhaustedBudgets({ tokensUsed: 10, costUsd: 2, tokenLimit: 5, costLimit: 1, status: "exceeded" }),
    ).toEqual([
      { budgetType: "tokens", limit: 5, used: 10 },
      { budgetType: "cost", limit: 1, used: 2 },
    ]);
    expect(exhaustedBudgets({ tokensUsed: 4, costUsd: 0, tokenLimit: 5, status: "warning" })).toEqual([]);
    expect(exhaustedBudgets(undefined)).toEqual([]);
  });
});
