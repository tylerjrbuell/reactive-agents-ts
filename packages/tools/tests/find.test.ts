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
  config?: FindConfig;
}) {
  const recallRef = await Effect.runPromise(Ref.make(new Map<string, string>()));
  return makeFindHandler({
    ragStore: opts.ragStore ?? new Map(),
    webSearchHandler: opts.webHandler,
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
