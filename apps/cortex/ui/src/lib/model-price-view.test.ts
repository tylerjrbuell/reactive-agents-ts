import { describe, expect, test } from "bun:test";
import type { ModelPrice } from "@reactive-agents/ui-core";
import { priceStats, sortModelList } from "./model-page.js";
import { modelRowDetail } from "./chat-menu-items.js";

const sonnet: ModelPrice = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  tiers: [{ minPromptTokens: 200_001, input: 6, output: 22.5 }],
  source: "litellm",
  asOf: "2026-11-19",
};
const mini: ModelPrice = { input: 0.15, output: 0.6, source: "official", asOf: "2026-11-01" };
const local: ModelPrice = { input: 0, output: 0, source: "local" };

describe("model page price card", () => {
  test("input, output, cache read and the long-context tier in $/1M with the source", () => {
    const items = priceStats(sonnet);
    expect(items.map((i) => [i.label, i.value])).toEqual([
      ["Input", "$3 / 1M"],
      ["Output", "$15 / 1M"],
      ["Cache read", "$0.3 / 1M"],
      ["Prompt over 200k", "$6 / $22.5"],
    ]);
    expect(items[0]?.title).toContain("LiteLLM price list, as of 2026-11-19");
  });

  test("unknown and local prices have no stats (the card says so in words)", () => {
    expect(priceStats(undefined)).toEqual([]);
    expect(priceStats(local)).toEqual([]);
  });

  test("sort by price: cheapest first, unknown last; default keeps the provider order", () => {
    const rows = [{ value: "s", price: sonnet }, { value: "u" }, { value: "m", price: mini }, { value: "l", price: local }];
    expect(sortModelList(rows, "price").map((r) => r.value)).toEqual(["l", "m", "s", "u"]);
    expect(sortModelList(rows, "default").map((r) => r.value)).toEqual(["s", "u", "m", "l"]);
  });
});

describe("chat model rows", () => {
  test("detail carries the $/1M price, free for local, price unknown when absent", () => {
    expect(modelRowDetail({ value: "claude-x", label: "Claude X", price: sonnet })).toBe("claude-x · $3 / $15 per 1M");
    expect(modelRowDetail({ value: "qwen3:4b", label: "qwen3:4b", price: local })).toBe("free (local)");
    expect(modelRowDetail({ value: "mystery", label: "mystery" })).toBe("price unknown");
  });
});
