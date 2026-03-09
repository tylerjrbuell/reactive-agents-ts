/**
 * Semantic Memory Extraction Tests
 *
 * Verifies that MemoryExtractor is automatically called during the
 * memory-flush phase when meaningful content is present (tool calls
 * or substantial response), and that extracted entries are stored
 * via MemoryService.storeSemantic().
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context, Ref } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// ─── Mock Primitives ───────────────────────────────────────────────────────

function makeMockLLM(opts: {
  content?: string;
  toolCalls?: unknown[];
  tokens?: number;
}) {
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
          content: opts.content ?? "FINAL ANSWER: Task completed.",
          stopReason: "end_turn",
          toolCalls: isFirstCall ? (opts.toolCalls ?? []) : [],
          usage: {
            inputTokens: 100,
            outputTokens: opts.tokens ?? 50,
            totalTokens: (opts.tokens ?? 50) + 100,
            estimatedCost: 0.001,
          },
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
    listTools: () => Effect.succeed([
      { name: "web_search", description: "Search the web" },
    ]),
    execute: (params) => Effect.succeed({
      result: `Mock result from ${params.toolName}`,
    }),
    toFunctionCallingFormat: () => Effect.succeed([
      { name: "web_search", description: "Search the web", input_schema: { type: "object", properties: {} } },
    ]),
  },
);

const mockTask = (input = "What is 2+2?") => ({
  id: `task-${Date.now()}` as any,
  agentId: "test-agent" as any,
  type: "query" as const,
  input: { question: input },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
});

function makeEngine(config?: Partial<import("../src/types.js").ReactiveAgentsConfig>) {
  const base = defaultReactiveAgentsConfig("test-agent", config);
  const engineLayer = ExecutionEngineLive(base).pipe(
    Layer.provide(LifecycleHookRegistryLive),
  );
  return { config: base, engineLayer };
}

// ─── Mock MemoryExtractor ──────────────────────────────────────────────────

function makeMockExtractor(extractedEntries: unknown[] = []) {
  const calls: { agentId: string; messages: readonly { role: string; content: string }[] }[] = [];

  const layer = Layer.succeed(
    Context.GenericTag<{
      extractFromConversation: (
        agentId: string,
        messages: readonly { role: string; content: string }[],
      ) => Effect.Effect<unknown[], unknown>;
    }>("MemoryExtractor"),
    {
      extractFromConversation: (agentId, messages) => {
        calls.push({ agentId, messages });
        return Effect.succeed(extractedEntries);
      },
    },
  );

  return { layer, calls };
}

// ─── Mock MemoryService (storeSemantic tracking) ───────────────────────────

function makeMockMemoryService() {
  const storedEntries: unknown[] = [];
  const episodes: unknown[] = [];
  const snapshots: unknown[] = [];

  const layer = Layer.succeed(
    Context.GenericTag<{
      bootstrap: (agentId: string) => Effect.Effect<unknown>;
      storeSemantic: (entry: unknown) => Effect.Effect<string>;
      logEpisode: (episode: unknown) => Effect.Effect<void>;
      snapshot: (s: unknown) => Effect.Effect<void>;
      flush: (agentId: string) => Effect.Effect<void>;
    }>("MemoryService"),
    {
      bootstrap: (_agentId) => Effect.succeed({ agentId: _agentId, semanticContext: "", recentEpisodes: [] }),
      storeSemantic: (entry) => {
        storedEntries.push(entry);
        return Effect.succeed("mem-stored-1");
      },
      logEpisode: (episode) => {
        episodes.push(episode);
        return Effect.void;
      },
      snapshot: (s) => {
        snapshots.push(s);
        return Effect.void;
      },
      flush: (_agentId) => Effect.void,
    },
  );

  return { layer, storedEntries, episodes, snapshots };
}

// ─── TESTS ─────────────────────────────────────────────────────────────────

describe("Semantic memory extraction during memory-flush", () => {
  it("extracts semantic memories when tool calls were made", async () => {
    const extractedEntries = [
      { id: "mem-1", agentId: "test-agent", content: "The web search returned useful info about addition.", summary: "addition info", importance: 0.6, verified: false, tags: ["math"] },
    ];
    const extractor = makeMockExtractor(extractedEntries);
    const memService = makeMockMemoryService();
    const { engineLayer } = makeEngine();

    // LLM makes a tool call on first request, then returns final answer
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: The answer is 4.",
      toolCalls: [{ id: "tc-1", name: "web_search", input: { query: "2+2" } }],
    });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      MockToolServiceLayer,
      extractor.layer,
      memService.layer,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // MemoryExtractor.extractFromConversation should have been called
    expect(extractor.calls.length).toBeGreaterThanOrEqual(1);
    expect(extractor.calls[0]!.agentId).toBe("test-agent");

    // Extracted entries should have been stored via MemoryService.storeSemantic
    expect(memService.storedEntries.length).toBe(1);
    expect((memService.storedEntries[0] as any).content).toBe(
      "The web search returned useful info about addition.",
    );
  });

  it("extracts semantic memories when response is substantial (>200 chars)", async () => {
    const longResponse = "FINAL ANSWER: " + "A".repeat(250);
    const extractedEntries = [
      { id: "mem-2", agentId: "test-agent", content: "Long response knowledge.", summary: "knowledge", importance: 0.5, verified: false, tags: [] },
    ];
    const extractor = makeMockExtractor(extractedEntries);
    const memService = makeMockMemoryService();
    const { engineLayer } = makeEngine();

    // No tool calls, but substantial response
    const llmLayer = makeMockLLM({ content: longResponse });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      extractor.layer,
      memService.layer,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Should extract because response is > 200 chars
    expect(extractor.calls.length).toBeGreaterThanOrEqual(1);
    expect(memService.storedEntries.length).toBe(1);
  });

  it("does NOT extract for trivial responses without tool calls", async () => {
    const extractor = makeMockExtractor([]);
    const memService = makeMockMemoryService();
    const { engineLayer } = makeEngine();

    // Short response, no tool calls
    const llmLayer = makeMockLLM({ content: "FINAL ANSWER: 4" });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      extractor.layer,
      memService.layer,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    // Extractor should NOT have been called (short response, no tools)
    expect(extractor.calls.length).toBe(0);
    expect(memService.storedEntries.length).toBe(0);
  });

  it("works without MemoryExtractor (backward compat)", async () => {
    const memService = makeMockMemoryService();
    const { engineLayer } = makeEngine();

    // Tool calls present but no MemoryExtractor layer
    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: The answer is 4.",
      toolCalls: [{ id: "tc-1", name: "web_search", input: { query: "2+2" } }],
    });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      MockToolServiceLayer,
      memService.layer,
    );

    // Should complete without errors even without MemoryExtractor
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // No semantic entries stored since extractor is absent
    expect(memService.storedEntries.length).toBe(0);
  });

  it("swallows extraction errors without failing execution", async () => {
    const failingExtractorLayer = Layer.succeed(
      Context.GenericTag<{
        extractFromConversation: (
          agentId: string,
          messages: readonly { role: string; content: string }[],
        ) => Effect.Effect<unknown[], unknown>;
      }>("MemoryExtractor"),
      {
        extractFromConversation: (_agentId: string, _messages: readonly { role: string; content: string }[]) =>
          Effect.fail(new Error("Extraction blew up!")),
      },
    );

    const memService = makeMockMemoryService();
    const { engineLayer } = makeEngine();

    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: The answer is 4.",
      toolCalls: [{ id: "tc-1", name: "web_search", input: { query: "2+2" } }],
    });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      MockToolServiceLayer,
      failingExtractorLayer,
      memService.layer,
    );

    // Should succeed despite extraction failure
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // No entries stored since extraction failed
    expect(memService.storedEntries.length).toBe(0);
  });

  it("works without MemoryService (extraction skips storage)", async () => {
    const extractedEntries = [
      { id: "mem-1", agentId: "test-agent", content: "Some knowledge", summary: "knowledge", importance: 0.5, verified: false, tags: [] },
    ];
    const extractor = makeMockExtractor(extractedEntries);
    const { engineLayer } = makeEngine();

    const llmLayer = makeMockLLM({
      content: "FINAL ANSWER: The answer is 4.",
      toolCalls: [{ id: "tc-1", name: "web_search", input: { query: "2+2" } }],
    });

    const testLayer = Layer.mergeAll(
      engineLayer,
      llmLayer,
      MockToolServiceLayer,
      extractor.layer,
    );

    // Should succeed even without MemoryService
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask());
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    // Extractor was called but storage was skipped (no MemoryService)
    expect(extractor.calls.length).toBeGreaterThanOrEqual(1);
  });
});
