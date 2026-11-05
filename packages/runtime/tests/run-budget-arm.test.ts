// File: tests/run-budget-arm.test.ts
//
// Issue #232 Gap 2 — whole-run budget meter, runtime arming seam.
//
// `ReasoningService.execute` arms a meter per execution, so auxiliary passes
// that call `execute` WITHOUT `budgetLimits` (the verification THINK retry, the
// post-think continuation hooks) were unbudgeted. `armRunBudget` moves the
// arming to the runtime's once-per-run `ExecutionEngine.execute` boundary so
// every pass feeds ONE meter. This file pins that arming rule in isolation.
import { describe, expect, it } from "bun:test";
import { Effect, FiberRef } from "effect";
import { CurrentRunBudget } from "@reactive-agents/reasoning";
import { armRunBudget, budgetedRunMeter, settleRunSpend } from "../src/engine/run-budget-arm.js";
/** Reads the ambient meter; `null` means no run meter is armed. */
const probe = (_task: { readonly id: string }) =>
  Effect.gen(function* () {
    return yield* FiberRef.get(CurrentRunBudget);
  });

describe("armRunBudget — whole-run meter (#232 Gap 2)", () => {
  it("arms an ambient meter when budgetLimits are declared", async () => {
    const armed = armRunBudget(probe, { tokenLimit: 100 });
    const meter = await Effect.runPromise(armed({ id: "run-1" }));
    expect(meter).not.toBeNull();
    expect(meter?.tokens).toBe(0);
  });

  it("arms an accounting-only meter without budgetLimits (reported-spend source, no limits)", async () => {
    // 2026-11-05: the meter is the ONE source of a run's reported spend, so it
    // is armed on every run. Without `.withBudget()` it carries NO limits, so no
    // budget decision can fire, and runBudgetSpend stays hidden.
    const probeWithLimits = (_task: { readonly id: string }) =>
      Effect.gen(function* () {
        const meter = yield* FiberRef.get(CurrentRunBudget);
        return { meter, exposed: yield* budgetedRunMeter(meter) };
      });
    const armed = armRunBudget(probeWithLimits, undefined);
    const { meter, exposed } = await Effect.runPromise(armed({ id: "run-1" }));
    expect(meter).not.toBeNull();
    expect(meter?.tokens).toBe(0);
    expect(exposed).toBeNull();
  });

  it("exposes the meter as runBudgetSpend only when a budget was declared", async () => {
    const probeExposed = (_task: { readonly id: string }) =>
      Effect.gen(function* () {
        const meter = yield* FiberRef.get(CurrentRunBudget);
        return { meter, exposed: yield* budgetedRunMeter(meter) };
      });
    const armed = armRunBudget(probeExposed, { tokenLimit: 100 });
    const { meter, exposed } = await Effect.runPromise(armed({ id: "run-1" }));
    expect(meter).not.toBeNull();
    expect(exposed).toBe(meter);
  });

  it("settleRunSpend copies the meter's total onto ctx (one source for reported spend)", async () => {
    const ctx = { taskId: "run-1", tokensUsed: 1375, cost: 0.5 };
    const settle = (_task: { readonly id: string }) =>
      Effect.gen(function* () {
        const meter = yield* FiberRef.get(CurrentRunBudget);
        meter!.tokens += 306;
        meter!.cost += 0.01;
        return yield* settleRunSpend(ctx);
      });
    const settled = await Effect.runPromise(armRunBudget(settle, undefined)({ id: "run-1" }));
    expect(settled.tokensUsed).toBe(306);
    expect(settled.cost).toBe(0.01);
    // No meter armed (engine driven outside armRunBudget): ctx passes through.
    const bare = await Effect.runPromise(settleRunSpend(ctx));
    expect(bare).toBe(ctx);
  });

  it("creates a FRESH meter per run (never shared across runs)", async () => {
    const armed = armRunBudget(probe, { tokenLimit: 100 });
    const first = await Effect.runPromise(armed({ id: "run-1" }));
    const second = await Effect.runPromise(armed({ id: "run-2" }));
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
  });

  it("shares ONE meter across sequential calls within a run (main + auxiliary pass)", async () => {
    // The main reasoning pass and every auxiliary pass run inside the SAME
    // armed `execute`; both must observe the same accumulator instance so the
    // run's spend is cumulative.
    const seen: Array<unknown> = [];
    const nested = (_task: { readonly id: string }) =>
      Effect.gen(function* () {
        seen.push(yield* FiberRef.get(CurrentRunBudget)); // main pass
        seen.push(yield* FiberRef.get(CurrentRunBudget)); // auxiliary pass
        return null;
      });
    const armed = armRunBudget(nested, { tokenLimit: 100 });
    await Effect.runPromise(armed({ id: "run-1" }));
    expect(seen[0]).not.toBeNull();
    expect(seen[0]).toBe(seen[1]);
  });
});
