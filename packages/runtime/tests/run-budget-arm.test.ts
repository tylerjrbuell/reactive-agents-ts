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
import { armRunBudget } from "../src/engine/run-budget-arm.js";

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

  it("leaves the run unarmed without budgetLimits (byte-identical path)", async () => {
    const unarmed = armRunBudget(probe, undefined);
    const meter = await Effect.runPromise(unarmed({ id: "run-1" }));
    expect(meter).toBeNull();
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
