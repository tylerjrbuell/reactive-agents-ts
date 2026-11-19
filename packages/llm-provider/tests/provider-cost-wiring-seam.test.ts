// packages/llm-provider/tests/provider-cost-wiring-seam.test.ts
//
// Adapter -> PriceBook wiring pins (2026-11-19 token-cost accuracy audit):
//   - F8: Anthropic completeStructured() prices with the user registry, like
//     complete()/stream() (it used to drop config.pricingRegistry)
//   - F6: LiteLLM prices prefixed ids through the PriceBook alias map, passes
//     cached tokens, and takes the proxy's x-litellm-response-cost header as
//     a provider-reported cost; an unpriced proxied model reports no cost
//
// Run: bun test packages/llm-provider/tests/provider-cost-wiring-seam.test.ts --timeout 15000

import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { Effect, FiberRef, Layer, Option, Schema } from "effect";
import { StructuredUsageRef } from "../src/structured-parse-retry.js";
import { parseLiteLLMModelInfoPrice } from "../src/providers/litellm-discovery.js";
import type { LLMService as LLMServiceType, TokenUsage } from "../src/index.js";
import { fetchStub } from "./helpers/fetch-stub.js";
import { makeLLMConfig } from "./helpers/llm-config.js";

// Module mocks leak across files: re-install the real SDK afterwards.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

const anthropicCreate = mock(async (_opts: unknown) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  content: [{ type: "tool_use", id: "toolu_1", name: "structured_output", input: { probability: 0.5 } }],
  model: "claude-sonnet-4-6",
  stop_reason: "tool_use",
  usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
}));

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  },
}));

// ─── LiteLLM HTTP double ───

let liteUsage: Record<string, unknown> = {};
let liteCostHeader: string | undefined;

const originalFetch = globalThis.fetch;
const liteFetch = fetchStub(async () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "ok", role: "assistant" }, finish_reason: "stop" }],
      usage: liteUsage,
      model: "proxied",
    }),
    {
      status: 200,
      headers: liteCostHeader === undefined ? {} : { "x-litellm-response-cost": liteCostHeader },
    },
  ),
);

let mod: typeof import("../src/index.js");

beforeAll(async () => {
  globalThis.fetch = liteFetch;
  mod = await import("../src/index.js");
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  liteUsage = {};
  liteCostHeader = undefined;
});

const withConfig = (live: Layer.Layer<LLMServiceType, unknown, unknown>, overrides: Parameters<typeof makeLLMConfig>[0]) =>
  live.pipe(Layer.provide(Layer.succeed(mod.LLMConfig, makeLLMConfig(overrides)))) as Layer.Layer<LLMServiceType>;

describe("F8: Anthropic structured output uses the same pricing", () => {
  it("applies the user registry to completeStructured() usage", async () => {
    const layer = withConfig(mod.AnthropicProviderLive as Layer.Layer<LLMServiceType, unknown, unknown>, {
      defaultProvider: "anthropic",
      defaultModel: "claude-sonnet-4-6",
      anthropicApiKey: "test-key",
      pricingRegistry: { "claude-sonnet-4-6": { input: 1, output: 2 } },
    });
    const usage = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* mod.LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "p?" }],
          outputSchema: Schema.Struct({ probability: Schema.Number }),
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }).pipe(Effect.provide(layer)),
    );
    // 1M in x $1 + 1M out x $2 (registry), not the $3/$15 list price.
    expect(usage?.estimatedCost).toBeCloseTo(3, 9);
    expect(usage?.priceSource).toBe("user");
  });
});

describe("F6: LiteLLM pricing", () => {
  const liteComplete = (model: string): Promise<TokenUsage> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* mod.LLMService;
        const res = yield* llm.complete({ messages: [{ role: "user", content: "hi" }], model });
        return res.usage;
      }).pipe(
        Effect.provide(
          withConfig(mod.LiteLLMProviderLive as Layer.Layer<LLMServiceType, unknown, unknown>, {
            defaultProvider: "litellm",
            defaultModel: model,
          }),
        ),
      ),
    );

  it("prices openai/gpt-4o as OpenAI gpt-4o with cached tokens at the cache rate ($0.02)", async () => {
    liteUsage = { prompt_tokens: 10_000, completion_tokens: 500, total_tokens: 10_500, prompt_tokens_details: { cached_tokens: 8_000 } };
    const usage = await liteComplete("openai/gpt-4o");
    expect(usage.estimatedCost).toBeCloseTo(0.02, 9);
    expect(usage.priceSource).toBe("price-book");
  });

  it("takes x-litellm-response-cost as the provider-reported cost", async () => {
    liteUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    liteCostHeader = "0.00123";
    const usage = await liteComplete("openai/gpt-4o");
    expect(usage.estimatedCost).toBe(0.00123);
    expect(usage.priceSource).toBe("provider-reported");
  });

  it("reports no cost for an unpriced proxied model", async () => {
    liteUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    const usage = await liteComplete("hosted_vllm/my-model");
    expect(usage.estimatedCost).toBeUndefined();
    expect(usage.priceSource).toBe("unknown");
  });
});

describe("LiteLLM /model/info rates", () => {
  it("parses the rates only when every deployment agrees", () => {
    const body = (a: number, b: number) => ({
      data: [
        { model_name: "m", model_info: { input_cost_per_token: a, output_cost_per_token: 2e-6, cache_read_input_token_cost: 1e-7 } },
        { model_name: "m", model_info: { input_cost_per_token: b, output_cost_per_token: 2e-6, cache_read_input_token_cost: 1e-7 } },
      ],
    });
    expect(Option.getOrUndefined(parseLiteLLMModelInfoPrice(body(1e-6, 1e-6), "m"))).toEqual({
      input: 1,
      output: 2,
      cacheRead: 0.1,
    });
    expect(Option.isNone(parseLiteLLMModelInfoPrice(body(1e-6, 3e-6), "m"))).toBe(true);
  });

  it("parses the response-cost header strictly", async () => {
    const { parseLiteLLMResponseCost } = await import("../src/providers/litellm.js");
    expect(parseLiteLLMResponseCost("0.5")).toBe(0.5);
    expect(parseLiteLLMResponseCost(null)).toBeUndefined();
    expect(parseLiteLLMResponseCost("")).toBeUndefined();
    expect(parseLiteLLMResponseCost("NaN")).toBeUndefined();
    expect(parseLiteLLMResponseCost("-1")).toBeUndefined();
  });
});
