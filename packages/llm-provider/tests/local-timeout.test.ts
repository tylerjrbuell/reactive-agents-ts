// Run: bun test packages/llm-provider/tests/local-timeout.test.ts --timeout 15000
//
// 2026-07-01 audit hardening — the local (Ollama) provider previously hardcoded
// `Effect.timeout('120 seconds')` and emitted a bare "Local LLM request timed
// out". This suite pins:
//   (1) the per-call timeout is CONFIGURABLE (request.timeoutMs → ollamaTimeoutMs)
//       and the wired value is the one actually applied,
//   (2) the timeout error carries model + elapsedMs + a cold-load/GPU hint,
//   (3) on client timeout the in-flight HTTP request's AbortSignal fires,
//   (4) provider error mapping de-duplicates raw JSON to one clean line with a
//       one-line string cause (no leaked stack).

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Effect, Layer, Exit, Cause } from "effect";

// ─── Mock the `ollama` package BEFORE the provider module is imported ───

// A chat that never resolves — forces Effect.timeout to fire. Part C's mock
// (installed per-test) additionally drives the injected fetch to observe abort.
let chatImpl: (opts: unknown) => Promise<unknown> = () =>
  new Promise<never>(() => {
    /* hang */
  });
let capturedFetch: typeof fetch | undefined;

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(opts?: { fetch?: typeof fetch }) {
      capturedFetch = opts?.fetch;
    }
    chat = (opts: unknown) => chatImpl(opts);
    show = async () => ({ capabilities: [] });
    embed = async () => ({ embeddings: [[0.1]] });
  },
}));

const { LocalProviderLive } = await import("../src/providers/local.js");
const { mapProviderError, oneLineReason } = await import(
  "../src/provider-error.js"
);
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";
import { LLMTimeoutError, LLMError, LLMRateLimitError } from "../src/errors.js";

const makeConfig = (
  overrides: Partial<{ ollamaTimeoutMs: number }> = {},
) =>
  Layer.succeed(LLMConfig, {
    defaultProvider: "ollama" as const,
    defaultModel: "cogito:14b",
    ollamaEndpoint: "http://localhost:11434",
    timeoutMs: 30_000,
    maxRetries: 0,
    defaultMaxTokens: 128,
    defaultTemperature: 0.1,
    observabilityVerbosity: "metadata" as const,
    embeddingConfig: { model: "nomic-embed-text", dimensions: 1, provider: "ollama" as const },
    supportsPromptCaching: false,
    pricingRegistry: {},
    ...overrides,
  } as unknown as LLMConfig["Type"]);

const runComplete = (
  request: Parameters<LLMService["Type"]["complete"]>[0],
  configLayer = makeConfig(),
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.complete(request);
    }).pipe(Effect.provide(LocalProviderLive.pipe(Layer.provide(configLayer)))),
  );

const timeoutErrorOf = (exit: Exit.Exit<unknown, unknown>): LLMTimeoutError => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) throw new Error("expected failure");
  const err = Cause.failureOption(exit.cause);
  const value = err._tag === "Some" ? err.value : undefined;
  expect(value).toBeInstanceOf(LLMTimeoutError);
  return value as LLMTimeoutError;
};

beforeEach(() => {
  chatImpl = () => new Promise<never>(() => {});
  capturedFetch = undefined;
});

describe("local provider — configurable timeout (criteria 1 & 2)", () => {
  it("applies request.timeoutMs as the wired ceiling and reports it", async () => {
    const exit = await runComplete({
      messages: [{ role: "user", content: "hi" }],
      model: "cogito:14b",
      timeoutMs: 60,
    });
    const err = timeoutErrorOf(exit);
    expect(err.timeoutMs).toBe(60); // wired value, NOT the old 120_000 literal
    expect(err.provider).toBe("ollama");
  });

  it("falls back to config.ollamaTimeoutMs when request omits timeoutMs", async () => {
    const exit = await runComplete(
      { messages: [{ role: "user", content: "hi" }], model: "cogito:14b" },
      makeConfig({ ollamaTimeoutMs: 70 }),
    );
    expect(timeoutErrorOf(exit).timeoutMs).toBe(70);
  });

  it("request.timeoutMs wins over config.ollamaTimeoutMs (precedence)", async () => {
    const exit = await runComplete(
      { messages: [{ role: "user", content: "hi" }], model: "cogito:14b", timeoutMs: 40 },
      makeConfig({ ollamaTimeoutMs: 9_000 }),
    );
    expect(timeoutErrorOf(exit).timeoutMs).toBe(40);
  });

  it("timeout error carries model, elapsedMs, and a cold-load/GPU hint", async () => {
    const exit = await runComplete({
      messages: [{ role: "user", content: "hi" }],
      model: "cogito:14b",
      timeoutMs: 50,
    });
    const err = timeoutErrorOf(exit);
    expect(err.model).toBe("cogito:14b");
    expect(typeof err.elapsedMs).toBe("number");
    expect(err.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(err.message).toContain("cogito:14b");
    expect(err.message).toContain("cold-loading");
    expect(err.message).toMatch(/gpu/i);
    expect(err.message).toContain("50ms"); // the limit is surfaced
  });
});

describe("local provider — timeout aborts in-flight request (criterion 3)", () => {
  it("fires the AbortSignal forwarded into the ollama client on timeout", async () => {
    // Drive the injected fetch so we can observe the signal it received.
    let seenSignal: AbortSignal | undefined;
    chatImpl = async () => {
      if (capturedFetch) {
        // Hanging fetch that records the abort signal; swallow the eventual
        // AbortError so it does not surface as an unhandled rejection.
        void capturedFetch("http://localhost:11434/api/chat", {
          method: "POST",
        }).catch(() => {});
      }
      return new Promise<never>(() => {});
    };

    // Stub global fetch so the injected fetch records the signal and hangs
    // instead of hitting a real socket.
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (_input: unknown, init?: { signal?: AbortSignal }) => {
        seenSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
      { preconnect: realFetch.preconnect },
    ) as typeof fetch;

    try {
      const exit = await runComplete({
        messages: [{ role: "user", content: "hi" }],
        model: "cogito:14b",
        timeoutMs: 60,
      });
      timeoutErrorOf(exit);
      // Give the interruption a tick to propagate the abort to the signal.
      await new Promise((r) => setTimeout(r, 20));
      expect(seenSignal).toBeDefined();
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("provider error mapping — dedup + one-line cause (criterion 4)", () => {
  it("maps an anthropic model typo (404 + JSON body) to one clean line", () => {
    const raw = {
      status: 404,
      message:
        '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-bad-model"}}',
    };
    const mapped = mapProviderError(raw, "anthropic", "claude-bad-model");
    expect(mapped).toBeInstanceOf(LLMError);
    const e = mapped as LLMError;
    expect(e.message).toBe(
      'Model "claude-bad-model" not found on anthropic. Check the model id and your access.',
    );
    // One line: no newline, no raw JSON braces in the surfaced message.
    expect(e.message).not.toContain("\n");
    expect(e.message).not.toContain("{");
    // cause is a ONE-LINE STRING, never the raw object (no stack leak / re-print).
    expect(typeof e.cause).toBe("string");
    expect(e.cause as string).not.toContain("\n");
  });

  it("gives ollama a pull suggestion for model-not-found", () => {
    const mapped = mapProviderError(
      { status_code: 404, message: "model 'foo' not found" },
      "ollama",
    );
    expect((mapped as LLMError).message).toBe(
      'Model "foo" not found locally. Run: ollama pull foo',
    );
  });

  it("collapses a generic multi-line JSON error to a single clean line", () => {
    const raw = {
      status: 500,
      message: '500 {\n  "error": {\n    "message": "internal boom"\n  }\n}',
    };
    const mapped = mapProviderError(raw, "openai");
    const e = mapped as LLMError;
    expect(e.message).toBe("openai request failed: 500 internal boom");
    expect(e.message).not.toContain("\n");
    expect(typeof e.cause).toBe("string");
  });

  it("routes 429 to LLMRateLimitError honoring retry-after", () => {
    const mapped = mapProviderError(
      { status: 429, message: "slow down", headers: { "retry-after": "2" } },
      "anthropic",
    );
    expect(mapped).toBeInstanceOf(LLMRateLimitError);
    expect((mapped as LLMRateLimitError).retryAfterMs).toBe(2000);
  });

  it("oneLineReason lifts the nested body message", () => {
    expect(
      oneLineReason('404 {"error":{"message":"model not here"}}'),
    ).toBe("404 model not here");
  });
});
