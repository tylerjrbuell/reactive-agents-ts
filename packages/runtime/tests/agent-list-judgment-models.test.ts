// Run: bun test packages/runtime/tests/agent-list-judgment-models.test.ts --timeout 15000
//
// Phase E Task 5 - agent.listJudgmentModels() public facade method tests.
// Tests three scenarios:
//   (a) listJudgmentModels() with a JudgmentService wired returns models from the catalog
//       (a fake service, not a live `jev` network call — see fakeJudgmentService below)
//   (b) listJudgmentModels() without .withJudgment() throws "JudgmentService is not configured"
//   (c) listJudgmentModels() with llm backend (no catalog) rejects — the rejection's message
//       names the missing catalog (see reactive-agent.ts's listJudgmentModels() JSDoc for the
//       real, non-`instanceof` rejection contract)

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer } from "effect";
import { ReactiveAgents } from "../src/index.js";
import { JudgmentService, JudgmentUnsupported } from "@reactive-agents/judgment";

/**
 * Fake `JudgmentService["Type"]` with a stubbed `listModels()` — mirrors the
 * mock-backend pattern in `judgment-rank.test.ts`. Test (a) only needs to
 * verify `agent.listJudgmentModels()`'s plumbing (facade -> service -> array), not a
 * real `jev` backend network round trip: a real `.withJudgment({ backend:
 * "jev" })` call resolves `TYPESAFE_API_KEY` from `.env` and hits TypeSafe's
 * live API, which passes locally (key present) but fails in CI (no key
 * configured) — exactly the kind of environment-dependent flake this test
 * must not have.
 */
const fakeJudgmentService: JudgmentService["Type"] = {
  ask: () => Effect.die(new Error("unused in this test")),
  listModels: () =>
    Effect.succeed([
      { name: "fake-model-1", description: "A fake calibrated model.", releaseDate: "2026-01-01" },
      { name: "fake-model-2", description: "Another fake calibrated model.", releaseDate: "2026-02-01" },
    ]),
};

describe("agent.listJudgmentModels() - Phase E Task 5", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("(a) listJudgmentModels() with a JudgmentService wired returns model list from the catalog", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      // No `.withJudgment({ backend: "jev" })` here: `makeJevBackend()`
      // constructs a `TypeSafeClient` eagerly at layer-build time and throws
      // if no API key resolves (from `options.apiKey` or `TYPESAFE_API_KEY`)
      // — so wiring the real `jev` layer and then overriding it via
      // `.withLayers()` still fails in a keyless CI environment before the
      // override ever takes effect. Instead, `.withLayers()` alone supplies
      // a fake `JudgmentService` directly (mirrors the mock-backend pattern
      // in `judgment-rank.test.ts`) — this test only verifies
      // `agent.listJudgmentModels()`'s plumbing (facade -> service -> array), not a
      // live TypeSafe network round trip.
      .withLayers(Layer.succeed(JudgmentService, fakeJudgmentService))
      .build();
    agentsToDispose.push(agent);

    const models = await agent.listJudgmentModels();

    // Verify that listJudgmentModels() returns an array of models with expected structure
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Verify each model has the expected properties
    for (const model of models) {
      expect(typeof model.name).toBe("string");
      expect(typeof model.description).toBe("string");
      expect(typeof model.releaseDate).toBe("string");
      expect(model.name.length).toBeGreaterThan(0);
    }
  });

  it("(b) listJudgmentModels() without .withJudgment() throws immediately", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-no-judgment-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    agentsToDispose.push(agent);

    let error: Error | null = null;
    try {
      await agent.listJudgmentModels();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("agent.listJudgmentModels() requires .withJudgment()");
    expect(error?.message).toContain("JudgmentService is not configured");
  });

  it("(c) listJudgmentModels() with llm backend (no catalog) rejects naming the missing catalog", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-unsupported-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    let error: Error | null = null;
    try {
      await agent.listJudgmentModels();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    // The rejection is a `FiberFailure` wrapper around the underlying
    // `JudgmentUnsupported`, NOT a bare `JudgmentUnsupported` instance —
    // `error instanceof JudgmentUnsupported` is false here (confirmed
    // empirically; `ManagedRuntime.runPromise()` does not unwrap tagged
    // errors before rejecting). Assert the one true, documented contract:
    // the rejection's message names the missing catalog.
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(JudgmentUnsupported);
    expect(error?.message).toContain('Backend "llm" has no model catalog');
  });
});
