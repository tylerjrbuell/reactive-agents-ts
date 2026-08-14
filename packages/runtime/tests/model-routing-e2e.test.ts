// Run: bun test packages/runtime/tests/model-routing-e2e.test.ts --timeout 20000
/**
 * Headline cross-path verification: .withModelRouting() routes a simple task
 * to the haiku tier, and without routing the configured sonnet model reaches
 * the LLM unchanged (gut-check).
 *
 * INJECTION SEAM: .withReplayLLM(), not .withLayers(). This file originally
 * relied on ".withLayers() merges AFTER the runtime's built-in LLMService,
 * last wins" and an "inline (non-reasoning) path" that resolved LLMService
 * late enough for that shadow to reach it. Move 1 (2026-08-13,
 * `bareReasoningConfig`) made EVERY builder run the kernel arm regardless of
 * `.withReasoning()` — LLMService is now captured upstream, at construction,
 * for every builder, so `.withLayers()` no longer reaches it (0 requests
 * captured, silently green-then-network-dependent since the real credential
 * path took over — this is how the live-credit dependency was introduced).
 * `.withReplayLLM()` swaps LLMService in upstream of that construction,
 * which is what this seam actually needs.
 *
 * PROVIDER CONFIG: .withProvider("anthropic") keeps config.provider="anthropic"
 * so the cost-route phase uses the real anthropic tier table and selects
 * "claude-haiku-4-5-20251001" for a simple task. Using .withTestScenario()
 * instead would override provider to "test", which causes cost-route to degrade
 * gracefully to the default model (no routing happens) — we must inject the
 * fake LLM via .withReplayLLM() rather than .withTestScenario().
 *
 * NON-VACUITY PROOF: The gut-check (test 2) captures "claude-sonnet-4-6" — the
 * configured model, without routing — which is DISTINCT from the
 * "claude-haiku-4-5-20251001" captured in test 1. Gutting cost-route (C3) or
 * the selectedModel→request.model wire (C1) would collapse test 1 into the
 * gut-check state, making test 1's "contains haiku" assertion RED. The
 * `captured.length > 0` guard on both tests ensures the recording layer is
 * actually bound — if it were not, the recording layer would never be called
 * and both tests would fail on that guard.
 */
import { describe, it, expect } from "bun:test";
import { Layer } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

/**
 * Build a Layer that wraps TestLLMService and records request.model on every
 * complete() and stream() call. Injected via .withReplayLLM() so it replaces
 * LLMService upstream of construction. Returns deterministic "FINAL ANSWER: 4"
 * responses so the agent terminates after a single iteration without real API
 * calls.
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
      .withReplayLLM(makeCapturingLayer(captured))
      .build();

    const r = await agent.run("What is 2 + 2?");

    expect(r.success).toBe(true);
    // Non-vacuity guard: recording layer was actually called.
    // If .withReplayLLM() did NOT replace LLMService, captured would be empty
    // and this assertion would fail RED.
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
      // Same injection seam as test 1.
      .withReplayLLM(makeCapturingLayer(captured))
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
