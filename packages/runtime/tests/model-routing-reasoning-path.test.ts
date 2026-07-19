// Run: bun test packages/runtime/tests/model-routing-reasoning-path.test.ts --timeout 20000
/**
 * Non-vacuous verification that the routed model actually reaches `llm.stream()`
 * on the reasoning path (C2 gate).
 *
 * Strategy: inject a recording LLMService layer that captures `request.model`
 * from every `stream()` call. Drive `executeReActKernel` with `modelId` set to a
 * cheap-tier model. Assert the captured value equals the modelId.
 *
 * Non-vacuity proof (captured in the negative-control test below):
 * - When `modelId` is omitted, `request.model` is `undefined` — proves the
 *   positive assertion is not trivially satisfied.
 * - Reverting C2 (`...(input.modelId ? { model: input.modelId } : {})`) makes
 *   the positive test go RED because `captured[0]` would be `undefined`.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReActKernel } from "@reactive-agents/reasoning";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import { ReactiveAgents } from "../src/builder.js";

/** Build a layer that wraps TestLLMService and records every `request.model` passed to stream(). */
function makeRecordingLayer(
  captured: Array<string | object | undefined>,
  scenario: Parameters<typeof TestLLMService>[0],
) {
  const base = TestLLMService(scenario);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      stream: (request) => {
        captured.push(request.model);
        return base.stream(request);
      },
    }),
  );
}

describe("model routing — reasoning path (C2)", () => {
  it("forwards input.modelId as request.model to llm.stream (C2 positive)", async () => {
    const captured: Array<string | object | undefined> = [];
    const layer = makeRecordingLayer(captured, [{ text: "FINAL ANSWER: 4" }]);

    const result = await Effect.runPromise(
      executeReActKernel({
        task: "What is 2 + 2?",
        modelId: "claude-haiku-4-5",
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.terminatedBy).toBe("final_answer");
    expect(captured.length).toBeGreaterThan(0);
    // C2: the routed model string must reach the stream call
    expect(captured[0]).toBe("claude-haiku-4-5");
  });

  it("non-vacuity control: without modelId, request.model is undefined", async () => {
    const captured: Array<string | object | undefined> = [];
    const layer = makeRecordingLayer(captured, [{ text: "FINAL ANSWER: 4" }]);

    await Effect.runPromise(
      executeReActKernel({
        task: "What is 2 + 2?",
        // No modelId — without C2 the positive test would look exactly like this
        maxIterations: 2,
      }).pipe(Effect.provide(layer)),
    );

    expect(captured.length).toBeGreaterThan(0);
    // Without modelId, request.model must NOT be set — this proves the positive
    // test is non-vacuous: removing C2 would collapse it into this state.
    expect(captured[0]).toBeUndefined();
  });
});

/**
 * F3 — Builder-level reasoning-path end-to-end test (C1 gate).
 *
 * Proves the FULL chain:
 *   cost-route (C3) → ctx.selectedModel="claude-haiku-*"
 *   → reasoning-think.ts:256 (C1) reads asThinkContext(c).selectedModel → modelId
 *   → kernel (C2) sets request.model = modelId
 *   → observableLlmLayer emits LLMExchangeEmitted { model: "claude-haiku-*" }
 *   → agent.subscribe("LLMExchangeEmitted") captures the model string
 *
 * WHY NOT .withLayers() HERE:
 * The inline path (model-routing-e2e.test.ts) uses a recording LLMService via
 * .withLayers(). This works because the inline path resolves LLMService from
 * the merged runtime context at call time (last wins in Layer.mergeAll).
 * On the REASONING PATH, ReasoningService captures LLMService at construction
 * time via `yield* LLMService` inside ReasoningServiceLive (reasoning-service.ts:150).
 * That construction uses observableLlmLayer (baked into reasoningOptLayer via
 * Layer.provide(reasoningDeps)). A later .withLayers() shadow cannot reach it.
 *
 * The EventBus seam bypasses this: observableLlmLayer DOES emit LLMExchangeEmitted
 * to the shared EventBus on every LLM call, and agent.subscribe() listens to that
 * same bus — proving C1+C2 without faking the LLM.
 *
 * REAL API CALLS: This test exercises the real Anthropic provider (requires
 * ANTHROPIC_API_KEY). The .withReasoning() path uses the baked-in LLM. Tokens
 * are minimal ("What is 2 + 2?" terminates in 1 iteration).
 *
 * Non-vacuity proof:
 *   Reverting C1 (reasoning-think.ts:256) back to
 *   `String(config.defaultModel ?? "")` would set modelId = "claude-sonnet-4-6"
 *   (the configured default). The LLM call would then use "claude-sonnet-4-6",
 *   so LLMExchangeEmitted.model = "claude-sonnet-4-6", and the
 *   "toContain('haiku')" assertion would go RED.
 *   The gut-check test confirms "claude-sonnet-4-6" flows through on the same
 *   path without routing, proving the two states are distinct.
 */
// CI-parity: CI has NO API keys — these two tests call live Anthropic, so they
// must skip when the API is unusable (mirrors the ollamaState probe pattern in
// llm-timeout-builder.test.ts). Key presence alone is NOT enough: a drained
// credit balance 400s every call ("credit balance is too low"), which would
// leave the suite red for account reasons. Probe once at module load with a
// 1-output-token haiku call; skip on any non-OK outcome (no key, bad key,
// drained credits, network down).
// They CANNOT convert to .withProvider("test"): cost-route.ts explicitly
// degrades non-routable providers (incl. "test") to defaultModel (T2 guard,
// cost-route.ts:44-48), so the routed-haiku assertion would be unexercisable —
// the live provider is the only path on which this test is RED-capable.
const anthropicLive = await (async (): Promise<boolean> => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(
        `[model-routing-reasoning-path] live-Anthropic probe non-OK (${res.status}) — skipping C1 live tests`,
      );
    }
    return res.ok;
  } catch {
    return false;
  }
})();

describe.skipIf(!anthropicLive)("model routing — builder reasoning path (C1 gate, EventBus seam)", () => {
  it("C1: .withModelRouting().withReasoning() routes to haiku (LLMExchangeEmitted)", async () => {
    const capturedModels: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("reasoning-routing-e2e-c1")
      .withProvider("anthropic")
      .withModel("claude-sonnet-4-6")
      .withModelRouting() // C3: cost-route selects haiku for a trivial task
      .withReasoning()    // forces reasoning-think.ts path (C1 seam)
      .build();

    // Subscribe BEFORE run so we don't miss events.
    const unsub = await agent.subscribe("LLMExchangeEmitted", (event) => {
      capturedModels.push(event.model);
    });

    try {
      const r = await agent.run("What is 2 + 2?");
      expect(r.success).toBe(true);
    } finally {
      unsub();
    }

    // Non-vacuity guard: the observable LLM must have fired at least once.
    // If it never fired, the subscription would be empty and this assertion
    // fails RED — proving the chain was actually exercised.
    expect(capturedModels.length).toBeGreaterThan(0);

    // C1: cost-route sets ctx.selectedModel = "claude-haiku-4-5-20251001".
    // reasoning-think.ts:256 reads asThinkContext(c).selectedModel → modelId.
    // C2 wires modelId → request.model.
    // observableLlmLayer emits LLMExchangeEmitted.model = request.model.
    // Reverting C1 collapses capturedModels[0] to "claude-sonnet-4-6" → RED.
    expect(capturedModels[0]).toContain("haiku");
    expect(capturedModels[0]).not.toBe("claude-sonnet-4-6");
  });

  it("GUT-CHECK: without .withModelRouting(), sonnet reaches the LLM on the reasoning path", async () => {
    const capturedModels: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("reasoning-no-routing-gut-check-c1")
      .withProvider("anthropic")
      .withModel("claude-sonnet-4-6")
      // No .withModelRouting() — cost-route skipped; selectedModel = defaultModel
      .withReasoning()
      .build();

    const unsub = await agent.subscribe("LLMExchangeEmitted", (event) => {
      capturedModels.push(event.model);
    });

    try {
      const r = await agent.run("What is 2 + 2?");
      expect(r.success).toBe(true);
    } finally {
      unsub();
    }

    expect(capturedModels.length).toBeGreaterThan(0);
    // Without routing, the configured sonnet model flows through unchanged.
    // This distinct state proves the positive test is non-vacuous: "claude-sonnet-4-6"
    // does NOT contain "haiku", so the two tests cannot be trivially equivalent.
    expect(capturedModels[0]).toBe("claude-sonnet-4-6");
    expect(capturedModels[0]).not.toContain("haiku");
  });
});
