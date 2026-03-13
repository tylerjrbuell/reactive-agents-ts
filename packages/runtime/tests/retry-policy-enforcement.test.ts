/**
 * Retry Policy Enforcement Tests
 *
 * Verifies that the retry policy layer composition works correctly at the
 * Effect layer level — mirrors what createRuntime() does with finalLlmLayer.
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Schedule, Duration } from "effect";
import { LLMService, LLMError } from "@reactive-agents/llm-provider";

// ─── Helper: LLM that fails `failCount` times then succeeds ───────────────────

function makeFlakeyLLM(failCount: number): {
  layer: Layer.Layer<LLMService>;
  svc: ReturnType<typeof LLMService.of>;
  getCallCount: () => number;
} {
  let calls = 0;
  const svc = LLMService.of({
    complete: () => {
      calls++;
      if (calls <= failCount) {
        return Effect.fail(
          new LLMError({ message: "transient error", provider: "anthropic" }),
        );
      }
      return Effect.succeed({
        content: "success",
        stopReason: "end_turn" as const,
        model: "test",
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20,
          estimatedCost: 0,
        },
      });
    },
    stream: () =>
      Effect.fail(
        new LLMError({ message: "not used", provider: "anthropic" }),
      ) as any,
    completeStructured: () =>
      Effect.fail(
        new LLMError({ message: "not used", provider: "anthropic" }),
      ) as any,
    embed: (texts) => Effect.succeed(texts.map(() => [] as number[])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () =>
      Effect.succeed({ provider: "anthropic" as const, model: "test" }),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({
        nativeJsonMode: false,
        jsonSchemaEnforcement: false,
        prefillSupport: false,
        grammarConstraints: false,
      }),
  });
  const layer = Layer.succeed(LLMService, svc);
  return { layer, svc, getCallCount: () => calls };
}

// ─── Helper: wrap a service with retry policy ─────────────────────────────────
// Build a Layer that wraps the svc's complete() with Effect.retry.
// This matches the pattern in createRuntime() finalLlmLayer.

function wrapWithRetry(
  baseSvc: ReturnType<typeof LLMService.of>,
  maxRetries: number,
  backoffMs = 0,
): Layer.Layer<LLMService> {
  const retrySchedule = Schedule.recurs(maxRetries).pipe(
    Schedule.intersect(Schedule.spaced(Duration.millis(backoffMs))),
  );
  const wrappedSvc = LLMService.of({
    ...baseSvc,
    // Effect.suspend ensures the function is called fresh on each retry attempt.
    // Without suspend, the same Effect value would be retried (not re-executing the function).
    complete: (req: Parameters<typeof baseSvc.complete>[0]) =>
      Effect.suspend(() => baseSvc.complete(req)).pipe(Effect.retry(retrySchedule)),
  });
  return Layer.succeed(LLMService, wrappedSvc);
}

const testRequest = {
  messages: [{ role: "user" as const, content: "test" }],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Retry policy layer composition", () => {
  it("succeeds after N failures when maxRetries >= failCount", async () => {
    const { svc: baseSvc, getCallCount } = makeFlakeyLLM(2);
    const wrappedLayer = wrapWithRetry(baseSvc, 2);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(wrappedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Right");
    expect(getCallCount()).toBe(3); // 2 failures + 1 success
  });

  it("fails immediately with no retry when failCount=1 and no retry wrap", async () => {
    const { svc: baseSvc, getCallCount } = makeFlakeyLLM(1);
    const baseLayer = Layer.succeed(LLMService, baseSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(baseLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    expect(getCallCount()).toBe(1);
  });

  it("still fails after exhausting all retries when failCount > maxRetries", async () => {
    const { svc: baseSvc, getCallCount } = makeFlakeyLLM(5);
    const wrappedLayer = wrapWithRetry(baseSvc, 2); // 2 retries = 3 total attempts

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(wrappedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left"); // still fails after 3 attempts
    expect(getCallCount()).toBe(3); // 1 initial + 2 retries
  });

  it("maxRetries=0 means single attempt only", async () => {
    const { svc: baseSvc, getCallCount } = makeFlakeyLLM(1);
    const wrappedLayer = wrapWithRetry(baseSvc, 0);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(wrappedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    expect(getCallCount()).toBe(1); // no retries
  });

  it("succeeds on first attempt when LLM never fails", async () => {
    const { svc: baseSvc, getCallCount } = makeFlakeyLLM(0); // never fails
    const wrappedLayer = wrapWithRetry(baseSvc, 3);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(wrappedLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Right");
    expect(getCallCount()).toBe(1); // no retries needed
  });

  it("error from LLM is an LLMError with correct tag", async () => {
    const { svc: baseSvc } = makeFlakeyLLM(10); // always fails
    const baseLayer = Layer.succeed(LLMService, baseSvc);

    const result = await Effect.runPromise(
      LLMService.pipe(
        Effect.flatMap((svc) => svc.complete(testRequest)),
        Effect.provide(baseLayer),
        Effect.either,
      ),
    );

    expect(result._tag).toBe("Left");
    const err = (result as any).left;
    expect(err._tag).toBe("LLMError");
    expect(err.message).toBe("transient error");
  });
});
