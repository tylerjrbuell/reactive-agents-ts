// Run: bun test packages/llm-provider/tests/capability-discovery.test.ts --timeout 15000
//
// Seam pins for the per-provider capability-discovery hook
// (src/capability-discovery.ts) and its first hosted implementation, Gemini
// models.get (src/providers/gemini-discovery.ts). Origin: Cortex trace
// 01M7TERZAVP2RS489WEBJ3HY7H, where gemini-4-carbon resolved to the 2048-token
// fallback and the run looped on recall until it ended without an answer.

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Effect, Option } from "effect";
import { primeCapability } from "../src/capability-prime.js";
import {
  capabilityDiscovererFor,
  discoverCapability,
  registerCapabilityDiscoverer,
  _resetCapabilityDiscoverersForTesting,
} from "../src/capability-discovery.js";
import {
  makeGeminiCapabilityDiscoverer,
  type GeminiModelGet,
  type GeminiModelInfo,
} from "../src/providers/gemini-discovery.js";
import { resolveCapability, _resetProbedRegistryForTesting } from "../src/capability-resolver.js";
import { _resetReportedMetadataForTesting } from "../src/capability-reported.js";

afterEach(() => {
  _resetCapabilityDiscoverersForTesting();
  _resetReportedMetadataForTesting();
  _resetProbedRegistryForTesting();
});

/** A models.get stand-in that records each request. */
const stubGet = (answer: () => Promise<GeminiModelInfo>) => {
  const calls: { apiKey: string; model: string }[] = [];
  const get: GeminiModelGet = (req) => {
    calls.push({ apiKey: req.apiKey, model: req.model });
    return answer();
  };
  registerCapabilityDiscoverer("gemini", makeGeminiCapabilityDiscoverer(get));
  return calls;
};

const REPORT: GeminiModelInfo = { inputTokenLimit: 2_097_152, outputTokenLimit: 65_536, thinking: true };

describe("Gemini discovery (models.get)", () => {
  it("an id the table and family rule cannot place resolves to the reported limits", async () => {
    const calls = stubGet(async () => REPORT);
    expect(resolveCapability("gemini", "gemini-9-zinc").source).toBe("fallback");

    await primeCapability("gemini", "gemini-9-zinc", { apiKey: "k-1" });

    const cap = resolveCapability("gemini", "gemini-9-zinc");
    expect(calls).toEqual([{ apiKey: "k-1", model: "gemini-9-zinc" }]);
    expect(cap.source).toBe("inferred");
    expect(cap.maxContextTokens).toBe(2_097_152);
    expect(cap.recommendedNumCtx).toBe(2_097_152);
    expect(cap.maxOutputTokens).toBe(65_536);
    expect(cap.supportsThinkingMode).toBe(true);
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.tier).not.toBe("local");
  });

  it("asks once: a second prime and every synchronous resolve reuse the answer", async () => {
    const calls = stubGet(async () => REPORT);
    await primeCapability("gemini", "gemini-9-neon", { apiKey: "k" });
    await primeCapability("gemini", "gemini-9-neon", { apiKey: "k" });
    for (let i = 0; i < 5; i++) resolveCapability("gemini", "gemini-9-neon");
    expect(calls.length).toBe(1);
  });

  it("strips the models/ prefix before asking", async () => {
    const calls = stubGet(async () => REPORT);
    await primeCapability("gemini", "models/gemini-9-xenon", { apiKey: "k" });
    expect(calls[0]?.model).toBe("gemini-9-xenon");
  });

  it("a failed models.get keeps the fallback and warns once", async () => {
    stubGet(() => Promise.reject("fetch failed"));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("gemini", "gemini-9-radon", { apiKey: "k" });
      await primeCapability("gemini", "gemini-9-radon", { apiKey: "k" });
      expect(resolveCapability("gemini", "gemini-9-radon").source).toBe("fallback");
      const fallbackWarnings = warn.mock.calls.filter((c) =>
        String(c[0]).includes("Capability fallback fired for gemini/gemini-9-radon"),
      );
      expect(fallbackWarnings.length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("a hung models.get is cut at the timeout and keeps the fallback", async () => {
    stubGet(() => new Promise<GeminiModelInfo>(() => {}));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const started = Date.now();
      await primeCapability("gemini", "gemini-9-krypton", { apiKey: "k", timeoutMs: 50 });
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(resolveCapability("gemini", "gemini-9-krypton").source).toBe("fallback");
    } finally {
      warn.mockRestore();
    }
  });

  it("a report without a window is not a capability (fallback stays)", async () => {
    stubGet(async () => ({ outputTokenLimit: 8_192 }));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("gemini", "gemini-9-argon2", { apiKey: "k" });
      expect(resolveCapability("gemini", "gemini-9-argon2").source).toBe("fallback");
    } finally {
      warn.mockRestore();
    }
  });

  it("Gemma keeps the no-thinking rule even when models.get reports thinking", async () => {
    stubGet(async () => ({ inputTokenLimit: 131_072, outputTokenLimit: 16_384, thinking: true }));
    await primeCapability("gemini", "gemma-9-12b-it", { apiKey: "k" });
    const cap = resolveCapability("gemini", "gemma-9-12b-it");
    expect(cap.maxContextTokens).toBe(131_072);
    expect(cap.supportsThinkingMode).toBe(false);
  });

  it("a static row overrides discovery: models.get is not called", async () => {
    const calls = stubGet(async () => REPORT);
    await primeCapability("gemini", "gemini-2.5-pro", { apiKey: "k" });
    expect(calls.length).toBe(0);
    expect(resolveCapability("gemini", "gemini-2.5-pro").source).toBe("static-table");
  });

  it("no API key: models.get is not called", async () => {
    const saved = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const calls = stubGet(async () => REPORT);
      await primeCapability("gemini", "gemini-9-helium");
      expect(calls.length).toBe(0);
    } finally {
      warn.mockRestore();
      if (saved !== undefined) process.env.GOOGLE_API_KEY = saved;
    }
  });
});

describe("discovery hook registry", () => {
  it("ships discoverers for ollama and gemini; providers without one are a no-op", async () => {
    expect(capabilityDiscovererFor("gemini")).toBeDefined();
    expect(capabilityDiscovererFor("ollama")).toBeDefined();
    expect(capabilityDiscovererFor("anthropic")).toBeUndefined();
    const out = await Effect.runPromise(discoverCapability("anthropic", "claude-x"));
    expect(Option.isNone(out)).toBe(true);
  });

  it("a registered discoverer feeds the reported tier for its provider", async () => {
    registerCapabilityDiscoverer("openai", () =>
      Effect.succeed(Option.some({ _tag: "Reported" as const, metadata: { maxContextTokens: 400_000 } })),
    );
    await primeCapability("openai", "gpt-9-test");
    const cap = resolveCapability("openai", "gpt-9-test");
    expect(cap.source).toBe("inferred");
    expect(cap.recommendedNumCtx).toBe(400_000);
  });

  it("a discoverer that dies is absorbed: prime never throws", async () => {
    registerCapabilityDiscoverer("openai", () => Effect.die("boom"));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("openai", "gpt-9-dies");
      expect(resolveCapability("openai", "gpt-9-dies").source).toBe("fallback");
    } finally {
      warn.mockRestore();
    }
  });
});
