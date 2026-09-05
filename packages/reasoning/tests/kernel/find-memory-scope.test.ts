// Run: bun test packages/reasoning/tests/kernel/find-memory-scope.test.ts --timeout 15000
//
// 2026-09-03: find(scope:"memory") had no live search source in production —
// only a flat `bootstrapMemoryContent` string that was never populated by
// the real kernel wiring — and its "results" carried a synthetic
// "memory-bootstrap" identifier the model could never act on. Fixed by
// wiring find's `searchMemory` to `AgentMemory.search` (the same optional
// port method `relate` uses `getRelated` from), so find() now returns REAL
// per-entry ids a model can chain straight into relate(id).
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { resolveExecutableToolCapabilities } from "../../src/kernel/capabilities/act/tool-capabilities.js";
import { ToolService, ToolServiceLive } from "@reactive-agents/tools";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  EventBus,
  AgentMemory,
  type AgentMemorySearchResult,
  type AgentMemoryRelatedEntry,
} from "@reactive-agents/core";

const mockLLMLayer = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({ content: "", usage: { promptTokens: 0, completionTokens: 0 }, model: "test" } as any),
  stream: () => Effect.succeed({ content: "", usage: { promptTokens: 0, completionTokens: 0 }, model: "test" } as any),
  embed: () => Effect.succeed({ embeddings: [[0]], model: "test", usage: { promptTokens: 0 } } as any),
} as any);
const mockEventBusLayer = Layer.succeed(EventBus, {
  publish: () => Effect.void,
  subscribe: () => Effect.succeed({ unsubscribe: Effect.void }),
} as any);
const depsLayer = Layer.merge(mockLLMLayer, mockEventBusLayer);
const toolLayer = Layer.provide(ToolServiceLive, depsLayer);

const fakeSearch: Record<string, readonly AgentMemorySearchResult[]> = {
  "dependency injection": [{ id: "real-entry-1", preview: "Effect-TS DI via Context.Tag" }],
};
const fakeGraph: Record<string, readonly AgentMemoryRelatedEntry[]> = {
  "real-entry-1": [{ id: "real-entry-2", preview: "related content", strength: 0.95, type: "similar" }],
};

const agentMemoryLayer = Layer.succeed(AgentMemory, {
  storeSemantic: () => Effect.succeed("unused"),
  search: (query: string) => Effect.succeed(fakeSearch[query] ?? []),
  getRelated: (id: string) => Effect.succeed(fakeGraph[id] ?? []),
} as any);

const fullLayer = Layer.mergeAll(toolLayer, depsLayer, mockLLMLayer, agentMemoryLayer);

describe("find(scope: memory) -> relate(id) chaining", () => {
  it("find returns a real per-entry id, and that id is directly usable by relate", async () => {
    const program = Effect.gen(function* () {
      yield* resolveExecutableToolCapabilities({
        availableToolSchemas: [],
        metaTools: { find: true, relate: true },
      });
      const toolService = yield* ToolService;

      const findResult = yield* toolService.execute({
        toolName: "find",
        arguments: { query: "dependency injection", scope: "memory" },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      const findPayload = findResult.result as any;
      const realId = findPayload.results[0].identifier;

      const relateResult = yield* toolService.execute({
        toolName: "relate",
        arguments: { id: realId, mode: "links" },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      return { findPayload, realId, relateResult };
    });

    const { findPayload, realId, relateResult } = await Effect.runPromise(
      program.pipe(Effect.provide(fullLayer)),
    );

    expect(findPayload.results[0].identifier).toBe("real-entry-1");
    expect(findPayload.results[0].identifier).not.toBe("memory-bootstrap");
    expect(realId).toBe("real-entry-1");
    expect((relateResult.result as any).entries).toEqual([
      { id: "real-entry-2", preview: "related content", strength: 0.95, type: "similar" },
    ]);
  }, 15000);

  it("find(scope: memory) returns no results (not an error) when AgentMemory has no search method", async () => {
    const noSearchLayer = Layer.mergeAll(
      toolLayer,
      depsLayer,
      mockLLMLayer,
      Layer.succeed(AgentMemory, { storeSemantic: () => Effect.succeed("unused") } as any),
    );

    const program = Effect.gen(function* () {
      yield* resolveExecutableToolCapabilities({ availableToolSchemas: [], metaTools: { find: true } });
      const toolService = yield* ToolService;
      return yield* toolService.execute({
        toolName: "find",
        arguments: { query: "anything", scope: "memory" },
        agentId: "test-agent",
        sessionId: "test-session",
      });
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(noSearchLayer)));
    expect((result.result as any).totalResults).toBe(0);
  }, 15000);
});
