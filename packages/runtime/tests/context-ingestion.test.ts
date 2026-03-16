import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ingestDocuments } from "../src/context-ingestion.js";
import type { DocumentSpec } from "../src/context-ingestion.js";

describe("Context Ingestion", () => {
  it("should ingest a text document into the store", async () => {
    const store = new Map();
    const docs: DocumentSpec[] = [
      { content: "The capital of France is Paris.", source: "facts.txt" },
    ];
    await Effect.runPromise(ingestDocuments(docs, store));
    expect(store.size).toBe(1);
    expect(store.has("facts.txt")).toBe(true);
    const chunks = store.get("facts.txt")!;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("capital of France");
  });

  it("should ingest multiple documents", async () => {
    const store = new Map();
    const docs: DocumentSpec[] = [
      { content: "Document one content.", source: "doc1.txt" },
      { content: "Document two content.", source: "doc2.txt" },
    ];
    await Effect.runPromise(ingestDocuments(docs, store));
    expect(store.size).toBe(2);
    expect(store.has("doc1.txt")).toBe(true);
    expect(store.has("doc2.txt")).toBe(true);
  });

  it("should respect format and chunk options", async () => {
    const store = new Map();
    const docs: DocumentSpec[] = [
      {
        content: "name,age\nAlice,30\nBob,25",
        source: "people.csv",
        format: "csv",
        chunkStrategy: "fixed",
        maxChunkSize: 500,
      },
    ];
    await Effect.runPromise(ingestDocuments(docs, store));
    expect(store.has("people.csv")).toBe(true);
    const chunks = store.get("people.csv")!;
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("should handle empty documents array", async () => {
    const store = new Map();
    await Effect.runPromise(ingestDocuments([], store));
    expect(store.size).toBe(0);
  });

  it("should handle markdown documents with section chunking", async () => {
    const store = new Map();
    const docs: DocumentSpec[] = [
      {
        content: "# Title\n\nFirst paragraph.\n\n## Section\n\nSecond paragraph.",
        source: "readme.md",
        format: "markdown",
        chunkStrategy: "markdown-sections",
      },
    ];
    await Effect.runPromise(ingestDocuments(docs, store));
    expect(store.has("readme.md")).toBe(true);
  });

  it("should accumulate chunks for the same source", async () => {
    const store = new Map();
    // Ingest twice with same source — should append
    await Effect.runPromise(
      ingestDocuments(
        [{ content: "First batch.", source: "data.txt" }],
        store,
      ),
    );
    const countAfterFirst = store.get("data.txt")!.length;
    await Effect.runPromise(
      ingestDocuments(
        [{ content: "Second batch.", source: "data.txt" }],
        store,
      ),
    );
    const countAfterSecond = store.get("data.txt")!.length;
    expect(countAfterSecond).toBeGreaterThan(countAfterFirst);
  });
});
