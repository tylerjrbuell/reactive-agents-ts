// File: src/strategies/budget/run-budget-spend.test.ts
//
// Issue #234 — the strategy budget gates read the SHARED run meter (maxed over
// the strategy's local figure) so the strategy gate and the kernel Arbitrator
// agree on the run boundary.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { CurrentRunBudget } from "../../kernel/run-budget.js";
import { resolveRunSpend } from "./run-budget-spend.js";

const withMeter = (
  spend: { tokens: number; cost: number },
  meter: { tokens: number; cost: number },
) => resolveRunSpend(spend).pipe(Effect.locally(CurrentRunBudget, meter));

describe("resolveRunSpend", () => {
  it("returns the local spend when no meter is armed", async () => {
    const resolved = await Effect.runPromise(
      resolveRunSpend({ tokens: 10, cost: 0.5 }),
    );
    expect(resolved).toEqual({ tokens: 10, cost: 0.5 });
  });

  it("maxes the run meter over the local spend (never under-reports)", async () => {
    const resolved = await Effect.runPromise(
      withMeter({ tokens: 10, cost: 0.1 }, { tokens: 250, cost: 0.02 }),
    );
    // tokens: meter ahead → 250. cost: local ahead → 0.1.
    expect(resolved).toEqual({ tokens: 250, cost: 0.1 });
  });

  it("keeps the local spend when it is ahead of the meter", async () => {
    const resolved = await Effect.runPromise(
      withMeter({ tokens: 900, cost: 9 }, { tokens: 5, cost: 0.01 }),
    );
    expect(resolved).toEqual({ tokens: 900, cost: 9 });
  });
});
