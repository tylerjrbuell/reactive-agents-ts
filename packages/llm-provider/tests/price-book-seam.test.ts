// packages/llm-provider/tests/price-book-seam.test.ts
//
// PriceBook seam pins (2026-11-19 token-cost accuracy audit,
// wiki/Research/Audit-Reports-2026-11-19/token-cost-accuracy.md):
//   - every "Worked examples" row priced through the adapter normalizer +
//     costFields, exact to 1e-9 against the provider's published bill
//   - unknown model => no estimatedCost and priceSource "unknown" (F1/F5)
//   - user pricing wins; LiteLLM alias lookup (F6a); long-context tiers (F4);
//     per-model cache rates (F2); Anthropic 1h writes + web search (F10)
//   - the snapshot generator is pure and filters/normalizes LiteLLM rows
//
// Run: bun test packages/llm-provider/tests/price-book-seam.test.ts --timeout 15000

import { afterEach, describe, expect, it } from "bun:test";
import { Option } from "effect";
import {
  anthropicBillableUsage,
  costFields,
  geminiBillableUsage,
  LOCAL_COST_FIELDS,
  openAICompatBillableUsage,
  priceUsage,
} from "../src/price-book/price-usage.js";
import {
  _resetReportedPricesForTesting,
  modelIdCandidates,
  priceFor,
  registerReportedPrice,
} from "../src/price-book/price-book.js";
import { buildPriceSnapshot, renderPriceSnapshotModule } from "../src/price-book/snapshot-generator.js";
import { PRICE_SNAPSHOT } from "../src/price-book/snapshot.generated.js";
import { markRemotePricing } from "../src/price-book/schema.js";
import { calculateCost } from "../src/token-counter.js";
import { PROVIDER_DEFAULT_MODELS } from "../src/provider-defaults.js";

/** |actual - expected| < 5e-10 (exact to 1e-9). */
const expectUsd = (actual: number | undefined, expected: number) => {
  expect(actual).toBeDefined();
  expect(actual!).toBeCloseTo(expected, 9);
};

afterEach(() => _resetReportedPricesForTesting());

describe("audit worked examples (golden, exact to 1e-9)", () => {
  // input 2,000; cache_read 50,000; cache_creation 5,000 (5m); output 1,000.
  const anthropicUsage = {
    input_tokens: 2_000,
    output_tokens: 1_000,
    cache_read_input_tokens: 50_000,
    cache_creation_input_tokens: 5_000,
  };

  it("anthropic claude-sonnet-4-6 = $0.05475", () => {
    const c = costFields("anthropic", "claude-sonnet-4-6", anthropicBillableUsage(anthropicUsage));
    expectUsd(c.estimatedCost, 0.05475);
    expect(c.priceSource).toBe("price-book");
  });

  it("anthropic claude-opus-5-5 = $0.063 (was $0.27375 via the opus heuristic)", () => {
    const c = costFields("anthropic", "claude-opus-5-5", anthropicBillableUsage(anthropicUsage));
    expectUsd(c.estimatedCost, 0.063);
  });

  // prompt 60,000 (cached 50,000); completion 3,000 (reasoning 2,000, a subset).
  const gpt54Usage = {
    prompt_tokens: 60_000,
    completion_tokens: 3_000,
    prompt_tokens_details: { cached_tokens: 50_000 },
    completion_tokens_details: { reasoning_tokens: 2_000 },
  };

  it("openai gpt-5.4 = $0.0825 (cached at 0.1x, not 0.5x)", () => {
    expectUsd(costFields("openai", "gpt-5.4", openAICompatBillableUsage(gpt54Usage)).estimatedCost, 0.0825);
  });

  it("openai gpt-6-sol = $0.06", () => {
    expectUsd(costFields("openai", "gpt-6-sol", openAICompatBillableUsage(gpt54Usage)).estimatedCost, 0.06);
  });

  it("gemini gemini-2.5-pro long prompt = $0.475 (>200k tier)", () => {
    const usage = geminiBillableUsage({
      promptTokenCount: 250_000,
      cachedContentTokenCount: 100_000,
      candidatesTokenCount: 2_000,
      thoughtsTokenCount: 3_000,
    });
    expectUsd(costFields("gemini", "gemini-2.5-pro", usage).estimatedCost, 0.475);
  });

  it("gemini gemini-2.5-flash = $0.0185", () => {
    const usage = geminiBillableUsage({ promptTokenCount: 20_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 4_000 });
    expectUsd(costFields("gemini", "gemini-2.5-flash", usage).estimatedCost, 0.0185);
  });

  it("groq openai/gpt-oss-120b (provider default) = $0.0021", () => {
    const usage = openAICompatBillableUsage({ prompt_tokens: 10_000, completion_tokens: 1_000 });
    expectUsd(costFields("groq", PROVIDER_DEFAULT_MODELS.groq!, usage).estimatedCost, 0.0021);
  });

  it("xai grok-4.7 = $0.036", () => {
    const usage = openAICompatBillableUsage({
      prompt_tokens: 30_000,
      completion_tokens: 1_000,
      prompt_tokens_details: { cached_tokens: 20_000 },
    });
    expectUsd(costFields("xai", "grok-4.7", usage).estimatedCost, 0.036);
  });

  it("litellm openai/gpt-4o with cached tokens = $0.02 (was $0.1875)", () => {
    const usage = openAICompatBillableUsage({
      prompt_tokens: 10_000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 8_000 },
    });
    expectUsd(costFields("litellm", "openai/gpt-4o", usage).estimatedCost, 0.02);
  });

  it("ollama (any local model) = $0, a known price", () => {
    expect(LOCAL_COST_FIELDS).toEqual({ estimatedCost: 0, priceSource: "price-book" });
    const usage = openAICompatBillableUsage({ prompt_tokens: 10_000, completion_tokens: 1_000 });
    expect(costFields("ollama", "llama3.2", usage)).toEqual({ estimatedCost: 0, priceSource: "price-book" });
  });
});

describe("honest unknowns (no heuristic, no default price)", () => {
  const usage = openAICompatBillableUsage({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });

  it("an unpriced model has no estimatedCost and priceSource 'unknown'", () => {
    for (const [provider, model] of [
      ["openai", "my-custom-flash-model"],
      ["anthropic", "claude-4-opus-future"],
      ["gemini", "gemini-99-ultra"],
      ["litellm", "hosted_vllm/llama-3-8b"],
    ] as const) {
      expect(costFields(provider, model, usage)).toEqual({ priceSource: "unknown" });
    }
  });

  it("priceUsage without an entry returns no usd", () => {
    expect(priceUsage(usage, undefined)).toEqual({ priceSource: "unknown" });
  });

  it("grok-4 (the old xai default) is not in the price list (reported, not guessed)", () => {
    expect(Option.isNone(priceFor("xai", "grok-4"))).toBe(true);
  });

  it("every cloud provider default model is priced, xai's included", () => {
    expect(PROVIDER_DEFAULT_MODELS.xai).toBe("grok-4.7");
    for (const provider of ["anthropic", "openai", "gemini", "groq", "xai", "litellm"]) {
      expect(Option.isSome(priceFor(provider, PROVIDER_DEFAULT_MODELS[provider]!))).toBe(true);
    }
  });

  it("deprecated calculateCost returns undefined for an unknown model, a number for a known one", () => {
    expect(calculateCost(1_000, 1_000, "unknown-model")).toBeUndefined();
    expectUsd(calculateCost(1_000_000, 1_000_000, "gpt-4o"), 12.5);
    // OpenAI gpt-4o cached at its own 0.5x rate: 400k x 2.5 + 600k x 1.25.
    expectUsd(calculateCost(1_000_000, 0, "gpt-4o", { cached_tokens: 600_000 }), 1.75);
  });
});

describe("resolution order and aliases", () => {
  const usage = openAICompatBillableUsage({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });

  it("user pricing wins over the snapshot and is labeled 'user'", () => {
    const c = costFields("openai", "gpt-4o", usage, { "gpt-4o": { input: 1, output: 2 } });
    expectUsd(c.estimatedCost, 3);
    expect(c.priceSource).toBe("user");
  });

  it("remote rows (origin set) are labeled 'remote' and bill as 'price-book'; user rows stay 'user' and win", () => {
    const remote = markRemotePricing({ "gpt-4o": { input: 1, output: 2 }, "gpt-4.1": { input: 3, output: 4 } }, "https://prices.example/x.json");
    const entry = Option.getOrThrow(priceFor("openai", "gpt-4.1", remote));
    expect(entry.source).toBe("remote");
    expect(entry.origin).toBe("https://prices.example/x.json");
    expect("origin" in Option.getOrThrow(priceFor("openai", "gpt-4o", { "gpt-4o": { input: 1, output: 2 } }))).toBe(false);
    expect(costFields("openai", "gpt-4.1", usage, remote)).toEqual({ estimatedCost: 7, priceSource: "price-book" });
    // The runtime merge: user rows spread last, so they replace remote rows.
    const merged = { ...remote, "gpt-4o": { input: 5, output: 6 } };
    expect(Option.getOrThrow(priceFor("openai", "gpt-4o", merged)).source).toBe("user");
    expect(costFields("openai", "gpt-4o", usage, merged)).toEqual({ estimatedCost: 11, priceSource: "user" });
  });

  it("markRemotePricing keeps an origin a provider already stamped", () => {
    const rows = markRemotePricing({ a: { input: 1, output: 1, origin: "first" }, b: { input: 1, output: 1 } }, "second");
    expect(rows.a!.origin).toBe("first");
    expect(rows.b!.origin).toBe("second");
  });

  it("user pricing wins over a provider-reported bill; the bill wins over the snapshot", () => {
    const registry = { "openai/gpt-4o": { input: 1, output: 2 } };
    expect(costFields("litellm", "openai/gpt-4o", usage, registry, 0.5)).toEqual({ estimatedCost: 3, priceSource: "user" });
    expect(costFields("litellm", "openai/gpt-4o", usage, undefined, 0.5)).toEqual({
      estimatedCost: 0.5,
      priceSource: "provider-reported",
    });
  });

  it("user pricing without cache rates bills cached tokens at its input rate", () => {
    const cached = openAICompatBillableUsage({ prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 500_000 } });
    expectUsd(costFields("openai", "gpt-4o", cached, { "gpt-4o": { input: 2, output: 8 } }).estimatedCost, 2);
    expectUsd(costFields("openai", "gpt-4o", cached, { "gpt-4o": { input: 2, output: 8, cacheRead: 0.2 } }).estimatedCost, 1.1);
  });

  it("proxy-stated rates (/model/info) beat the snapshot for that LiteLLM model name", () => {
    registerReportedPrice("litellm", "my-deployment", { input: 0.5, output: 1 });
    const c = costFields("litellm", "my-deployment", usage);
    expectUsd(c.estimatedCost, 1.5);
    expect(c.priceSource).toBe("price-book");
  });

  it("strips provider prefixes and dashes Anthropic's dotted versions", () => {
    expect(modelIdCandidates("anthropic", "anthropic/claude-sonnet-4.6")).toContain("claude-sonnet-4-6");
    expect(Option.getOrThrow(priceFor("anthropic", "claude-sonnet-4.6")).input).toBe(3);
    expect(Option.getOrThrow(priceFor("gemini", "models/gemini-2.5-flash")).input).toBe(0.3);
    expect(Option.getOrThrow(priceFor("litellm", "gemini/gemini-2.5-pro")).input).toBe(1.25);
    expect(Option.getOrThrow(priceFor("litellm", "anthropic/claude-opus-5-5")).input).toBe(4);
    expect(Option.getOrThrow(priceFor("litellm", "groq/openai/gpt-oss-120b")).input).toBe(0.15);
    expect(Option.getOrThrow(priceFor("litellm", "gpt-4o")).input).toBe(2.5);
    expect(Option.getOrThrow(priceFor("litellm", "ollama/llama3")).source).toBe("local");
  });

  it("does not strip date suffixes (a dated snapshot may be priced differently)", () => {
    expect(Option.getOrThrow(priceFor("openai", "gpt-4o-2024-08-06")).input).toBe(2.5);
    expect(Option.isNone(priceFor("openai", "gpt-4o-2099-01-01"))).toBe(true);
  });
});

describe("per-model rates the old multipliers got wrong", () => {
  it("long-context tier boundary: 200,000 prompt tokens is base, 200,001 is the tier (gemini-2.5-pro)", () => {
    const at = (prompt: number) =>
      costFields("gemini", "gemini-2.5-pro", geminiBillableUsage({ promptTokenCount: prompt, candidatesTokenCount: 0 })).estimatedCost;
    expectUsd(at(200_000), 0.25);
    expectUsd(at(200_001), (200_001 * 2.5) / 1e6);
  });

  it("anthropic haiku 5.5 >100k tier counts cache reads and writes in the prompt size", () => {
    const usage = anthropicBillableUsage({
      input_tokens: 1_000,
      output_tokens: 1_000,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 0,
    });
    // Tier rates: input 0.5, output 2.5, cache read 0.05.
    expectUsd(costFields("anthropic", "claude-haiku-5-5", usage).estimatedCost, (1_000 * 0.5 + 1_000 * 2.5 + 100_000 * 0.05) / 1e6);
  });

  it("anthropic 1h cache writes bill at the 1h rate; web searches per request", () => {
    const usage = anthropicBillableUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 3_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 2_000 },
      server_tool_use: { web_search_requests: 3 },
    });
    expect(usage.cacheWrite5m).toBe(1_000);
    expect(usage.cacheWrite1h).toBe(2_000);
    // sonnet-4-6: 5m $3.75, 1h $6, search $0.01 each.
    expectUsd(costFields("anthropic", "claude-sonnet-4-6", usage).estimatedCost, (1_000 * 3.75 + 2_000 * 6) / 1e6 + 0.03);
  });

  it("gemini toolUsePromptTokenCount bills as input; audio prompt tokens at the audio rate", () => {
    const usage = geminiBillableUsage({
      promptTokenCount: 1_000,
      candidatesTokenCount: 0,
      toolUsePromptTokenCount: 500,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 600 }, { modality: "AUDIO", tokenCount: 400 }],
    });
    expect(usage.inputUncached).toBe(1_100);
    expect(usage.inputAudio).toBe(400);
    const entry = Option.getOrThrow(priceFor("gemini", "gemini-2.5-flash"));
    expect(entry.inputAudio).toBeDefined();
    expectUsd(priceUsage(usage, entry).usd, (1_100 * 0.3 + 400 * entry.inputAudio!) / 1e6);
  });
});

describe("snapshot generator (pure)", () => {
  const fixture = {
    "claude-x-1": {
      litellm_provider: "anthropic",
      mode: "chat",
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      cache_read_input_token_cost: 3e-7,
      cache_creation_input_token_cost: 3.75e-6,
      cache_creation_input_token_cost_above_1hr: 6e-6,
      search_context_cost_per_query: { search_context_size_medium: 0.01 },
    },
    "gemini/g-pro": {
      litellm_provider: "gemini",
      mode: "chat",
      input_cost_per_token: 1.25e-6,
      output_cost_per_token: 1e-5,
      input_cost_per_token_above_200k_tokens: 2.5e-6,
      output_cost_per_token_above_200k_tokens: 1.5e-5,
    },
    "g-pro": { litellm_provider: "gemini", mode: "chat", input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 },
    "old-model": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6, deprecation_date: "2026-01-01" },
    "ft:gpt-x": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
    "dall-e": { litellm_provider: "openai", mode: "image_generation", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
    "bedrock/claude": { litellm_provider: "bedrock", mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
  };

  it("filters, strips prefixes (prefixed row wins), converts to $/1M and builds tiers", () => {
    const snap = buildPriceSnapshot(fixture, "2026-11-19", "https://example.test/prices.json");
    expect(Object.keys(snap.rows)).toEqual(["anthropic:claude-x-1", "gemini:g-pro"]);
    expect(snap.rows["anthropic:claude-x-1"]).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
      perRequest: { webSearch: 0.01 },
    });
    expect(snap.rows["gemini:g-pro"]).toEqual({
      input: 1.25,
      output: 10,
      tiers: [{ minPromptTokens: 200_001, input: 2.5, output: 15 }],
    });
    expect(snap.sourceUrl).toBe("https://example.test/prices.json");
  });

  it("renders a module that names its source and date", () => {
    const text = renderPriceSnapshotModule(buildPriceSnapshot(fixture, "2026-11-19"));
    expect(text).toContain('asOf: "2026-11-19"');
    expect(text).toContain('"gemini:g-pro": {"input":1.25');
  });

  it("the committed snapshot is dated and sourced from LiteLLM", () => {
    expect(PRICE_SNAPSHOT.asOf).toBe("2026-11-19");
    expect(PRICE_SNAPSHOT.sourceUrl).toContain("model_prices_and_context_window.json");
    expect(Object.keys(PRICE_SNAPSHOT.rows).length).toBeGreaterThan(100);
  });
});
