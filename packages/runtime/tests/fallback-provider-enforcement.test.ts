/**
 * Fallback Provider Enforcement Tests
 *
 * Verifies that the FallbackChain layer composition works correctly at the
 * Effect layer level — mirrors what createRuntime()'s effectiveLlmLayer does.
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, LLMError } from "@reactive-agents/llm-provider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CompletionResponse = {
  content: string;
  stopReason: "end_turn";
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
};

function makeSuccessLLM(label: string): {
  svc: ReturnType<typeof LLMService.of>;
  layer: Layer.Layer<LLMService>;
  getCallCount: () => number;
} {
  let calls = 0;
  const svc = LLMService.of({
    complete: () => {
      calls++;
      return Effect.succeed({
        content: `response from ${label}`,
        stopReason: "end_turn" as const,
        model: label,
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
      });
    },
    stream: () =>
      Effect.fail(new LLMError({ message: "not used", provider: "anthropic" })) as any,
    completeStructured: () =>
      Effect.fail(new LLMError({ message: "not used", provider: "anthropic" })) as any,
    embed: (texts) => Effect.succeed(texts.map(() => [] as number[])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: label }),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: false,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
  });
  return { svc, layer: Layer.succeed(LLMService, svc), getCallCount: () => calls };
}

function makeFailingLLM(): {
  svc: ReturnType<typeof LLMService.of>;
  layer: Layer.Layer<LLMService>;
  getCallCount: () => number;
} {
  let calls = 0;
  const svc = LLMService.of({
    complete: () => {
      calls++;
      return Effect.fail(
        new LLMError({ message: "provider unavailable", provider: "anthropic" }),
      );
    },
    stream: () =>
      Effect.fail(new LLMError({ message: "not used", provider: "anthropic" })) as any,
    completeStructured: () =>
      Effect.fail(new LLMError({ message: "not used", provider: "anthropic" })) as any,
    embed: (texts) => Effect.succeed(texts.map(() => [] as number[])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: "failing" }),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: false,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
  });
  return { svc, layer: Layer.succeed(LLMService, svc), getCallCount: () => calls };
}

/**
 * Build a cascaded LLM service: try primary, on failure try fallback.
 * Mirrors the effectiveLlmLayer pattern from createRuntime().
 */
function makeCascadeLayer(
  primarySvc: ReturnType<typeof LLMService.of>,
  fallbackSvc: ReturnType<typeof LLMService.of>,
): Layer.Layer<LLMService> {
  const cascadedSvc = LLMService.of({
    ...primarySvc,
    complete: (req: Parameters<typeof primarySvc.complete>[0]) =>
      primarySvc.complete(req).pipe(
        Effect.catchAll(() => fallbackSvc.complete(req)),
      ),
  });
  return Layer.succeed(LLMService, cascadedSvc);
}

const testRequest = {
  messages: [{ role: "user" as const, content: "test" }],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Fallback provider layer composition", () => {
  it("fallback is used when primary fails", async () => {
    const { svc: primarySvc } = makeFailingLLM();
    const { svc: fallbackSvc } = makeSuccessLLM("fallback");
    const cascadedLayer = makeCascadeLayer(primarySvc, fallbackSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(cascadedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Right");
    const resp = (result as any).right as CompletionResponse;
    expect(resp.content).toContain("fallback");
  });

  it("primary is used when it works (fallback not called)", async () => {
    const { svc: primarySvc } = makeSuccessLLM("primary");
    const { svc: fallbackSvc, getCallCount: fallbackCalls } = makeSuccessLLM("fallback");
    const cascadedLayer = makeCascadeLayer(primarySvc, fallbackSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(cascadedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Right");
    const resp = (result as any).right as CompletionResponse;
    expect(resp.content).toContain("primary");
    expect(fallbackCalls()).toBe(0); // fallback never called
  });

  it("error propagates when both primary and fallback fail", async () => {
    const { svc: primarySvc } = makeFailingLLM();
    const { svc: fallbackSvc } = makeFailingLLM();
    const cascadedLayer = makeCascadeLayer(primarySvc, fallbackSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(cascadedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    const err = (result as any).left;
    expect(err._tag).toBe("LLMError");
  });

  it("three-layer cascade: fallback2 used when primary and fallback1 both fail", async () => {
    const { svc: primarySvc } = makeFailingLLM();
    const { svc: fallback1Svc } = makeFailingLLM();
    const { svc: fallback2Svc } = makeSuccessLLM("fallback2");

    // Chain: (primary → fallback1) → fallback2
    const innerCascadedSvc = LLMService.of({
      ...primarySvc,
      complete: (req: Parameters<typeof primarySvc.complete>[0]) =>
        primarySvc.complete(req).pipe(
          Effect.catchAll(() => fallback1Svc.complete(req)),
        ),
    });
    const fullCascadedSvc = LLMService.of({
      ...innerCascadedSvc,
      complete: (req: Parameters<typeof innerCascadedSvc.complete>[0]) =>
        innerCascadedSvc.complete(req).pipe(
          Effect.catchAll(() => fallback2Svc.complete(req)),
        ),
    });
    const fullCascadeLayer = Layer.succeed(LLMService, fullCascadedSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(fullCascadeLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Right");
    const resp = (result as any).right as CompletionResponse;
    expect(resp.content).toContain("fallback2");
  });

  it("primary call count is exactly 1 on failure (no double-calls)", async () => {
    const { svc: primarySvc, getCallCount: primaryCalls } = makeFailingLLM();
    const { svc: fallbackSvc } = makeSuccessLLM("fallback");
    const cascadedLayer = makeCascadeLayer(primarySvc, fallbackSvc);

    await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(cascadedLayer),
        Effect.either,
      ),
    );

    expect(primaryCalls()).toBe(1);
  });

  it("FallbackChain class tracks provider switching correctly", () => {
    // Test FallbackChain independently (unit test of the stateful class)
    const { FallbackChain } = require("@reactive-agents/llm-provider");
    const chain = new FallbackChain({
      providers: ["anthropic", "openai", "gemini"],
      errorThreshold: 2,
    });

    expect(chain.currentProvider()).toBe("anthropic");

    // One error — not enough to switch
    chain.recordError("anthropic");
    expect(chain.currentProvider()).toBe("anthropic");

    // Second error — threshold met, switch to openai
    chain.recordError("anthropic");
    expect(chain.currentProvider()).toBe("openai");

    // Success resets count
    chain.recordSuccess("openai");

    // Has more fallbacks (gemini)
    expect(chain.hasFallback()).toBe(true);
  });
});
