import { describe, it, expect, beforeEach } from "bun:test";
import { Effect, Ref } from "effect";
import { readFileSync } from "node:fs";
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

// Live repro (Cortex chat, 9B local model, 2026-11-10): asked about "the loaded
// Cortex README document", the model did not know which documents existed,
// searched "README" (scope "files", healed to documents) and got 0 results,
// because search matched chunk text and "README" is only in the identifier.
describe("find document names (identifier lookup + discoverability)", () => {
  async function storeWith(docs: ReadonlyArray<readonly [source: string, content: string]>): Promise<RagMemoryStore> {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    for (const [source, content] of docs) {
      await Effect.runPromise(ingest({ content, source }));
    }
    return ragStore;
  }

  const DOCS = [
    ["apps/cortex/README.md", "Cortex is the local studio for inspecting agent runs and chatting with agents."],
    ["packages/tools/README.md", "The tools package registers built-in capabilities such as find and shell-execute."],
    ["notes.txt", "Quarterly planning about release cadence."],
  ] as const;

  const run = async (ragStore: RagMemoryStore, args: Record<string, unknown>) =>
    (await Effect.runPromise(
      (await buildHandler({ ragStore, config: { webFallback: false, autoStoreThreshold: 100_000 } }))(args),
    )) as {
      results: Array<{ identifier: string; content: string }>;
      totalResults: number;
      documents?: string[];
      outline?: Record<string, string[]>;
      hint?: string;
    };

  it("query 'README'(scope 'files') returns the README documents' chunks", async () => {
    const result = await run(await storeWith(DOCS), { query: "README", scope: "files" });
    expect(result.totalResults).toBeGreaterThanOrEqual(2);
    expect(result.results.map((r) => r.identifier).sort()).toEqual(["cortex/README.md", "tools/README.md"]);
    // Name-only query: each matched document's outline plus a search-its-content hint.
    expect(Object.keys(result.outline ?? {})).toEqual(["cortex/README.md", "tools/README.md"]);
    expect(result.hint).toStartWith("Matched documents 'cortex/README.md', 'tools/README.md' by name.");
  });

  it("'README.md' also matches by name", async () => {
    const result = await run(await storeWith(DOCS), { query: "README.md", scope: "documents" });
    expect(result.results.map((r) => r.identifier)).toContain("cortex/README.md");
  });

  it("'cortex readme' ranks the cortex README first and only it by name", async () => {
    const result = await run(await storeWith(DOCS), { query: "cortex readme", scope: "documents" });
    expect(result.results[0]!.identifier).toBe("cortex/README.md");
    expect(result.results.map((r) => r.identifier)).not.toContain("tools/README.md");
  });

  it("a name-matched document with no query term in its text still returns its first chunk", async () => {
    const result = await run(await storeWith(DOCS), { query: "notes", scope: "documents" });
    expect(result.results[0]!.identifier).toBe("notes.txt");
    // No headings: the outline is the first line of each chunk.
    expect(result.outline).toEqual({ "notes.txt": ["Quarterly planning about release cadence."] });
  });

  it("a word that is only part of a name does not match by name", async () => {
    // "tools" is a path segment of packages/tools/README.md but not its basename.
    const result = await run(await storeWith(DOCS), { query: "zebra tools", scope: "documents" });
    expect(result.results.map((r) => r.identifier)).toEqual(["tools/README.md"]); // content hit only
  });

  it("every documents result lists the loaded document names (duplicate basenames by shortest unique path suffix)", async () => {
    const result = await run(await storeWith(DOCS), { query: "Cortex", scope: "documents" });
    expect(result.documents).toEqual(["cortex/README.md", "tools/README.md", "notes.txt"]);
  });

  it("an empty documents result carries the names and a one-line hint", async () => {
    const result = await run(await storeWith(DOCS), { query: "zebra", scope: "documents" });
    expect(result.totalResults).toBe(0);
    expect(result.documents).toEqual(["cortex/README.md", "tools/README.md", "notes.txt"]);
    expect(result.hint).toBe(
      "No passage matched 'zebra'. Loaded documents: cortex/README.md, tools/README.md, notes.txt. Try a content keyword from the question.",
    );
  });

  it("caps the names at 8 plus 'and N more'", async () => {
    const many = Array.from({ length: 11 }, (_, i) => [`doc-${i}.md`, `body ${i}`] as const);
    const result = await run(await storeWith(many), { query: "zebra", scope: "documents" });
    expect(result.documents).toHaveLength(9);
    expect(result.documents![7]).toBe("doc-7.md");
    expect(result.documents![8]).toBe("and 3 more");
  });

  it("no document fields when no documents are loaded", async () => {
    const result = await run(new Map(), { query: "README", scope: "documents" });
    expect(result.documents).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it("the definition tells the model to query with the fact's words and that results list the documents", () => {
    expect(findTool.description).toContain("query with the words of the fact you need, not the document's name");
    expect(findTool.description).toContain("document results list the loaded document names");
  });
});

// Live repro #2 (Cortex chat, 9B local model, 2026-11-10): asked which env var
// sets the Cortex server port, the model called find({query:"Cortex README"}).
// The README's env-var chunk ranked first, but the auto-store preview cut every
// result to its first 200 chars, so the `CORTEX_PORT` row never reached the
// model, and each record spent its budget on the absolute identifier. The
// model answered "I couldn't find a Cortex README document".
describe("find over the real Cortex README (name-only queries, focused previews, compact ids)", () => {
  const README = readFileSync(new URL("./fixtures/cortex-README.md", import.meta.url), "utf8");
  const README_ID = "/home/user/proj/apps/cortex/README.md";

  async function readmeStore(): Promise<RagMemoryStore> {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(ingest({ content: README, source: README_ID }));
    await Effect.runPromise(ingest({ content: "Quarterly planning about release cadence.", source: "/home/user/proj/notes.txt" }));
    return ragStore;
  }

  // Default config: the live run hit the 800-char auto-store threshold.
  const run = async (query: string) =>
    (await Effect.runPromise(
      (await buildHandler({ ragStore: await readmeStore(), config: { webFallback: false } }))({ query }),
    )) as {
      results: Array<{ identifier: string; content: string; chunkIndex?: number }>;
      storedAs?: string;
      documents?: string[];
      outline?: Record<string, string[]>;
      hint?: string;
    };

  it("(a) 'Cortex README' returns the README outline and a hint to search its content", async () => {
    const result = await run("Cortex README");
    expect(result.outline?.["README.md"]).toEqual([
      "# Cortex",
      "## Prerequisites",
      "## Start everything (recommended for review)",
      "### Two terminals (optional)",
      "## Environment",
      "## Security note (Lab — host shell)",
      "## Production-style UI (single port)",
      "## Tests",
      "## UI checks",
      "## Plans",
    ]);
    expect(result.hint).toBe(
      "Matched document 'README.md' by name. Its outline is listed. Search its content with the words of the fact you need, not the document's name, e.g. find('Prerequisites').",
    );
    // Its top chunks still come back, previewed from their start.
    expect(result.results[0]!.identifier).toBe("README.md");
    expect(result.results[0]!.content).toStartWith("# Cortex\n");
  });

  it("'the readme' is also a name-only query (filler words dropped)", async () => {
    const result = await run("the readme document");
    expect(Object.keys(result.outline ?? {})).toEqual(["README.md"]);
  });

  it("(b) 'Cortex README server port environment variable' ranks the CORTEX_PORT chunk first and previews the row", async () => {
    const result = await run("Cortex README server port environment variable");
    expect(result.storedAs).toBeDefined(); // preview path, as in the live run
    expect(result.results[0]!.content).toContain("| `CORTEX_PORT` | `4321` | HTTP + WS listen port |");
    expect(result.outline).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  it("(c) 'server port environment variable' alone finds the CORTEX_PORT row", async () => {
    const result = await run("server port environment variable");
    expect(result.results[0]!.content).toContain("| `CORTEX_PORT` | `4321` | HTTP + WS listen port |");
  });

  it("(d) document identifiers are basenames, not absolute paths", async () => {
    const result = await run("server port environment variable");
    expect(result.results.map((r) => r.identifier)).toEqual(result.results.map(() => "README.md"));
    expect(result.documents).toEqual(["README.md", "notes.txt"]);
  });
});
