// Run: bun test packages/llm-provider/tests/capability-unknown-model-seam.test.ts --timeout 15000
//
// Seam pins for how an unknown model adapts without a static row:
//   - provisional hosted window (src/capability-provisional.ts)
//   - Anthropic GET /v1/models/{id} discovery (src/providers/anthropic-discovery.ts)
//   - LiteLLM /model/info discovery (src/providers/litellm-discovery.ts)
//   - limits learned from provider errors (src/capability-learned.ts, wired in
//     src/provider-error.ts mapProviderError)
//   - one in-flight discovery per (provider, model) (src/capability-discovery.ts)
// No network: every request goes through an injected fetch.

import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Effect, Option } from "effect";
import { primeCapability } from "../src/capability-prime.js";
import {
  discoverCapability,
  registerCapabilityDiscoverer,
  _resetCapabilityDiscoverersForTesting,
  type DiscoveredCapability,
} from "../src/capability-discovery.js";
import {
  describeCapabilityResolution,
  resolveCapability,
  _resetProbedRegistryForTesting,
} from "../src/capability-resolver.js";
import {
  registerReportedModelMetadata,
  reportedModelMetadataFor,
  _resetReportedMetadataForTesting,
} from "../src/capability-reported.js";
import { HOSTED_PROVISIONAL_CONTEXT_TOKENS } from "../src/capability-provisional.js";
import { makeAnthropicCapabilityDiscoverer } from "../src/providers/anthropic-discovery.js";
import { makeLiteLLMCapabilityDiscoverer, parseLiteLLMModelInfo } from "../src/providers/litellm-discovery.js";
import type { DiscoveryFetch } from "../src/providers/discovery-common.js";
import {
  learnedCapabilityLimitFor,
  parseStatedLimit,
  _resetLearnedLimitsForTesting,
} from "../src/capability-learned.js";
import { mapProviderError } from "../src/provider-error.js";

afterEach(() => {
  _resetCapabilityDiscoverersForTesting();
  _resetReportedMetadataForTesting();
  _resetProbedRegistryForTesting();
  _resetLearnedLimitsForTesting();
});

/** A fetch stand-in that records each request and answers `body` with `status`. */
const stubFetch = (body: unknown, status = 200) => {
  const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
  const fetchImpl: DiscoveryFetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
};

describe("provisional hosted window", () => {
  it.each(["anthropic", "openai", "gemini"])(
    "%s: an unknown model gets the hosted window with native tools, flagged provisional",
    (provider) => {
      const cap = resolveCapability(provider, "zz-unknown-9");
      expect(cap.recommendedNumCtx).toBe(HOSTED_PROVISIONAL_CONTEXT_TOKENS);
      expect(cap.maxContextTokens).toBe(128_000);
      expect(cap.recommendedNumCtx).not.toBe(2048);
      expect(cap.toolCallDialect).toBe("native-fc");
      expect(cap.provisional).toBe(true);
      // Still a guess: PreFlight, the output clamp and the tier lookup see "fallback".
      expect(cap.source).toBe("fallback");
      expect(describeCapabilityResolution(cap).provisional).toBe(true);
    },
  );

  it("groq/xai keep their 131,072 window and are flagged provisional", () => {
    expect(resolveCapability("groq", "zz-unknown").recommendedNumCtx).toBe(131_072);
    expect(resolveCapability("xai", "zz-unknown").provisional).toBe(true);
  });

  it("a local provider keeps the 2048 local fallback, not provisional", () => {
    const cap = resolveCapability("ollama", "zz-unknown:1b");
    expect(cap.recommendedNumCtx).toBe(2048);
    expect(cap.toolCallDialect).toBe("none");
    expect(cap.provisional).toBeUndefined();
    // Omitted (not false), so the capability-resolved trace key set is unchanged.
    expect("provisional" in describeCapabilityResolution(cap)).toBe(false);
  });

  it("litellm with discovery none keeps the 2048 local fallback (a proxied local model truncates silently)", async () => {
    registerCapabilityDiscoverer("litellm", () => Effect.succeed(Option.none<DiscoveredCapability>()));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("litellm", "zz-proxied-local");
      expect(warn.mock.calls.some((c) => String(c[0]).includes("litellm/zz-proxied-local"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    const cap = resolveCapability("litellm", "zz-proxied-local");
    expect(cap.recommendedNumCtx).toBe(2048);
    expect(cap.toolCallDialect).toBe("none");
    expect(cap.provisional).toBeUndefined();
    expect(cap.source).toBe("fallback");
  });

  it("a static row is untouched", () => {
    const cap = resolveCapability("openai", "gpt-4o");
    expect(cap.source).toBe("static-table");
    expect(cap.provisional).toBeUndefined();
  });

  it("a reported window or a declared numCtx drops the provisional marker", () => {
    expect(resolveCapability("openai", "zz-a", { userNumCtx: 50_000 }).provisional).toBeUndefined();
    registerReportedModelMetadata("openai", "zz-b", { maxContextTokens: 300_000 });
    const cap = resolveCapability("openai", "zz-b");
    expect(cap.source).toBe("inferred");
    expect(cap.provisional).toBeUndefined();
  });
});

const ANTHROPIC_INFO = {
  type: "model",
  id: "claude-zz-9",
  display_name: "Claude ZZ 9",
  max_input_tokens: 500_000,
  max_tokens: 96_000,
  capabilities: { image_input: { supported: true }, thinking: { supported: true } },
};

describe("Anthropic discovery (GET /v1/models/{id})", () => {
  it("an unknown id resolves to the reported limits", async () => {
    const { calls, fetchImpl } = stubFetch(ANTHROPIC_INFO);
    registerCapabilityDiscoverer("anthropic", makeAnthropicCapabilityDiscoverer(fetchImpl));

    await primeCapability("anthropic", "claude-zz-9", { apiKey: "sk-test" });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models/claude-zz-9");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-test");
    expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    const cap = resolveCapability("anthropic", "claude-zz-9");
    expect(cap.source).toBe("inferred");
    expect(cap.maxContextTokens).toBe(500_000);
    expect(cap.maxOutputTokens).toBe(96_000);
    expect(cap.supportsVision).toBe(true);
    expect(cap.supportsThinkingMode).toBe(true);
    expect(cap.toolCallDialect).toBe("native-fc");
  });

  it("asks nothing for a static row or without a key", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const { calls, fetchImpl } = stubFetch(ANTHROPIC_INFO);
      registerCapabilityDiscoverer("anthropic", makeAnthropicCapabilityDiscoverer(fetchImpl));
      await primeCapability("anthropic", "claude-opus-5-5", { apiKey: "k" });
      await primeCapability("anthropic", "claude-zz-nokey");
      expect(calls.length).toBe(0);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("a 404 keeps the provisional window", async () => {
    const { fetchImpl } = stubFetch({ type: "error" }, 404);
    registerCapabilityDiscoverer("anthropic", makeAnthropicCapabilityDiscoverer(fetchImpl));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("anthropic", "claude-zz-404", { apiKey: "k" });
    } finally {
      warn.mockRestore();
    }
    const cap = resolveCapability("anthropic", "claude-zz-404");
    expect(cap.provisional).toBe(true);
    expect(cap.recommendedNumCtx).toBe(128_000);
  });
});

const LITELLM_INFO = {
  data: [
    {
      model_name: "team-model",
      litellm_params: { model: "anthropic/claude-x" },
      model_info: { max_input_tokens: 200_000, max_output_tokens: 64_000, supports_vision: true, supports_reasoning: true },
    },
    {
      model_name: "team-model",
      litellm_params: { model: "openai/gpt-x" },
      model_info: { max_input_tokens: 128_000, max_output_tokens: null, supports_vision: true, supports_reasoning: false },
    },
    { model_name: "other", model_info: { max_input_tokens: 8_000 } },
  ],
};

describe("LiteLLM discovery (/model/info)", () => {
  it("parses the smallest window across a model_name's deployments; flags only when all agree", () => {
    const meta = Option.getOrThrow(parseLiteLLMModelInfo(LITELLM_INFO, "team-model"));
    expect(meta).toEqual({ maxContextTokens: 128_000, maxOutputTokens: 64_000, supportsVision: true });
    expect(Option.isNone(parseLiteLLMModelInfo(LITELLM_INFO, "absent"))).toBe(true);
    expect(Option.isNone(parseLiteLLMModelInfo({ nope: 1 }, "team-model"))).toBe(true);
  });

  it("queries the configured endpoint and feeds the reported tier", async () => {
    const { calls, fetchImpl } = stubFetch(LITELLM_INFO);
    registerCapabilityDiscoverer("litellm", makeLiteLLMCapabilityDiscoverer(fetchImpl));

    await primeCapability("litellm", "team-model", { endpoint: "http://proxy:4000/", apiKey: "sk-l" });

    expect(calls[0]?.url).toBe("http://proxy:4000/model/info");
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-l");
    const cap = resolveCapability("litellm", "team-model");
    expect(cap.source).toBe("inferred");
    expect(cap.maxContextTokens).toBe(128_000);
    expect(cap.toolCallDialect).toBe("native-fc");
  });
});

describe("limits learned from provider errors", () => {
  it("parses each provider's stated limit", () => {
    expect(parseStatedLimit("anthropic", "prompt is too long: 213462 tokens > 200000 maximum")).toEqual({
      kind: "context-window",
      tokens: 200_000,
    });
    expect(
      parseStatedLimit(
        "openai",
        "This model's maximum context length is 32,768 tokens. However, you requested 40000 tokens.",
      ),
    ).toEqual({ kind: "context-window", tokens: 32_768 });
    expect(
      parseStatedLimit(
        "gemini",
        "The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).",
      ),
    ).toEqual({ kind: "context-window", tokens: 1_048_576 });
    expect(
      parseStatedLimit(
        "anthropic",
        "max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens for claude-x",
      ),
    ).toEqual({ kind: "max-output", tokens: 64_000 });
    expect(parseStatedLimit("openai", "Rate limit reached. Limit 8000, Requested 8122")).toBeUndefined();
  });

  it("a context-length error updates the resolved capability and carries the learned limit", () => {
    expect(resolveCapability("openai", "gpt-zz-new").recommendedNumCtx).toBe(128_000);

    const err = mapProviderError(
      {
        status: 400,
        code: "context_length_exceeded",
        message: "This model's maximum context length is 64000 tokens. However, your messages resulted in 70000 tokens.",
      },
      "openai",
      "gpt-zz-new",
    );

    expect(err._tag).toBe("LLMContextOverflowError");
    expect(err._tag === "LLMContextOverflowError" ? err.learnedLimit : undefined).toEqual({
      kind: "context-window",
      tokens: 64_000,
    });
    const cap = resolveCapability("openai", "gpt-zz-new");
    expect(cap.recommendedNumCtx).toBe(64_000);
    expect(cap.maxContextTokens).toBe(64_000);
    expect(cap.source).toBe("inferred");
    expect(cap.provisional).toBeUndefined();
    expect(learnedCapabilityLimitFor("openai", "gpt-zz-new")).toEqual([
      { provider: "openai", model: "gpt-zz-new", kind: "context-window", tokens: 64_000 },
    ]);
  });

  it("an Anthropic overflow updates its model too", () => {
    mapProviderError(
      { status: 400, message: "prompt is too long: 250000 tokens > 200000 maximum" },
      "anthropic",
      "claude-zz-1",
    );
    expect(resolveCapability("anthropic", "claude-zz-1").recommendedNumCtx).toBe(200_000);
  });

  it("an output-limit error records maxOutputTokens without inventing a window", () => {
    const err = mapProviderError(
      {
        status: 400,
        message: "max_tokens is too large: 50000. This model supports at most 16384 completion tokens, whereas you provided 50000.",
      },
      "openai",
      "gpt-zz-out",
    );
    expect(err._tag === "LLMError" ? err.learnedLimit : undefined).toEqual({ kind: "max-output", tokens: 16_384 });
    expect(reportedModelMetadataFor("openai", "gpt-zz-out")).toEqual({ maxOutputTokens: 16_384 });
    expect(resolveCapability("openai", "gpt-zz-out").provisional).toBe(true);
  });

  it("a per-minute budget, a missing model or a static row learns nothing that changes resolution", () => {
    mapProviderError(
      {
        status: 429,
        message: "Request too large for model `m` on tokens per minute (TPM): Limit 8000, Requested 9000",
      },
      "groq",
      "zz-tpm",
    );
    expect(reportedModelMetadataFor("groq", "zz-tpm")).toBeUndefined();
    const noModel = mapProviderError(
      { status: 400, message: "maximum context length is 1000 tokens" },
      "openai",
    );
    expect(noModel._tag === "LLMContextOverflowError" ? noModel.learnedLimit : "x").toBeUndefined();
    mapProviderError({ status: 400, message: "maximum context length is 1000 tokens" }, "openai", "gpt-4o");
    expect(resolveCapability("openai", "gpt-4o").recommendedNumCtx).toBe(128_000);
    expect(resolveCapability("openai", "gpt-4o").source).toBe("static-table");
  });
});

describe("concurrent discovery", () => {
  it("concurrent primes of one model issue one request and all see the answer", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    registerCapabilityDiscoverer("openai", () =>
      Effect.promise(async () => {
        calls += 1;
        await gate;
        return Option.some<DiscoveredCapability>({ _tag: "Reported", metadata: { maxContextTokens: 777_000 } });
      }),
    );

    const runs = [
      Effect.runPromise(discoverCapability("openai", "gpt-zz-race")),
      Effect.runPromise(discoverCapability("openai", "gpt-zz-race")),
      primeCapability("openai", "gpt-zz-race"),
    ];
    release();
    const [a, b] = await Promise.all(runs);

    expect(calls).toBe(1);
    expect(Option.isSome(a as Option.Option<DiscoveredCapability>)).toBe(true);
    expect(Option.isSome(b as Option.Option<DiscoveredCapability>)).toBe(true);
    expect(resolveCapability("openai", "gpt-zz-race").maxContextTokens).toBe(777_000);
  });

  it("a later discovery after the first one finished asks again (no stale in-flight entry)", async () => {
    let calls = 0;
    registerCapabilityDiscoverer("openai", () =>
      Effect.sync(() => {
        calls += 1;
        return Option.none<DiscoveredCapability>();
      }),
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCapability("openai", "gpt-zz-again");
      await primeCapability("openai", "gpt-zz-again");
    } finally {
      warn.mockRestore();
    }
    expect(calls).toBe(2);
  });

  it("an interrupted first discovery releases waiters with none", async () => {
    registerCapabilityDiscoverer("openai", () => Effect.never);
    const out = await Effect.runPromise(
      Effect.all(
        [
          discoverCapability("openai", "gpt-zz-hang", { timeoutMs: 20 }),
          discoverCapability("openai", "gpt-zz-hang", { timeoutMs: 20 }),
        ],
        { concurrency: "unbounded" },
      ),
    );
    expect(out.every(Option.isNone)).toBe(true);
  });
});
