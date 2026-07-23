// Run: bun test packages/runtime/tests/metadata-extension-slot.test.ts --timeout 15000
//
// Cross-cutting cascade Task 9 — Boundary 3: `ReasoningResult.metadata` →
// `TaskResult.metadata` used to be a hand-enumerated allow-list literal in
// `execution-engine.ts` (~line 1295-1335): every forwarded field had to be
// added BY NAME or it died silently at the boundary (DEBT-REGISTER §3).
//
// This proves the fix is a TYPED EXTENSION SLOT, not a naive pass-through:
//   1. `rr.metadata.extensions` rides verbatim onto `TaskResult.metadata.extensions`
//      — a strategy result can carry a brand-new field with NO engine edit.
//   2. An unenumerated TOP-LEVEL key on `rr.metadata` (i.e. NOT nested under
//      `extensions`) still never reaches `TaskResult.metadata` — a deny-list
//      pass-through would invert the old "useful field silently lost" failure
//      into "internal field silently leaked onto the public API surface",
//      which is strictly worse.
//
// Exercises the REAL production path: a probe strategy registered on the
// actual `ReasoningService`/`StrategyRegistry`, minted through the real
// `finalizeStrategyResult` terminal, normalized by the real
// `normalizeReasoningResult` (engine/util.ts), forwarded by the real
// `ExecutionEngine` literal — no test-only shortcuts.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import type { Task } from "@reactive-agents/core";
import {
  ReasoningService,
  createReasoningLayer,
  defaultReasoningConfig,
  finalizeStrategyResult,
  type StrategyFn,
} from "@reactive-agents/reasoning";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";

const mockTask: Task = {
  id: "task-ext-001" as Task["id"],
  agentId: "agent-ext-001" as Task["agentId"],
  type: "query",
  input: { question: "What is 2+2?" },
  priority: "medium",
  status: "pending",
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("metadata extension slot (cross-cutting cascade Task 9, DEBT-REGISTER §3)", () => {
  const config = defaultReactiveAgentsConfig("agent-ext-001");
  const hookLayer = LifecycleHookRegistryLive;
  const engineLayer = ExecutionEngineLive(config).pipe(Layer.provide(hookLayer));
  const llmLayer = TestLLMServiceLayer([
    { match: ".*", text: "unused — probe strategy short-circuits before any LLM call" },
  ]);
  const reasoningLayer = createReasoningLayer(defaultReasoningConfig).pipe(
    Layer.provide(llmLayer),
  );

  const testLayer = Layer.mergeAll(hookLayer, engineLayer, llmLayer, reasoningLayer);

  // Probe strategy: mints a JudgedReasoningResult via the real terminal
  // (`finalizeStrategyResult`) carrying an `extensions` field plus a
  // top-level unenumerated key that must NOT leak.
  const probe: StrategyFn = () =>
    finalizeStrategyResult({
      strategy: "reactive",
      steps: [],
      output: "probe output",
      status: "completed",
      start: Date.now(),
      totalTokens: 0,
      totalCost: 0,
      extraMetadata: {
        extensions: { myNewSignal: 42 },
        // Deliberately top-level (NOT nested under `extensions`) — the
        // deny-list-inversion failure mode this design avoids.
        topLevelLeak: "should-not-be-visible",
      },
    });

  it("forwards rr.metadata.extensions verbatim onto TaskResult.metadata.extensions", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reasoning = yield* ReasoningService;
        yield* reasoning.registerStrategy("reactive", probe);
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    const metadata = result.metadata as { extensions?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    expect(metadata.extensions).toBeDefined();
    expect(metadata.extensions?.["myNewSignal"]).toBe(42);
  });

  it("does NOT leak an unenumerated top-level rr.metadata key onto TaskResult.metadata", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reasoning = yield* ReasoningService;
        yield* reasoning.registerStrategy("reactive", probe);
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata["topLevelLeak"]).toBeUndefined();
  });
});
