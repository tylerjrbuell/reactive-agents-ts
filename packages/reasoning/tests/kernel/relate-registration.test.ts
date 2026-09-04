// Run: bun test packages/reasoning/tests/kernel/relate-registration.test.ts --timeout 15000
//
// `relate` — the dedicated relationship-map tool over the memory link graph
// (distinct from `find`, which is keyword search). It must be registered
// ONLY when BOTH the caller opts in (metaTools.relate) AND a memory adapter
// implementing AgentMemory.getRelated is actually present — requesting it
// with no such adapter is a silent no-op, not an error (mirrors find's
// webFallback-without-a-provider precedent).
import { Effect, Layer } from "effect";
import { describe, it, expect } from "bun:test";
import { resolveExecutableToolCapabilities } from "../../src/kernel/capabilities/act/tool-capabilities.js";
import { ToolService, ToolServiceLive } from "@reactive-agents/tools";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus, AgentMemory, type AgentMemoryRelatedEntry } from "@reactive-agents/core";

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

const fakeGraph: Record<string, readonly AgentMemoryRelatedEntry[]> = {
  "entry-1": [{ id: "entry-2", preview: "related content", strength: 0.92, type: "similar" }],
};
const agentMemoryLayer = Layer.succeed(AgentMemory, {
  storeSemantic: () => Effect.succeed("unused"),
  getRelated: (id: string) => Effect.succeed(fakeGraph[id] ?? []),
} as any);

// A memory-adapter stand-in with NO getRelated — pins the "opted in but no
// graph-capable adapter present" no-op path distinctly from "no AgentMemory
// port at all".
const agentMemoryWithoutGetRelatedLayer = Layer.succeed(AgentMemory, {
  storeSemantic: () => Effect.succeed("unused"),
} as any);

const withGraphLayer = Layer.mergeAll(toolLayer, depsLayer, mockLLMLayer, agentMemoryLayer);
const withoutGraphLayer = Layer.mergeAll(toolLayer, depsLayer, mockLLMLayer, agentMemoryWithoutGetRelatedLayer);
const noAgentMemoryLayer = Layer.mergeAll(toolLayer, depsLayer, mockLLMLayer);

describe("relate tool registration", () => {
  it("is NOT registered when metaTools.relate is unset, even with a graph-capable adapter present", async () => {
    const snapshot = await Effect.runPromise(
      resolveExecutableToolCapabilities({ availableToolSchemas: [], metaTools: { recall: true } }).pipe(
        Effect.provide(withGraphLayer),
      ),
    );
    expect(snapshot.availableToolSchemas.find((s) => s.name === "relate")).toBeUndefined();
  }, 15000);

  it("is NOT registered when opted in but no AgentMemory port is provided", async () => {
    const snapshot = await Effect.runPromise(
      resolveExecutableToolCapabilities({ availableToolSchemas: [], metaTools: { relate: true } }).pipe(
        Effect.provide(noAgentMemoryLayer),
      ),
    );
    expect(snapshot.availableToolSchemas.find((s) => s.name === "relate")).toBeUndefined();
  }, 15000);

  it("is NOT registered when opted in and AgentMemory is present but lacks getRelated", async () => {
    const snapshot = await Effect.runPromise(
      resolveExecutableToolCapabilities({ availableToolSchemas: [], metaTools: { relate: true } }).pipe(
        Effect.provide(withoutGraphLayer),
      ),
    );
    expect(snapshot.availableToolSchemas.find((s) => s.name === "relate")).toBeUndefined();
  }, 15000);

  it("IS registered and callable when opted in AND a graph-capable adapter is present", async () => {
    const program = Effect.gen(function* () {
      const snapshot = yield* resolveExecutableToolCapabilities({
        availableToolSchemas: [],
        metaTools: { relate: true },
      });
      const toolService = yield* ToolService;
      const result = yield* toolService.execute({
        toolName: "relate",
        arguments: { id: "entry-1", mode: "links" },
        agentId: "test-agent",
        sessionId: "test-session",
      });
      return { snapshot, result };
    });

    const { snapshot, result } = await Effect.runPromise(program.pipe(Effect.provide(withGraphLayer)));

    expect(snapshot.availableToolSchemas.find((s) => s.name === "relate")).toBeDefined();
    expect((result.result as any).entries).toEqual([
      { id: "entry-2", preview: "related content", strength: 0.92, type: "similar" },
    ]);
  }, 15000);
});
