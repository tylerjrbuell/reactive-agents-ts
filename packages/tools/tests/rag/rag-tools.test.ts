import { describe, it, expect, beforeEach } from "bun:test";
import { Effect } from "effect";

import {
  ragIngestTool,
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
} from "../../src/skills/rag-ingest.js";
import type { RagMemoryStore } from "../../src/skills/rag-ingest.js";
import {
  ragSearchTool,
  makeRagSearchHandler,
  makeInMemorySearchCallback,
} from "../../src/skills/rag-search.js";
import { ToolExecutionError } from "../../src/errors.js";

// ─── Shared store for ingest + search integration ───

let store: RagMemoryStore;
let ingestHandler: ReturnType<typeof makeRagIngestHandler>;
let searchHandler: ReturnType<typeof makeRagSearchHandler>;

beforeEach(() => {
  store = new Map();
  ingestHandler = makeRagIngestHandler(makeInMemoryStoreCallback(store));
  searchHandler = makeRagSearchHandler(makeInMemorySearchCallback(store));
});

// ═══════════════════════════════════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════════════════════════════════

describe("RAG tool definitions", () => {
  it("rag-ingest should have correct metadata", () => {
    expect(ragIngestTool.name).toBe("rag-ingest");
    expect(ragIngestTool.source).toBe("builtin");
    expect(ragIngestTool.category).toBe("data");
    expect(ragIngestTool.riskLevel).toBe("low");
    const paramNames = ragIngestTool.parameters.map((p) => p.name);
    expect(paramNames).toContain("content");
    expect(paramNames).toContain("source");
    expect(paramNames).toContain("format");
    expect(paramNames).toContain("chunkStrategy");
    expect(paramNames).toContain("maxChunkSize");
  });

  it("rag-search should have correct metadata", () => {
    expect(ragSearchTool.name).toBe("rag-search");
    expect(ragSearchTool.source).toBe("builtin");
    expect(ragSearchTool.category).toBe("search");
    expect(ragSearchTool.riskLevel).toBe("low");
    const paramNames = ragSearchTool.parameters.map((p) => p.name);
    expect(paramNames).toContain("query");
    expect(paramNames).toContain("topK");
    expect(paramNames).toContain("source");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// rag-ingest handler
// ═══════════════════════════════════════════════════════════════════════

describe("rag-ingest handler", () => {
  it("should ingest a text document", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "Hello world. This is a test document with some content.",
        source: "test.txt",
      }),
    );
    const typed = result as { ingested: boolean; source: string; chunksStored: number };
    expect(typed.ingested).toBe(true);
    expect(typed.source).toBe("test.txt");
    expect(typed.chunksStored).toBeGreaterThanOrEqual(1);
    expect(store.size).toBe(1);
  });

  it("should ingest markdown with explicit format", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "# Title\n\nParagraph 1.\n\n## Section\n\nParagraph 2.",
        source: "doc.md",
        format: "markdown",
      }),
    );
    const typed = result as { ingested: boolean; format: string; chunksStored: number };
    expect(typed.ingested).toBe(true);
    expect(typed.format).toBe("markdown");
    expect(typed.chunksStored).toBeGreaterThanOrEqual(1);
  });

  it("should ingest CSV", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "name,age\nAlice,30\nBob,25",
        source: "people.csv",
        format: "csv",
      }),
    );
    const typed = result as { ingested: boolean; chunksStored: number };
    expect(typed.ingested).toBe(true);
    expect(typed.chunksStored).toBeGreaterThanOrEqual(1);
  });

  it("should ingest JSON", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: JSON.stringify([{ name: "Alice" }, { name: "Bob" }]),
        source: "data.json",
        format: "json",
      }),
    );
    const typed = result as { ingested: boolean; chunksStored: number };
    expect(typed.ingested).toBe(true);
    expect(typed.chunksStored).toBeGreaterThanOrEqual(1);
  });

  it("should ingest HTML", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "<html><body><p>Hello world</p></body></html>",
        source: "page.html",
        format: "html",
      }),
    );
    const typed = result as { ingested: boolean; chunksStored: number };
    expect(typed.ingested).toBe(true);
    expect(typed.chunksStored).toBeGreaterThanOrEqual(1);
  });

  it("should auto-detect format from source extension", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "# Heading\n\nContent here.",
        source: "readme.md",
      }),
    );
    const typed = result as { format: string };
    expect(typed.format).toBe("markdown");
  });

  it("should respect chunkStrategy parameter", async () => {
    const content = "Sentence one. Sentence two. Sentence three.";
    await Effect.runPromise(
      ingestHandler({
        content,
        source: "sentences.txt",
        chunkStrategy: "sentence",
      }),
    );
    expect(store.has("sentences.txt")).toBe(true);
  });

  it("should respect maxChunkSize parameter", async () => {
    const content = Array(20).fill("Word").join(" ");
    await Effect.runPromise(
      ingestHandler({
        content,
        source: "small-chunks.txt",
        maxChunkSize: 20,
        chunkStrategy: "fixed",
      }),
    );
    const chunks = store.get("small-chunks.txt")!;
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(30);
    }
  });

  it("should handle empty document gracefully", async () => {
    const result = await Effect.runPromise(
      ingestHandler({
        content: "   ",
        source: "empty.txt",
      }),
    );
    const typed = result as { chunksStored: number };
    expect(typed.chunksStored).toBe(0);
  });

  it("should fail without content parameter", async () => {
    const error = await Effect.runPromise(
      ingestHandler({ source: "test.txt" }).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect(error.toolName).toBe("rag-ingest");
  });

  it("should fail without source parameter", async () => {
    const error = await Effect.runPromise(
      ingestHandler({ content: "hello" }).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect(error.toolName).toBe("rag-ingest");
  });

  it("should accumulate chunks from multiple ingests to same source", async () => {
    await Effect.runPromise(
      ingestHandler({ content: "First batch.", source: "doc.txt" }),
    );
    await Effect.runPromise(
      ingestHandler({ content: "Second batch.", source: "doc.txt" }),
    );
    const chunks = store.get("doc.txt")!;
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// rag-search handler
// ═══════════════════════════════════════════════════════════════════════

describe("rag-search handler", () => {
  it("should find relevant chunks after ingest", async () => {
    await Effect.runPromise(
      ingestHandler({
        content: "TypeScript is a typed superset of JavaScript. It compiles to plain JavaScript.",
        source: "typescript.txt",
      }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "TypeScript JavaScript" }),
    );
    const typed = result as { query: string; results: Array<{ content: string; score: number }> };
    expect(typed.query).toBe("TypeScript JavaScript");
    expect(typed.results.length).toBeGreaterThanOrEqual(1);
    expect(typed.results[0]!.score).toBeGreaterThan(0);
  });

  it("should return empty results for no matches", async () => {
    await Effect.runPromise(
      ingestHandler({ content: "Apples and oranges.", source: "fruit.txt" }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "quantum physics neutron" }),
    );
    const typed = result as { results: unknown[] };
    expect(typed.results.length).toBe(0);
  });

  it("should respect topK parameter", async () => {
    // Ingest a document with many chunks
    const content = Array(20)
      .fill(null)
      .map((_, i) => `Section ${i}: TypeScript feature number ${i} is great.`)
      .join("\n\n");
    await Effect.runPromise(
      ingestHandler({ content, source: "features.txt", maxChunkSize: 100 }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "TypeScript feature", topK: 3 }),
    );
    const typed = result as { results: unknown[] };
    expect(typed.results.length).toBeLessThanOrEqual(3);
  });

  it("should filter by source when specified", async () => {
    await Effect.runPromise(
      ingestHandler({ content: "TypeScript types are great.", source: "ts.txt" }),
    );
    await Effect.runPromise(
      ingestHandler({ content: "Python types are also nice.", source: "py.txt" }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "types", source: "ts.txt" }),
    );
    const typed = result as { results: Array<{ source: string }> };
    for (const r of typed.results) {
      expect(r.source).toBe("ts.txt");
    }
  });

  it("should fail without query parameter", async () => {
    const error = await Effect.runPromise(
      searchHandler({}).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(ToolExecutionError);
    expect(error.toolName).toBe("rag-search");
  });

  it("should return results sorted by relevance score", async () => {
    await Effect.runPromise(
      ingestHandler({
        content: "TypeScript TypeScript TypeScript is amazing.\n\nJava is different from TypeScript.",
        source: "comparison.txt",
        maxChunkSize: 60,
      }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "TypeScript" }),
    );
    const typed = result as { results: Array<{ score: number }> };
    if (typed.results.length >= 2) {
      expect(typed.results[0]!.score).toBeGreaterThanOrEqual(typed.results[1]!.score);
    }
  });

  it("should return correct metadata in results", async () => {
    await Effect.runPromise(
      ingestHandler({
        content: "Effect-TS is a functional programming library for TypeScript.",
        source: "effect.txt",
      }),
    );

    const result = await Effect.runPromise(
      searchHandler({ query: "Effect functional" }),
    );
    const typed = result as {
      results: Array<{ content: string; source: string; chunkIndex: number; score: number }>;
    };
    if (typed.results.length > 0) {
      const first = typed.results[0]!;
      expect(first.source).toBe("effect.txt");
      expect(typeof first.chunkIndex).toBe("number");
      expect(typeof first.score).toBe("number");
      expect(typeof first.content).toBe("string");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// End-to-end: ingest + search
// ═══════════════════════════════════════════════════════════════════════

describe("RAG end-to-end", () => {
  it("should ingest multiple documents and search across all", async () => {
    await Effect.runPromise(
      ingestHandler({
        content: "React is a JavaScript library for building user interfaces.",
        source: "react.md",
      }),
    );
    await Effect.runPromise(
      ingestHandler({
        content: "Vue is a progressive JavaScript framework for building UIs.",
        source: "vue.md",
      }),
    );
    await Effect.runPromise(
      ingestHandler({
        content: "Rust is a systems programming language focused on safety.",
        source: "rust.md",
      }),
    );

    // Search for JavaScript — should match react.md and vue.md but not rust.md
    const result = await Effect.runPromise(
      searchHandler({ query: "JavaScript library" }),
    );
    const typed = result as { results: Array<{ source: string }> };
    const sources = typed.results.map((r) => r.source);
    expect(sources).toContain("react.md");
    expect(sources).toContain("vue.md");
    expect(sources).not.toContain("rust.md");
  });

  it("should handle ingest with markdown-sections and search", async () => {
    const markdown = [
      "# API Guide",
      "",
      "Welcome to the API guide.",
      "",
      "## Authentication",
      "",
      "Use Bearer tokens for authentication. Pass the token in the Authorization header.",
      "",
      "## Endpoints",
      "",
      "GET /users returns a list of users. POST /users creates a new user.",
    ].join("\n");

    await Effect.runPromise(
      ingestHandler({
        content: markdown,
        source: "api-guide.md",
        chunkStrategy: "markdown-sections",
      }),
    );

    const authResult = await Effect.runPromise(
      searchHandler({ query: "authentication token" }),
    );
    const authTyped = authResult as { results: Array<{ content: string }> };
    expect(authTyped.results.length).toBeGreaterThanOrEqual(1);
    expect(authTyped.results[0]!.content).toContain("Bearer");
  });
});
