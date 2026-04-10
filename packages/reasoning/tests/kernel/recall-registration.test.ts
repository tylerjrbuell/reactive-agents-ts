// Run: bun test packages/reasoning/tests/kernel/recall-registration.test.ts --timeout 15000
import { Effect } from "effect";
import { describe, it, expect } from "bun:test";
import { resolveExecutableToolCapabilities } from "../../src/strategies/kernel/utils/tool-capabilities.js";
import { ToolService, ToolServiceLive } from "@reactive-agents/tools";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus } from "@reactive-agents/core";
import { Layer } from "effect";

// Minimal mock LLM service layer — needed to satisfy ToolService dependency
const mockLLMLayer = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({ content: "", usage: { promptTokens: 0, completionTokens: 0 }, model: "test" } as any),
  stream: () => Effect.succeed({ content: "", usage: { promptTokens: 0, completionTokens: 0 }, model: "test" } as any),
  embed: () => Effect.succeed({ embeddings: [[0]], model: "test", usage: { promptTokens: 0 } } as any),
} as any);

// Minimal mock EventBus layer — needed to satisfy ToolServiceLive dependency
const mockEventBusLayer = Layer.succeed(EventBus, {
  publish: () => Effect.void,
  subscribe: () => Effect.succeed({ unsubscribe: Effect.void }),
} as any);

// Combined dependency layers
const depsLayer = Layer.merge(mockLLMLayer, mockEventBusLayer);
const toolLayer = Layer.provide(ToolServiceLive, depsLayer);
const fullLayer = Layer.merge(Layer.merge(toolLayer, depsLayer), mockLLMLayer);

describe("Recall tool auto-registration", () => {
  it("should include recall in tool schemas when metaTools.recall is true", async () => {
    const program = Effect.gen(function* () {
      const snapshot = yield* resolveExecutableToolCapabilities({
        availableToolSchemas: [],
        metaTools: {
          brief: true,
          pulse: true,
          recall: true,
          find: true,
          checkpoint: true,
        },
      });
      return snapshot;
    });

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    const recallSchema = snapshot.availableToolSchemas.find(
      (s: { name: string }) => s.name === "recall",
    );
    expect(recallSchema).toBeDefined();
    expect(recallSchema!.name).toBe("recall");
  }, 15000);

  it("should NOT include recall when metaTools.recall is false", async () => {
    const program = Effect.gen(function* () {
      const snapshot = yield* resolveExecutableToolCapabilities({
        availableToolSchemas: [],
        metaTools: {
          brief: true,
          pulse: true,
          recall: false,
          find: true,
          checkpoint: true,
        },
      });
      return snapshot;
    });

    const snapshot = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));

    const recallSchema = snapshot.availableToolSchemas.find(
      (s: { name: string }) => s.name === "recall",
    );
    expect(recallSchema).toBeUndefined();
  }, 15000);

  it("should register recall as a working tool via ToolService", async () => {
    const program = Effect.gen(function* () {
      // First resolve tool capabilities (which registers recall)
      yield* resolveExecutableToolCapabilities({
        availableToolSchemas: [],
        metaTools: { recall: true },
      });

      // Now verify recall is callable via ToolService
      const toolService = yield* ToolService;
      const result = yield* toolService.execute({
        toolName: "recall",
        arguments: {},
        agentId: "test-agent",
        sessionId: "test-session",
      });

      return result;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(fullLayer)));
    // LIST mode (no args) should return entries info
    expect(result).toBeDefined();
    expect((result as any).result).toBeDefined();
  }, 15000);
});
