// Run: bun test packages/reasoning/tests/kernel/find-document-store-scope.test.ts --timeout 15000
//
// 2026-11-05: documents are per agent by default. `find` resolves the run's
// document store from the tools `documentStoreSlot` run slot unless a store
// is passed explicitly — and the kernel used to pass the process-wide
// `ragMemoryStore`, pinning every agent's find to the shared store. This pins
// that the kernel-registered find searches the store bound to the run
// (`bindRun(documentStoreSlot, …)`), not the process-wide default.
import { Effect, Layer } from "effect";
import { describe, it, expect, afterEach } from "bun:test";
import { resolveExecutableToolCapabilities } from "../../src/kernel/capabilities/act/tool-capabilities.js";
import {
  ToolService,
  ToolServiceLive,
  createDocumentStore,
  defaultDocumentStore,
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
  type RagMemoryStore,
} from "@reactive-agents/tools";
import { documentStoreSlot } from "@reactive-agents/tools/internal/run-slots";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus, rootContext } from "@reactive-agents/core";
import { bindRun, withRunScope } from "@reactive-agents/core/internal/run-scope";

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
const fullLayer = Layer.mergeAll(Layer.provide(ToolServiceLive, depsLayer), depsLayer);

const ingest = (store: RagMemoryStore, source: string, content: string) =>
  makeRagIngestHandler(makeInMemoryStoreCallback(store))({ content, source });

const identifiers = (result: unknown): string[] =>
  ((result as { results?: Array<{ identifier: string }> }).results ?? []).map((r) => r.identifier);

const DEFAULT_SOURCE = "kernel-find-default-store-doc-b.md";

afterEach(() => {
  defaultDocumentStore.delete(DEFAULT_SOURCE);
});

describe("kernel-registered find searches the run's bound document store", () => {
  it("returns docs from the run-bound document store and not the process-wide default", async () => {
    const agentStore = createDocumentStore();
    await Effect.runPromise(ingest(agentStore, "agent-doc-a.md", "The pangolin ledger records quarterly cobalt shipments."));
    await Effect.runPromise(ingest(defaultDocumentStore, DEFAULT_SOURCE, "The pangolin ledger records quarterly cobalt shipments."));

    const program = Effect.gen(function* () {
      yield* resolveExecutableToolCapabilities({ availableToolSchemas: [], metaTools: { find: true } });
      const toolService = yield* ToolService;
      const result = yield* toolService.execute({
        toolName: "find",
        arguments: { query: "pangolin ledger cobalt", scope: "documents" },
        agentId: "test-agent",
        sessionId: "test-session",
      });
      return result.result;
    });

    const payload = await Effect.runPromise(
      program.pipe(
        withRunScope(rootContext("find-doc-scope", "test-agent"), bindRun(documentStoreSlot, agentStore)),
        Effect.provide(fullLayer),
      ),
    );

    const ids = identifiers(payload);
    expect(ids).toContain("agent-doc-a.md");
    expect(ids).not.toContain(DEFAULT_SOURCE);
  }, 15000);
});
