import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../src/capability-resolver.js";
import { buildTokenField } from "../src/providers/openai.js";

const fieldFor = (provider: string, model: string): Record<string, unknown> =>
  buildTokenField(resolveCapability(provider, model), 1000, undefined, "medium");

describe("openai token-limit field by model family", () => {
  const reasoning = [
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2-mini",
    "gpt-5-mini-2025-08-07", "gpt-5-chat-latest", "o1", "o1-mini", "o3",
    "o3-mini", "o4-mini", "o4-mini-2025-04-16", "o5-reasoning",
  ];
  for (const m of reasoning) {
    it(`${m} -> max_completion_tokens`, () => {
      const f = fieldFor("openai", m);
      expect(f.max_completion_tokens).toBeDefined();
      expect(f.max_tokens).toBeUndefined();
    });
  }

  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-3.5-turbo", "gpt-4-turbo"]) {
    it(`${m} -> max_tokens`, () => {
      const f = fieldFor("openai", m);
      expect(f.max_tokens).toBeDefined();
      expect(f.max_completion_tokens).toBeUndefined();
    });
  }

  it("non-openai hosts are not affected by id pattern", () => {
    expect(resolveCapability("groq", "o3-like-model").requiresMaxCompletionTokens).toBeUndefined();
    expect(resolveCapability("xai", "gpt-5-mini").requiresMaxCompletionTokens).toBeUndefined();
  });

  it("family rule also applies on top of a cached capability lacking the flag", () => {
    const cap = resolveCapability("openai", "gpt-5-mini", {
      cache: {
        loadCapability: (provider, model) => ({
          ...resolveCapability("openai", "gpt-4o"),
          provider,
          model,
        }),
        saveCapability: () => {},
      },
    });
    expect(cap.requiresMaxCompletionTokens).toBe(true);
  });
});

import { buildTemperatureField } from "../src/providers/openai.js";

describe("openai temperature field by model family", () => {
  it("gpt-5-mini / o4-mini omit temperature", () => {
    expect(buildTemperatureField(resolveCapability("openai", "gpt-5-mini"), undefined, 0.7)).toEqual({});
    expect(buildTemperatureField(resolveCapability("openai", "o4-mini"), undefined, 0.7)).toEqual({});
  });
  it("gpt-4o keeps temperature; thinking reserve omits it", () => {
    expect(buildTemperatureField(resolveCapability("openai", "gpt-4o"), undefined, 0.7)).toEqual({ temperature: 0.7 });
    expect(buildTemperatureField(resolveCapability("openai", "gpt-4o"), 100, 0.7)).toEqual({});
  });
});
