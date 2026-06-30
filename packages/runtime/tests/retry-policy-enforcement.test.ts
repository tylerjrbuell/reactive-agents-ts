// Run: bun test packages/runtime/tests/retry-policy-enforcement.test.ts --timeout 15000
//
// Retry-policy enforcement. These tests drive the ACTUAL production wrapper
// (`applyRetryToLlmService`, used by createRuntime's finalLlmLayer) — NOT a
// reimplementation. The previous version of this file defined its own
// `wrapWithRetry` and asserted on the copy, so it stayed green even though
// production wrapped only `complete()` and left `stream()` /
// `completeStructured()` unretried — and the reactive kernel runs through
// `stream()`, so `withRetryPolicy` was dead for the primary run path.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService, LLMError } from "@reactive-agents/llm-provider";
import { applyRetryToLlmService } from "../src/llm-retry.js";

const ok = {
  content: "success",
  stopReason: "end_turn" as const,
  model: "test",
  usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20, estimatedCost: 0 },
};

/** A service that fails the first `failCount` calls of EACH method, then succeeds.
 *  Separate counters per method so each call site can be asserted independently. */
function makeFlakeyLLM(failCount: number) {
  const calls = { complete: 0, stream: 0, completeStructured: 0 };
  const transient = () => new LLMError({ message: "transient error", provider: "anthropic" });
  // Effect.suspend models a REAL provider: the side effect (the "API call",
  // here the counter + fail/succeed decision) runs INSIDE the Effect, so each
  // retry re-executes it. Incrementing outside the Effect would freeze the
  // outcome and make retry a no-op (a mock artifact, not the code under test).
  const svc = {
    complete: () =>
      Effect.suspend(() => {
        calls.complete++;
        return calls.complete <= failCount ? Effect.fail(transient()) : Effect.succeed(ok);
      }),
    stream: () =>
      Effect.suspend(() => {
        calls.stream++;
        return calls.stream <= failCount ? Effect.fail(transient()) : Effect.succeed(Stream.empty);
      }),
    completeStructured: () =>
      Effect.suspend(() => {
        calls.completeStructured++;
        return calls.completeStructured <= failCount ? Effect.fail(transient()) : Effect.succeed({ ok: true });
      }),
    embed: (texts: readonly string[]) => Effect.succeed(texts.map(() => [] as number[])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test" }),
    getStructuredOutputCapabilities: () =>
      Effect.succeed({ nativeJsonMode: false, jsonSchemaEnforcement: false, prefillSupport: false, grammarConstraints: false }),
  } as unknown as Context_Service;
  return { svc, calls };
}
type Context_Service = Parameters<typeof applyRetryToLlmService>[0];

const req = { messages: [{ role: "user" as const, content: "test" }] } as never;

function layerWithRetry(svc: Context_Service, maxRetries: number) {
  return Layer.succeed(LLMService, applyRetryToLlmService(svc, { maxRetries, backoffMs: 0 }));
}

describe("applyRetryToLlmService — production retry wrapper", () => {
  it("retries complete() until success when maxRetries >= failCount", async () => {
    const { svc, calls } = makeFlakeyLLM(2);
    const r = await Effect.runPromise(
      LLMService.pipe(Effect.flatMap((s) => s.complete(req)), Effect.provide(layerWithRetry(svc, 2)), Effect.either),
    );
    expect(r._tag).toBe("Right");
    expect(calls.complete).toBe(3); // 2 failures + 1 success
  });

  it("retries stream() — the path the reactive kernel actually uses", async () => {
    const { svc, calls } = makeFlakeyLLM(2);
    const r = await Effect.runPromise(
      LLMService.pipe(Effect.flatMap((s) => s.stream(req)), Effect.provide(layerWithRetry(svc, 2)), Effect.either),
    );
    expect(r._tag).toBe("Right");
    expect(calls.stream).toBe(3);
  });

  it("retries completeStructured() — the structured-output path", async () => {
    const { svc, calls } = makeFlakeyLLM(2);
    const r = await Effect.runPromise(
      LLMService.pipe(Effect.flatMap((s) => s.completeStructured(req as never)), Effect.provide(layerWithRetry(svc, 2)), Effect.either),
    );
    expect(r._tag).toBe("Right");
    expect(calls.completeStructured).toBe(3);
  });

  it("still fails after exhausting retries (failCount > maxRetries) on each path", async () => {
    const { svc, calls } = makeFlakeyLLM(5);
    const layer = layerWithRetry(svc, 2); // 2 retries = 3 attempts
    const rc = await Effect.runPromise(LLMService.pipe(Effect.flatMap((s) => s.complete(req)), Effect.provide(layer), Effect.either));
    const rs = await Effect.runPromise(LLMService.pipe(Effect.flatMap((s) => s.stream(req)), Effect.provide(layer), Effect.either));
    expect(rc._tag).toBe("Left");
    expect(rs._tag).toBe("Left");
    expect(calls.complete).toBe(3);
    expect(calls.stream).toBe(3);
  });

  it("maxRetries=0 means a single attempt per path", async () => {
    const { svc, calls } = makeFlakeyLLM(1);
    const layer = layerWithRetry(svc, 0);
    await Effect.runPromise(LLMService.pipe(Effect.flatMap((s) => s.complete(req)), Effect.provide(layer), Effect.either));
    await Effect.runPromise(LLMService.pipe(Effect.flatMap((s) => s.stream(req)), Effect.provide(layer), Effect.either));
    expect(calls.complete).toBe(1);
    expect(calls.stream).toBe(1);
  });
});
