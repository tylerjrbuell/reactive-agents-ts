// Provider identity: every layer built by createLLMProviderLayer reports its
// OWN provider name from getModelConfig(). Telemetry (LLMRequestStarted /
// LLMRequestCompleted, cost, model pages) attributes calls by that value, so a
// borrowed name (the test provider used to report "anthropic") misattributes
// every call. Layer build + getModelConfig() make no network call.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { LLMService } from "../src/llm-service.js";
import { createLLMProviderLayer } from "../src/runtime.js";

type ProviderName = Parameters<typeof createLLMProviderLayer>[0];

const reportedProvider = (provider: ProviderName) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      const cfg = yield* llm.getModelConfig();
      return cfg.provider;
    }).pipe(
      Effect.provide(
        createLLMProviderLayer(provider, undefined, undefined, { apiKey: "sk-test-not-used" }),
      ),
    ),
  );

describe("provider identity — getModelConfig().provider names the configured provider", () => {
  const cases: ReadonlyArray<NonNullable<ProviderName>> = [
    "test",
    "anthropic",
    "openai",
    "gemini",
    "litellm",
    "ollama",
    "groq",
    "xai",
  ];

  for (const name of cases) {
    it(`createLLMProviderLayer("${name}") reports provider "${name}"`, async () => {
      expect(await reportedProvider(name)).toBe(name);
    }, 15000);
  }
});
