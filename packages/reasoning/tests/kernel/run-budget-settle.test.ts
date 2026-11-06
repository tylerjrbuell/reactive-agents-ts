// Pins the run meter's settled rule: once the runtime settles a run's spend,
// later LLM calls (e.g. the forked debrief synthesis) must not add to it.
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  addRunSpend,
  applyRunSpend,
  isRunMeterSettled,
  makeRunBudgetMeter,
  settleRunMeter,
  withRunBudgetMeter,
} from "../../src/kernel/run-budget.js";

const spend = { tokens: 100, cost: 0.5, inputTokens: 60, outputTokens: 40, llmCalls: 1 };

describe("run budget meter — settled", () => {
  test("spend before settle is counted", () => {
    const meter = makeRunBudgetMeter();
    applyRunSpend(meter, spend);
    expect(meter.tokens).toBe(100);
    expect(isRunMeterSettled(meter)).toBe(false);
  });

  test("applyRunSpend after settleRunMeter adds nothing", () => {
    const meter = makeRunBudgetMeter();
    applyRunSpend(meter, spend);
    settleRunMeter(meter);
    applyRunSpend(meter, spend);
    expect(isRunMeterSettled(meter)).toBe(true);
    expect(meter).toMatchObject({ tokens: 100, cost: 0.5, inputTokens: 60, outputTokens: 40, llmCalls: 1 });
  });

  test("ambient addRunSpend after settle adds nothing", async () => {
    const meter = makeRunBudgetMeter();
    await Effect.runPromise(
      withRunBudgetMeter(
        Effect.gen(function* () {
          yield* addRunSpend(spend);
          settleRunMeter(meter);
          yield* addRunSpend(spend);
        }),
        meter,
      ),
    );
    expect(meter.tokens).toBe(100);
    expect(meter.llmCalls).toBe(1);
  });

  test("a meter built as a literal is unsettled until settled", () => {
    const meter = { tokens: 0, cost: 0 };
    applyRunSpend(meter, { tokens: 5, cost: 0 });
    settleRunMeter(meter);
    applyRunSpend(meter, { tokens: 5, cost: 0 });
    expect(meter.tokens).toBe(5);
  });
});
