import { describe, expect, it } from "bun:test";
import type { AgentEvent, PriceSource } from "../src/index.js";
import { addCost, EMPTY_COST_SUM, sumCosts } from "../src/index.js";

type LLMRequestCompleted = Extract<AgentEvent, { _tag: "LLMRequestCompleted" }>;

const base = {
  _tag: "LLMRequestCompleted",
  taskId: "t1",
  requestId: "r1",
  model: "some-unpriced-model",
  provider: "ollama",
  durationMs: 10,
  tokensUsed: 5,
} as const;

describe("LLMRequestCompleted cost honesty", () => {
  it("represents an unknown price as an absent estimatedCost, not 0", () => {
    const unknown: LLMRequestCompleted = { ...base, priceSource: "unknown" };
    expect(unknown.estimatedCost).toBeUndefined();
    expect(unknown.priceSource).toBe("unknown");
  });

  it("carries a known cost with its provenance", () => {
    const priced: LLMRequestCompleted = { ...base, estimatedCost: 0.0012, priceSource: "price-book" };
    expect(priced.estimatedCost).toBe(0.0012);
  });

  it("still accepts a legacy publisher that sets neither field", () => {
    const legacy: LLMRequestCompleted = { ...base };
    expect(legacy.priceSource).toBeUndefined();
  });

  it("PriceSource is the closed four-member union", () => {
    const all: readonly PriceSource[] = ["provider-reported", "price-book", "user", "unknown"];
    expect(all).toHaveLength(4);
    // @ts-expect-error — not a PriceSource member
    const bad: PriceSource = "guessed";
    expect(bad).toBe("guessed");
  });
});

describe("sumCosts", () => {
  it("sums known costs and reports complete", () => {
    const total = sumCosts([0.001, 0.002]);
    expect(total.usd).toBeCloseTo(0.003, 10);
    expect(total.complete).toBe(true);
  });

  it("an unknown price adds nothing and marks the total partial", () => {
    const total = sumCosts([0.001, undefined, 0.002]);
    expect(total.usd).toBeCloseTo(0.003, 10);
    expect(total.complete).toBe(false);
  });

  it("a non-finite reading counts as unknown, not as a number", () => {
    expect(sumCosts([0.5, Number.NaN])).toEqual({ usd: 0.5, complete: false });
  });

  it("an empty input is $0 and complete", () => {
    expect(sumCosts([])).toEqual(EMPTY_COST_SUM);
  });

  it("addCost folds incrementally and stays partial once partial", () => {
    expect(addCost(addCost(EMPTY_COST_SUM, undefined), 0.25)).toEqual({ usd: 0.25, complete: false });
  });
});
