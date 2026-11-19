import { describe, expect, test } from "bun:test";
import {
  addCallCost,
  compareByPrice,
  EMPTY_COST_TOTAL,
  finalRunCostOf,
  foldRunCost,
  formatCostTotal,
  formatModelPrice,
  formatPerMillion,
  isFreePrice,
  llmCallCostOf,
  modelPriceDetail,
  partialCostNote,
  priceSourceLabel,
  type ModelPrice,
} from "../src/index.js";

describe("llmCallCostOf", () => {
  test("a priced call reads its estimatedCost", () => {
    expect(llmCallCostOf({ estimatedCost: 0.012, priceSource: "price-book" })).toBe(0.012);
  });
  test("priceSource unknown is unknown even with a number present", () => {
    expect(llmCallCostOf({ estimatedCost: 0, priceSource: "unknown" })).toBeUndefined();
  });
  test("absent or non-finite estimatedCost is unknown", () => {
    expect(llmCallCostOf({})).toBeUndefined();
    expect(llmCallCostOf({ estimatedCost: Number.NaN })).toBeUndefined();
  });
  test("a legacy payload with a number and no priceSource is known", () => {
    expect(llmCallCostOf({ estimatedCost: 0 })).toBe(0);
  });
});

describe("addCallCost / formatCostTotal", () => {
  test("an unknown call adds nothing and marks the total partial", () => {
    const t = addCallCost(addCallCost(EMPTY_COST_TOTAL, 0.5), undefined);
    expect(t).toEqual({ usd: 0.5, complete: false });
    expect(addCallCost(t, 0.25)).toEqual({ usd: 0.75, complete: false });
  });
  test("complete totals read as the amount; partial as a lower bound", () => {
    expect(formatCostTotal(0.5, true)).toBe("$0.500");
    expect(formatCostTotal(0.5, false)).toBe("≥ $0.500");
    expect(formatCostTotal(0, false)).toBe("price unknown");
    expect(formatCostTotal(0, true)).toBe("$0.00");
    expect(partialCostNote(true)).toBe("");
    expect(partialCostNote(false)).toContain("Partial");
  });
});

describe("foldRunCost", () => {
  test("before RunCostFinalized the total is the provisional per-call sum; AgentCompleted.totalCostUsd is not read", () => {
    let c = foldRunCost(EMPTY_COST_TOTAL, "LLMRequestCompleted", { estimatedCost: 1, priceSource: "price-book" });
    c = foldRunCost(c, "AgentCompleted", { totalCostUsd: 1.2 });
    expect(c).toEqual({ usd: 1, complete: true });
    c = foldRunCost(c, "LLMRequestCompleted", { estimatedCost: 0.3 });
    expect(c.usd).toBeCloseTo(1.3, 10);
  });
  test("RunCostFinalized after AgentCompleted sets the run total (debrief included) and its completeness", () => {
    let c = foldRunCost(EMPTY_COST_TOTAL, "LLMRequestCompleted", { estimatedCost: 1 });
    c = foldRunCost(c, "AgentCompleted", { totalCostUsd: 1 });
    c = foldRunCost(c, "RunCostFinalized", { totalCostUsd: 1.4, costComplete: true });
    expect(c).toEqual({ usd: 1.4, complete: true });
    // A partial final total stays partial, and replaces a larger provisional sum.
    expect(foldRunCost({ usd: 3, complete: true }, "RunCostFinalized", { totalCostUsd: 2, costComplete: false })).toEqual({ usd: 2, complete: false });
    // A final total with no usable number leaves the running figure.
    expect(foldRunCost({ usd: 3, complete: true }, "RunCostFinalized", { costComplete: true })).toEqual({ usd: 3, complete: true });
    expect(finalRunCostOf({ totalCostUsd: 0.5, costComplete: false })).toEqual({ usd: 0.5, complete: false });
  });
  test("framework costComplete:false marks the run partial; other events pass through", () => {
    expect(foldRunCost(EMPTY_COST_TOTAL, "AgentCompleted", { costComplete: false }).complete).toBe(false);
    expect(foldRunCost(EMPTY_COST_TOTAL, "ToolCallCompleted", { estimatedCost: 9 })).toBe(EMPTY_COST_TOTAL);
  });
});

describe("model price display", () => {
  const sonnet: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, source: "litellm", asOf: "2026-11-19" };
  const mini: ModelPrice = { input: 0.15, output: 0.6, source: "official", asOf: "2026-11-01" };
  const local: ModelPrice = { input: 0, output: 0, source: "local" };

  test("$/1M text, local and unknown", () => {
    expect(formatModelPrice(sonnet)).toBe("$3 / $15 per 1M");
    expect(formatModelPrice(mini)).toBe("$0.15 / $0.6 per 1M");
    expect(formatModelPrice(local)).toBe("free (local)");
    expect(formatModelPrice(undefined)).toBe("price unknown");
    expect(formatPerMillion(0.075)).toBe("$0.075");
    expect(formatPerMillion(2.5)).toBe("$2.5");
  });

  test("source label carries the date", () => {
    expect(priceSourceLabel(sonnet)).toBe("LiteLLM price list, as of 2026-11-19");
    expect(priceSourceLabel({ input: 1, output: 2, source: "user" })).toBe("your pricing");
    expect(priceSourceLabel({ input: 1, output: 2, source: "remote" })).toBe("remote price list");
    expect(priceSourceLabel({ input: 1, output: 2, source: "remote", origin: "acme-prices", asOf: "2026-11-19" })).toBe(
      "remote price list (acme-prices), as of 2026-11-19",
    );
  });

  test("sort by cost: cheapest first, unknown last", () => {
    const rows: (ModelPrice | undefined)[] = [undefined, sonnet, mini, local];
    expect([...rows].sort(compareByPrice)).toEqual([local, mini, sonnet, undefined]);
  });

  // Gemma 4 on Gemini: Google lists it "Free of charge" (free tier) with no paid price, so the
  // PriceBook carries $0 / $0. "$0 / $0 per 1M" read like missing data; it is a real price.
  const gemma: ModelPrice = { input: 0, output: 0, source: "official", asOf: "2026-11-19" };

  test("a hosted model priced $0 in and $0 out reads free, distinct from local and unknown", () => {
    expect(isFreePrice(gemma)).toBe(true);
    expect(formatModelPrice(gemma)).toBe("free");
    expect(isFreePrice(local)).toBe(false);
    expect(isFreePrice(undefined)).toBe(false);
    expect(isFreePrice(mini)).toBe(false);
    expect(isFreePrice({ input: 0, output: 0.4, source: "official" })).toBe(false);
    expect(isFreePrice({ input: 0, output: 0, source: "official", tiers: [{ minPromptTokens: 128_001, input: 1 }] })).toBe(false);
  });

  test("price detail explains free, local and unknown prices", () => {
    expect(modelPriceDetail(gemma)).toBe(
      "Free: billed $0 per 1M input and output tokens (free tier; no paid tier price). Source: provider price page, as of 2026-11-19",
    );
    expect(modelPriceDetail(local)).toBe("Free (local): local inference has no per-token bill.");
    expect(modelPriceDetail(undefined)).toBe("Price unknown: the framework has no rate for this model.");
    expect(modelPriceDetail(sonnet)).toBe("$3 / $15 per 1M. Source: LiteLLM price list, as of 2026-11-19");
  });

  test("sort by cost: local and free hosted first, unknown last", () => {
    const rows: (ModelPrice | undefined)[] = [undefined, mini, gemma, local];
    expect([...rows].sort(compareByPrice)).toEqual([local, gemma, mini, undefined]);
  });
});
