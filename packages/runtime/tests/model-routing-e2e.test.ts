// Run: bun test packages/runtime/tests/model-routing-e2e.test.ts --timeout 20000
/**
 * Headline cross-path verification: .withModelRouting() routes a simple task
 * to the haiku tier on the inline path, and without routing the configured
 * sonnet model reaches the LLM unchanged (gut-check).
 *
 * INJECTION SEAM (option a): The builder's .withLayers() accepts a Layer that
 * is merged AFTER the runtime's built-in LLMService in Layer.mergeAll — the
 * last provider wins in Effect's context-merge semantics. We inject a
 * recording LLMService (wrapping TestLLMService for deterministic responses)
 * that captures request.model on every complete()/stream() call.
 *
 * PROVIDER CONFIG: .withProvider("anthropic") keeps config.provider="anthropic"
 * so the cost-route phase uses the real anthropic tier table and selects
 * "claude-haiku-4-5-20251001" for a simple task. Using .withTestScenario()
 * instead would override provider to "test", which causes cost-route to degrade
 * gracefully to the default model (no routing happens) — we must inject the
 * fake LLM via .withLayers() rather than .withTestScenario().
 *
 * NON-VACUITY PROOF: The gut-check (test 2) captures "claude-sonnet-4-6" — the
 * configured model, without routing — which is DISTINCT from the
 * "claude-haiku-4-5-20251001" captured in test 1. Gutting cost-route (C3) or
 * the selectedModel→request.model wire (C1) would collapse test 1 into the
 * gut-check state, making test 1's "contains haiku" assertion RED. The
 * `captured.length > 0` guard on both tests ensures the recording layer is
 * actually shadowing the built-in LLMService — if .withLayers() did NOT
 * override it, the recording layer would never be called and both tests would
 * fail on that guard.
 */
import { describe, it, expect } from "bun:test";
import { Layer } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

/**
 * Build a Layer that wraps TestLLMService and records request.model on every
 * complete() and stream() call. Injected via .withLayers() so it shadows the
 * runtime's built-in LLMService (last-in-Layer.mergeAll wins in Effect v3's
 * context-merge semantics). Returns deterministic "FINAL ANSWER: 4" responses
 * so the agent terminates after a single iteration without real API calls.
 */
function makeCapturingLayer(captured: string[]): Layer.Layer<LLMService> {
  const base = TestLLMService([{ text: "FINAL ANSWER: 4" }]);
  return Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (request) => {
        const m = request.model;
        if (typeof m === "string") captured.push(m);
        return base.complete(request);
      },
      stream: (request) => {
        const m = request.model;
        if (typeof m === "string") captured.push(m);
        return base.stream(request);
      },
    }),
  );
}

describe("model routing — inline path + gut-check", () => {
  it("inline path: .withModelRouting() routes a simple task to the haiku tier", async () => {
    const captured: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("inline-routing-e2e")
      .withProvider("anthropic")
      .withModel("claude-sonnet-4-6")
      .withModelRouting() // enables cost-route phase; anthropic haiku = "claude-haiku-4-5-20251001"
      // No .withReasoning() → inline (non-reasoning) path
      .withLayers(makeCapturingLayer(captured))
      .build();

    const r = await agent.run("What is 2 + 2?");

    expect(r.success).toBe(true);
    // Non-vacuity guard: recording layer was actually called.
    // If .withLayers() did NOT shadow the built-in LLMService, captured would
    // be empty and this assertion would fail RED.
    expect(captured.length).toBeGreaterThan(0);
    // C3 (cost-route) selects "claude-haiku-4-5-20251001" for anthropic haiku
    // tier. C1 (selectedModel→request.model) wires it into the LLM call.
    // Reverting either makes captured[0] === "claude-sonnet-4-6" → RED.
    expect(captured[0]).toContain("haiku");
    expect(captured[0]).not.toBe("claude-sonnet-4-6");
  });

  it("GUT-CHECK: without .withModelRouting(), the configured sonnet model reaches the LLM unchanged", async () => {
    const captured: string[] = [];

    const agent = await ReactiveAgents.create()
      .withName("no-routing-gut-check")
      .withProvider("anthropic")
      .withModel("claude-sonnet-4-6")
      // No .withModelRouting() — cost-route phase is skipped entirely;
      // selectedModel stays as config.defaultModel == "claude-sonnet-4-6".
      // No .withReasoning() — same inline path as test 1 (identical seam).
      .withLayers(makeCapturingLayer(captured))
      .build();

    const r = await agent.run("What is 2 + 2?");

    expect(r.success).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    // Without routing, selectedModel == "claude-sonnet-4-6" at LLM call time.
    // Non-vacuity: gutting cost-route makes test 1 collapse to this state →
    // test 1's "contains haiku" assertion goes RED. The two tests are
    // distinct: "claude-sonnet-4-6" does not contain "haiku".
    expect(captured[0]).toBe("claude-sonnet-4-6");
    expect(captured[0]).not.toContain("haiku");
  });
});
