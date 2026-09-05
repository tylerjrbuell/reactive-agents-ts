/**
 * P0-7 (v0.14 debt burndown Wave 1b): `.withMemoryConsolidation()` wiring.
 *
 * Before this wave, `MemoryConsolidatorServiceLive` was BUILT by the runtime
 * layer but `consolidate()` / `notifyEntry()` had ZERO callers — a
 * provide-and-forget service. The wiring now lives in the post-run
 * memory-flush phase: each completed non-trivial run calls `notifyEntry()`,
 * and when the configured threshold is reached a full `consolidate()` cycle
 * runs.
 *
 * These tests go RED if that invocation is cut:
 *   1. engine run with a stub MemoryConsolidatorService → notifyEntry called;
 *      consolidate called when the threshold is reported reached.
 *   2. threshold not reached → consolidate NOT called (trigger is gated).
 *   3. layer pin: createRuntime({ enableMemoryConsolidation: true }) makes
 *      MemoryConsolidatorService resolvable; without the flag it is absent.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import { MemoryConsolidatorService } from "@reactive-agents/memory";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
  createRuntime,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Stub ReasoningService: two tool calls then a final answer (non-trivial
// run — Move 1 dead-arm removal, 2026-08-21) ────────────────────────────────
//
// `ExecutionEngineLive` now always routes through the kernel arm when a
// `ReasoningService` is available; the raw `LLMService` mock this file used
// to drive the (now-deleted) inline arm directly is no longer on the
// execution path. `memory-flush.ts`'s consolidation trigger sits behind the
// SAME "non-trivial run" gate as the semantic-extraction Lever 7 gate
// (`classifyComplexity` — trivial iff `iteration<=1 && toolCallCount===0`,
// where `iteration` is `ReasoningResult.metadata.stepsCount`,
// `reasoning-post-think.ts:214`). Two tool-call action/observation step
// pairs (4 steps) plus a final thought push `stepsCount` to 5 — comfortably
// non-trivial and, since `toolCallLog.length` (tracked separately, from
// real `ToolCallCompleted` events this bare stub doesn't emit) stays 0,
// `iteration>3` also forces the SYNCHRONOUS "complex" dispatch path
// (`memory-flush-dispatch.ts`) rather than a forked "moderate" one — so this
// test's assertions aren't racing a fire-and-forget fiber.
function makeMockReasoning() {
  const steps: { id: string; type: string; content: string; metadata?: Record<string, unknown> }[] = [];
  for (const tc of [
    { id: "tc-1", name: "web_search", input: { query: "2+2" } },
    { id: "tc-2", name: "web_search", input: { query: "2 plus 2" } },
  ]) {
    steps.push({
      id: `${tc.id}-action`,
      type: "action",
      content: `${tc.name}(${JSON.stringify(tc.input)})`,
      metadata: { toolUsed: tc.name },
    });
    steps.push({
      id: `${tc.id}-observation`,
      type: "observation",
      content: `Mock result from ${tc.name}`,
      metadata: { observationResult: { success: true } },
    });
  }
  steps.push({ id: "final-thought", type: "thought", content: "FINAL ANSWER: The answer is 4." });

  return Layer.succeed(
    Context.GenericTag<{
      execute: (params: { [k: string]: unknown }) => Effect.Effect<{
        output: unknown;
        status: "completed" | "failed" | "partial";
        steps?: readonly { id: string; type: string; content: string; metadata?: Record<string, unknown> }[];
        metadata: { cost: number; tokensUsed: number; stepsCount: number };
      }>;
    }>("ReasoningService"),
    {
      execute: (_params: { [k: string]: unknown }) =>
        Effect.succeed({
          output: "FINAL ANSWER: The answer is 4.",
          status: "completed" as const,
          steps,
          metadata: { cost: 0.001, tokensUsed: 150, stepsCount: steps.length },
        }),
    },
  );
}

const MockToolServiceLayer = Layer.succeed(
  Context.GenericTag<{
    listTools: () => Effect.Effect<readonly { name: string; description: string }[]>;
    execute: (params: { toolName: string; arguments: unknown; agentId: string; sessionId: string }) => Effect.Effect<{ result: unknown }>;
    toFunctionCallingFormat: () => Effect.Effect<readonly unknown[]>;
  }>("ToolService"),
  {
    listTools: () => Effect.succeed([{ name: "web_search", description: "Search the web" }]),
    execute: (params) => Effect.succeed({ result: `Mock result from ${params.toolName}` }),
    toFunctionCallingFormat: () =>
      Effect.succeed([
        { name: "web_search", description: "Search the web", input_schema: { type: "object", properties: {} } },
      ]),
  },
);

// ─── Stub MemoryConsolidatorService (call-tracking) ────────────────────────

function makeStubConsolidator(thresholdReached: boolean) {
  const calls = { notifyEntry: 0, consolidate: [] as string[] };
  const layer = Layer.succeed(
    Context.GenericTag<{
      consolidate: (agentId: string) => Effect.Effect<unknown, unknown>;
      notifyEntry: () => Effect.Effect<boolean, never>;
    }>("MemoryConsolidatorService"),
    {
      notifyEntry: () => {
        calls.notifyEntry++;
        return Effect.succeed(thresholdReached);
      },
      consolidate: (agentId: string) => {
        calls.consolidate.push(agentId);
        return Effect.succeed({ replayed: 0, connected: 0, compressed: 0, pruned: 0 });
      },
    },
  );
  return { layer, calls };
}

const mockTask = () => ({
  id: `task-${Date.now()}` as any,
  agentId: "consolidation-agent" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
});

function runEngineWith(consolidatorLayer: Layer.Layer<never, never, any>) {
  const config = defaultReactiveAgentsConfig("consolidation-agent");
  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  const testLayer = Layer.mergeAll(
    engineLayer,
    makeMockReasoning(),
    MockToolServiceLayer,
    consolidatorLayer,
  );
  return Effect.runPromise(
    Effect.gen(function* () {
      const engine = yield* ExecutionEngine;
      return yield* engine.execute(mockTask());
    }).pipe(Effect.provide(testLayer as Layer.Layer<any>)),
  );
}

describe("withMemoryConsolidation wiring (P0-7)", () => {
  it("memory-flush calls notifyEntry() and consolidate() when the threshold is reached", async () => {
    const stub = makeStubConsolidator(true);
    await runEngineWith(stub.layer as Layer.Layer<any>);

    // The invocation seam this test pins: memory-flush.ts:consolidate block.
    expect(stub.calls.notifyEntry).toBeGreaterThanOrEqual(1);
    expect(stub.calls.consolidate).toContain("consolidation-agent");
  });

  it("does NOT consolidate when the entry threshold is not reached", async () => {
    const stub = makeStubConsolidator(false);
    await runEngineWith(stub.layer as Layer.Layer<any>);

    expect(stub.calls.notifyEntry).toBeGreaterThanOrEqual(1);
    expect(stub.calls.consolidate).toEqual([]);
  });

  it("createRuntime({ enableMemoryConsolidation: true }) makes the service resolvable (layer pin)", async () => {
    const layer = createRuntime({
      agentId: "consolidation-layer-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath: ":memory:" },
      enableMemoryConsolidation: true,
      consolidationConfig: { threshold: 1 },
    });

    const pending = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* MemoryConsolidatorService;
        return yield* svc.pendingCount();
      }).pipe(Effect.provide(layer as Layer.Layer<any>)),
    );
    expect(pending).toBe(0);
  });

  it("without enableMemoryConsolidation the service is absent (gate pin)", async () => {
    const layer = createRuntime({
      agentId: "consolidation-off-agent",
      provider: "test",
      enableMemory: true,
      memoryOptions: { dbPath: ":memory:" },
    });

    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Effect.serviceOption(MemoryConsolidatorService);
      }).pipe(Effect.provide(layer as Layer.Layer<any>)),
    );
    expect(resolved._tag).toBe("None");
  });
});
