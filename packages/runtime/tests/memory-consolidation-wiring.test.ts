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

// ─── Mock LLM: two tool calls then a final answer (non-trivial run) ────────

function makeMockLLM() {
  let callCount = 0;
  return Layer.succeed(
    Context.GenericTag<{
      complete: (req: unknown) => Effect.Effect<{
        content: string;
        stopReason: string;
        toolCalls?: unknown[];
        usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number };
        model: string;
      }>;
    }>("LLMService"),
    {
      complete: (_req: unknown) => {
        callCount++;
        const isFirstCall = callCount === 1;
        return Effect.succeed({
          content: "FINAL ANSWER: The answer is 4.",
          stopReason: "end_turn",
          toolCalls: isFirstCall
            ? [
                { id: "tc-1", name: "web_search", input: { query: "2+2" } },
                { id: "tc-2", name: "web_search", input: { query: "2 plus 2" } },
              ]
            : [],
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCost: 0.001 },
          model: "test-model",
        });
      },
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
    makeMockLLM(),
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
