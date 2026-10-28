import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Effect } from "effect";
import { ingestDocuments } from "../src/context-ingestion.js";
import type { DocumentSpec } from "../src/context-ingestion.js";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

  it("should read file content when content field is omitted and source is a file path", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "rai-test-"));
    const filePath = join(tmpDir, "test-doc.md");
    writeFileSync(filePath, "# Test\n\nThis is file content from disk.", "utf8");
    try {
      const store = new Map();
      const docs: DocumentSpec[] = [
        { source: filePath, format: "markdown" },
      ];
      await Effect.runPromise(ingestDocuments(docs, store));
      expect(store.size).toBe(1);
      expect(store.has(filePath)).toBe(true);
      const chunks = store.get(filePath)!;
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.map((c: { content: string }) => c.content).join(" ")).toContain(
        "file content from disk",
      );
    } finally {
      unlinkSync(filePath);
    }
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

describe("Context Ingestion — URL sources + failure observability", () => {
  const html = "<html><head><title>T</title></head><body><p>Code action sandbox runs scripts.</p></body></html>";
  const resp = (body: string, ct: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": ct, ...headers } });

  const runWithBus = async (docs: DocumentSpec[], store: Map<string, unknown[]>, f?: (u: string) => Promise<Response>) => {
    const { EventBus, EventBusLive } = await import("@reactive-agents/core");
    const events: Array<{ _tag: string; tag?: string; message?: string }> = [];
    const prog = Effect.gen(function* () {
      const bus = yield* EventBus;
      yield* bus.on("ErrorSwallowed", (e) => Effect.sync(() => void events.push(e as never)));
      yield* ingestDocuments(docs, store as never, f ? { fetch: f } : undefined);
    }).pipe(Effect.provide(EventBusLive));
    await Effect.runPromise(prog);
    return events;
  };

  it("fetches html URL, extracts text, indexes under URL", async () => {
    const store = new Map<string, unknown[]>();
    const events = await runWithBus([{ source: "https://x.test/a" }], store, async () => resp(html, "text/html; charset=utf-8"));
    expect(events).toHaveLength(0);
    const chunks = store.get("https://x.test/a") as Array<{ content: string }>;
    expect(chunks[0]!.content).toContain("Code action sandbox");
    expect(chunks[0]!.content).not.toContain("<p>");
  });

  it("accepts markdown/plain as-is", async () => {
    const store = new Map<string, unknown[]>();
    await runWithBus([{ source: "https://x.test/m" }], store, async () => resp("# Hi\n\nbody text", "text/markdown"));
    expect(store.has("https://x.test/m")).toBe(true);
  });

  const failCases: Array<[string, string, (u: string) => Promise<Response>, string]> = [
    ["non-2xx", "https://x.test/404", async () => resp("no", "text/html", 404), "HTTP 404"],
    ["network error", "https://x.test/net", async () => { throw new Error("ECONNREFUSED"); }, "network error"],
    ["timeout", "https://x.test/to", async () => { throw new DOMException("t", "TimeoutError"); }, "timeout"],
    ["oversize", "https://x.test/big", async () => resp("x", "text/html", 200, { "content-length": String(3 * 1024 * 1024) }), "too large"],
    ["bad content-type", "https://x.test/bin", async () => resp("x", "application/pdf"), "unsupported content-type"],
    ["file scheme", "file:///etc/passwd", async () => resp("x", "text/html"), "unsupported URL scheme"],
    ["ftp scheme", "ftp://x.test/a", async () => resp("x", "text/html"), "unsupported URL scheme"],
  ];
  for (const [name, src, f, expected] of failCases) {
    it(`${name}: not indexed + DocumentIngestFailed names source and reason`, async () => {
      const store = new Map<string, unknown[]>();
      const events = await runWithBus([{ source: src }], store, f);
      expect(store.size).toBe(0);
      expect(events).toHaveLength(1);
      expect(events[0]!.tag).toBe("DocumentIngestFailed");
      expect(events[0]!.message).toContain(src);
      expect(events[0]!.message).toContain(expected);
    });
  }

  it("missing file now emits failure event; real file still works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ingest-"));
    const good = join(dir, "g.txt");
    writeFileSync(good, "hello file");
    const store = new Map<string, unknown[]>();
    const events = await runWithBus([{ source: join(dir, "nope.txt") }, { source: good }], store);
    expect(store.has(good)).toBe(true);
    expect(store.size).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toContain("nope.txt");
    unlinkSync(good);
  });
});

describe("Context Ingestion — private-host SSRF guard", () => {
  const resp = (body: string, ct: string, status = 200, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { "content-type": ct, ...headers } });
  const pub = async (): Promise<readonly string[]> => ["93.184.216.34"];

  const run = async (
    source: string,
    f: (u: string) => Promise<Response>,
    extra: { lookup?: (h: string) => Promise<readonly string[]>; allowPrivateHosts?: boolean } = {},
  ) => {
    const { EventBus, EventBusLive } = await import("@reactive-agents/core");
    const events: Array<{ tag?: string; message?: string }> = [];
    const store = new Map<string, unknown[]>();
    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        yield* bus.on("ErrorSwallowed", (e) => Effect.sync(() => void events.push(e as never)));
        yield* ingestDocuments(
          [{ source, ...(extra.allowPrivateHosts ? { allowPrivateHosts: true } : {}) }],
          store as never,
          { fetch: f, lookup: extra.lookup ?? pub },
        );
      }).pipe(Effect.provide(EventBusLive)),
    );
    return { events, store };
  };

  const blockedSources = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:8080/x",
    "http://10.0.0.5/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://localhost:3000/x",
    "http://[::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://[fd00::1]/x",
    "http://2130706433/x",
  ];
  for (const src of blockedSources) {
    it(`rejects ${src} without fetching`, async () => {
      let called = false;
      const { events, store } = await run(src, async () => {
        called = true;
        return resp("secret", "text/plain");
      });
      expect(called).toBe(false);
      expect(store.size).toBe(0);
      expect(events).toHaveLength(1);
      expect(events[0]!.tag).toBe("DocumentIngestFailed");
      expect(events[0]!.message).toContain("blocked private host");
    });
  }

  it("rejects a public hostname that resolves to a private address", async () => {
    const { events } = await run("https://evil.test/a", async () => resp("x", "text/plain"), {
      lookup: async () => ["93.184.216.34", "10.1.2.3"],
    });
    expect(events[0]!.message).toContain("blocked private host");
  });

  it("rejects a redirect hop to a private target; never fetches it", async () => {
    const seen: string[] = [];
    const { events, store } = await run("https://ok.test/a", async (u) => {
      seen.push(u);
      return resp("", "text/plain", 302, { location: "http://169.254.169.254/latest/meta-data/" });
    });
    expect(seen).toEqual(["https://ok.test/a"]);
    expect(store.size).toBe(0);
    expect(events[0]!.message).toContain("blocked private host");
  });

  it("follows a public redirect and indexes under the original source", async () => {
    const { events, store } = await run("https://ok.test/a", async (u) =>
      u === "https://ok.test/a"
        ? resp("", "text/plain", 301, { location: "/b" })
        : resp("final body", "text/plain"),
    );
    expect(events).toHaveLength(0);
    expect(store.has("https://ok.test/a")).toBe(true);
  });

  it("caps redirects at 5 hops", async () => {
    const { events } = await run("https://ok.test/0", async () =>
      resp("", "text/plain", 302, { location: "https://ok.test/next" }),
    );
    expect(events[0]!.message).toContain("too many redirects");
  });

  it("allows public hosts", async () => {
    const { events, store } = await run("https://ok.test/a", async () => resp("hi", "text/plain"));
    expect(events).toHaveLength(0);
    expect(store.size).toBe(1);
  });

  it("allowPrivateHosts opt-in permits loopback", async () => {
    const { events, store } = await run("http://localhost:3000/docs", async () => resp("local docs", "text/plain"), {
      allowPrivateHosts: true,
    });
    expect(events).toHaveLength(0);
    expect(store.size).toBe(1);
  });
});
