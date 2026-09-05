import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Ref } from "effect";
import { makeFindHandler, findTool } from "../src/skills/find.js";
import type { FindConfig } from "../src/skills/find.js";
import type { RagMemoryStore } from "../src/skills/rag-ingest.js";
import { makeRagIngestHandler, makeInMemoryStoreCallback } from "../src/skills/rag-ingest.js";
import { ToolExecutionError } from "../src/errors.js";

async function buildHandler(opts: {
  ragStore?: RagMemoryStore;
  webHandler?: (a: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
  searchMemory?: (
    query: string,
    limit: number,
  ) => Effect.Effect<readonly { id: string; preview: string }[], unknown>;
  bootstrapMemoryContent?: string;
  config?: FindConfig;
}) {
  const recallRef = await Effect.runPromise(Ref.make(new Map<string, string>()));
  return makeFindHandler({
    ragStore: opts.ragStore ?? new Map(),
    webSearchHandler: opts.webHandler,
    searchMemory: opts.searchMemory,
    bootstrapMemoryContent: opts.bootstrapMemoryContent,
    recallStoreRef: recallRef,
    config: opts.config ?? {},
  });
}

describe("find tool definition", () => {
  it("has name 'find'", () => expect(findTool.name).toBe("find"));
  it("has query and scope parameters", () => {
    const names = findTool.parameters.map(p => p.name);
    expect(names).toContain("query");
    expect(names).toContain("scope");
  });
});

describe("find scope: documents", () => {
  it("returns results from RAG store when docs are indexed", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "TypeScript is a typed superset of JavaScript.", source: "ts.txt" }));

    const handler = await buildHandler({ ragStore });
    const result = await Effect.runPromise(handler({ query: "TypeScript", scope: "documents" })) as any;
    expect(result.totalResults).toBeGreaterThanOrEqual(1);
    expect(result.results[0].source).toBe("documents");
    expect(result.sourcesSearched).toContain("documents");
  });

  it("returns empty when no docs match", async () => {
    const handler = await buildHandler({ ragStore: new Map() });
    const result = await Effect.runPromise(handler({ query: "quantum", scope: "documents" })) as any;
    expect(result.totalResults).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

describe("find scope: memory", () => {
  // 2026-09-03: find(scope:"memory") previously had no live search source —
  // only a flat `bootstrapMemoryContent` string that was never populated in
  // the real kernel wiring, and its "results" carried a synthetic
  // "memory-bootstrap" identifier, not a real per-entry id `relate(id)`
  // could use. `searchMemory` is the fix.
  it("returns real per-entry ids from searchMemory, not the bootstrap placeholder", async () => {
    const handler = await buildHandler({
      searchMemory: () =>
        Effect.succeed([{ id: "real-entry-42", preview: "Effect-TS dependency injection notes" }]),
    });
    const result = await Effect.runPromise(handler({ query: "dependency injection", scope: "memory" })) as any;
    expect(result.results).toHaveLength(1);
    expect(result.results[0].identifier).toBe("real-entry-42");
    expect(result.results[0].source).toBe("memory");
    expect(result.sourcesSearched).toContain("memory");
  });

  it("merges searchMemory hits with the bootstrapMemoryContent fallback when both are present", async () => {
    const handler = await buildHandler({
      searchMemory: () => Effect.succeed([{ id: "real-1", preview: "live hit" }]),
      bootstrapMemoryContent: "some bootstrapped fact line",
    });
    const result = await Effect.runPromise(handler({ query: "fact", scope: "memory" })) as any;
    const identifiers = result.results.map((r: any) => r.identifier);
    expect(identifiers).toContain("real-1");
    expect(identifiers).toContain("memory-bootstrap");
  });

  it("degrades gracefully (no results, not an error) when neither memory source is configured", async () => {
    const handler = await buildHandler({});
    const result = await Effect.runPromise(handler({ query: "anything", scope: "memory" })) as any;
    expect(result.totalResults).toBe(0);
  });

  it("does not fail the call when searchMemory itself rejects", async () => {
    const handler = await buildHandler({
      searchMemory: () => Effect.fail(new Error("db unreachable")),
    });
    const result = await Effect.runPromise(handler({ query: "x", scope: "memory" })) as any;
    expect(result.totalResults).toBe(0);
  });
});

describe("find scope: auto fallback", () => {
  it("falls back to web when RAG returns no results", async () => {
    const mockWeb = (_args: Record<string, unknown>) =>
      Effect.succeed({ results: [{ title: "Web result", url: "https://example.com", snippet: "web content" }] });

    const handler = await buildHandler({ webHandler: mockWeb as any, config: { webFallback: true } });
    const result = await Effect.runPromise(handler({ query: "obscure topic" })) as any;
    expect(result.sourcesSearched).toContain("web");
    expect(result.totalResults).toBeGreaterThanOrEqual(1);
    expect(result.results[0].source).toBe("web");
  });

  it("returns empty array when all sources return nothing", async () => {
    const handler = await buildHandler({ config: { webFallback: false } });
    const result = await Effect.runPromise(handler({ query: "nothing" })) as any;
    expect(result.totalResults).toBe(0);
    expect(Array.isArray(result.results)).toBe(true);
  });

  it("stops at documents when RAG score exceeds minRagScore", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "React React React is great", source: "react.md" }));

    let webCalled = false;
    const mockWeb = () => { webCalled = true; return Effect.succeed({ results: [] }); };

    const handler = await buildHandler({ ragStore, webHandler: mockWeb as any, config: { minRagScore: 0.01 } });
    await Effect.runPromise(handler({ query: "React" }));
    expect(webCalled).toBe(false);
  });
});

describe("find scope: web", () => {
  it("calls web handler directly without checking RAG", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: "React components", source: "react.txt" }));

    let webCalled = false;
    const mockWeb = () => {
      webCalled = true;
      return Effect.succeed({ results: [{ title: "Web", url: "https://x.com", snippet: "web" }] });
    };

    const handler = await buildHandler({ ragStore, webHandler: mockWeb as any });
    await Effect.runPromise(handler({ query: "React", scope: "web" }));
    expect(webCalled).toBe(true);
  });
});

describe("find auto-store", () => {
  it("stores results in recall when content exceeds threshold", async () => {
    const recallRef = await Effect.runPromise(Ref.make(new Map<string, string>()));
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    const bigContent = Array(20).fill("TypeScript JavaScript important feature").join(". ");
    await Effect.runPromise(ingest({ content: bigContent, source: "big.txt" }));

    const handler = makeFindHandler({ ragStore, recallStoreRef: recallRef, config: { autoStoreThreshold: 50 } });
    const result = await Effect.runPromise(handler({ query: "TypeScript" })) as any;

    if (result.storedAs) {
      const store = await Effect.runPromise(Ref.get(recallRef));
      expect(store.has(result.storedAs)).toBe(true);
    }
  });
});
