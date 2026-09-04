// AgentMemory port adapter — bridges MemoryService → AgentMemory.
//
// The kernel resolves the AgentMemory port (in @reactive-agents/core); the
// memory package supplies the adapter Layer that satisfies the port from a
// real MemoryService instance. This test pins the conversion: an
// AgentMemoryEntry handed to the port reaches MemoryService.storeSemantic
// as a fully-formed SemanticEntry (with branded MemoryId), and that
// getRelated reads the real Zettelkasten link graph end-to-end.

import { describe, it, expect, afterEach } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentMemory, type AgentMemoryEntry } from "@reactive-agents/core";
import { MemoryService } from "../src/services/memory-service.js";
import { ZettelkastenService, ZettelkastenServiceLive } from "../src/indexing/zettelkasten.js";
import { SemanticMemoryService, SemanticMemoryServiceLive } from "../src/services/semantic-memory.js";
import { MemorySearchService, MemorySearchServiceLive } from "../src/search.js";
import { MemoryDatabaseLive } from "../src/database.js";
import { AgentMemoryFromMemoryService } from "../src/services/agent-memory-adapter.js";
import { MemoryId, defaultMemoryConfig, type SemanticEntry } from "../src/types.js";

describe("AgentMemoryFromMemoryService adapter — storeSemantic", () => {
  it("forwards a port-level AgentMemoryEntry into MemoryService.storeSemantic as a SemanticEntry", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<SemanticEntry[]>([]);

      // Stub MemoryService — only `storeSemantic` is exercised here.
      const stubMemory = Layer.succeed(MemoryService, {
        storeSemantic: (entry: SemanticEntry) =>
          Effect.gen(function* () {
            yield* Ref.update(ref, (acc) => [...acc, entry]);
            return entry.id;
          }),
      } as unknown as MemoryService["Type"]);
      // getRelated is not exercised by this test — trivial stubs satisfy the
      // adapter's dependency requirement without pulling in a real DB.
      const stubZettel = Layer.succeed(ZettelkastenService, {
        autoLinkText: () => Effect.succeed([]),
      } as unknown as ZettelkastenService["Type"]);
      const stubSemantic = Layer.succeed(SemanticMemoryService, {} as unknown as SemanticMemoryService["Type"]);
      const stubSearch = Layer.succeed(MemorySearchService, {} as unknown as MemorySearchService["Type"]);

      const adapterLayer = AgentMemoryFromMemoryService("agent-x").pipe(
        Layer.provide(Layer.mergeAll(stubMemory, stubZettel, stubSemantic, stubSearch)),
      );

      const now = new Date(2026, 3, 28);
      const entry: AgentMemoryEntry = {
        id: "e-1",
        agentId: "agent-x",
        content: "facts about hydrogen",
        summary: "hydrogen H2",
        importance: 0.5,
        verified: true,
        tags: ["chem", "tool-observation"],
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessedAt: now,
      };

      const inner = Effect.gen(function* () {
        const port = yield* AgentMemory;
        return yield* port.storeSemantic(entry);
      });

      const id = yield* inner.pipe(Effect.provide(adapterLayer));
      const stored = yield* Ref.get(ref);
      return { id, stored };
    });

    const { id, stored } = await Effect.runPromise(program);

    expect(id).toBe("e-1");
    expect(stored).toHaveLength(1);
    const s = stored[0]!;
    expect(s.id).toBe("e-1" as typeof s.id); // branded MemoryId
    expect(s.agentId).toBe("agent-x");
    expect(s.content).toBe("facts about hydrogen");
    expect(s.summary).toBe("hydrogen H2");
    expect(s.importance).toBe(0.5);
    expect(s.verified).toBe(true);
    expect(s.tags).toEqual(["chem", "tool-observation"]);
  });
});

describe("AgentMemoryFromMemoryService adapter — getRelated", () => {
  const TEST_DB_DIR = "/tmp/test-agent-memory-adapter-db";
  const TEST_DB = path.join(TEST_DB_DIR, "adapter.db");

  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
      fs.unlinkSync(TEST_DB + "-wal");
      fs.unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(TEST_DB_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const buildLayer = (agentId = "test-agent") => {
    const config = { ...defaultMemoryConfig("test-agent"), dbPath: TEST_DB };
    const dbLayer = MemoryDatabaseLive(config);
    const coreServices = Layer.mergeAll(
      ZettelkastenServiceLive,
      SemanticMemoryServiceLive,
      MemorySearchServiceLive,
    ).pipe(Layer.provide(dbLayer));
    // storeSemantic is not exercised here — a stub avoids depending on the
    // full orchestrator (bootstrap/flush/etc) just to reach getRelated/search.
    const stubMemory = Layer.succeed(MemoryService, {} as unknown as MemoryService["Type"]);
    const adapterLayer = AgentMemoryFromMemoryService(agentId).pipe(
      Layer.provide(Layer.mergeAll(stubMemory, coreServices)),
    );
    // Tests seed data directly via ZettelkastenService/SemanticMemoryService
    // (not through the port), so those stay in the environment alongside
    // AgentMemory rather than being closed over inside the adapter layer.
    return Layer.mergeAll(adapterLayer, coreServices);
  };

  const run = <A, E>(
    effect: Effect.Effect<A, E, AgentMemory | SemanticMemoryService | ZettelkastenService>,
    agentId?: string,
  ) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(buildLayer(agentId)))));

  it("mode 'links' returns direct neighbors enriched with a content preview", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("a"), agentId: "test-agent", content: "content A", summary: "summary A",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        yield* semantic.store({
          id: MemoryId.make("b"), agentId: "test-agent", content: "content B", summary: "summary B",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });

        const zettel = yield* ZettelkastenService;
        yield* zettel.addLink({ source: MemoryId.make("a"), target: MemoryId.make("b"), strength: 0.9, type: "similar", createdAt: now });

        const port = yield* AgentMemory;
        return yield* port.getRelated!("a", "links", 2);
      }),
    );

    expect(result).toEqual([{ id: "b", preview: "summary B", strength: 0.9, type: "similar" }]);
  });

  it("mode 'traverse' returns the multi-hop reachable set, each with a preview", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        for (const id of ["a", "b", "c"]) {
          yield* semantic.store({
            id: MemoryId.make(id), agentId: "test-agent", content: `content ${id}`, summary: `summary ${id}`,
            importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
          });
        }
        const zettel = yield* ZettelkastenService;
        yield* zettel.addLink({ source: MemoryId.make("a"), target: MemoryId.make("b"), strength: 0.9, type: "similar", createdAt: now });
        yield* zettel.addLink({ source: MemoryId.make("b"), target: MemoryId.make("c"), strength: 0.9, type: "similar", createdAt: now });

        const port = yield* AgentMemory;
        return yield* port.getRelated!("a", "traverse", 2);
      }),
    );

    expect(result.map((e) => e.id).sort()).toEqual(["b", "c"]);
    // traverse mode carries no strength/type — those are link-graph edge
    // properties, meaningless for a multi-hop reachable set.
    expect(result.every((e) => e.strength === undefined && e.type === undefined)).toBe(true);
  });

  it("skips a linked id that no longer resolves to a stored entry", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("a"), agentId: "test-agent", content: "content A", summary: "summary A",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        const zettel = yield* ZettelkastenService;
        // "ghost" was never stored — the link exists but the entry doesn't.
        yield* zettel.addLink({ source: MemoryId.make("a"), target: MemoryId.make("ghost"), strength: 0.9, type: "similar", createdAt: now });

        const port = yield* AgentMemory;
        return yield* port.getRelated!("a", "links", 2);
      }),
    );

    expect(result).toEqual([]);
  });

  it("returns [] rather than throwing when the underlying query fails", async () => {
    const result = await run(
      Effect.gen(function* () {
        const port = yield* AgentMemory;
        // No entry "nonexistent" exists and no links reference it — the
        // real assertion here is that this resolves at all (getRelated is
        // caught end-to-end), not the specific empty result.
        return yield* port.getRelated!("nonexistent", "links", 2);
      }),
    );
    expect(result).toEqual([]);
  });

  it("port.link asserts a relationship the auto-linker would never create, readable via getRelated", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("claim-a"), agentId: "test-agent", content: "unrelated content A", summary: "A",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        yield* semantic.store({
          id: MemoryId.make("claim-b"), agentId: "test-agent", content: "unrelated content B", summary: "B",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });

        const port = yield* AgentMemory;
        const before = yield* port.getRelated!("claim-a", "links", 2);
        yield* port.link!("claim-a", "claim-b", "contradicts", 0.7);
        const after = yield* port.getRelated!("claim-a", "links", 2);
        return { before, after };
      }),
    );

    expect(result.before).toEqual([]);
    expect(result.after).toEqual([{ id: "claim-b", preview: "B", strength: 0.7, type: "contradicts" }]);
  });

  it("port.link defaults strength to 1.0 when omitted", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("x"), agentId: "test-agent", content: "x", summary: "x-summary",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        yield* semantic.store({
          id: MemoryId.make("y"), agentId: "test-agent", content: "y", summary: "y-summary",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        const port = yield* AgentMemory;
        yield* port.link!("x", "y", "supports");
        return yield* port.getRelated!("x", "links", 2);
      }),
    );
    expect(result).toEqual([{ id: "y", preview: "y-summary", strength: 1.0, type: "supports" }]);
  });
});

describe("AgentMemoryFromMemoryService adapter — search", () => {
  const TEST_DB_DIR = "/tmp/test-agent-memory-adapter-search-db";
  const TEST_DB = path.join(TEST_DB_DIR, "adapter.db");

  afterEach(() => {
    try {
      fs.unlinkSync(TEST_DB);
      fs.unlinkSync(TEST_DB + "-wal");
      fs.unlinkSync(TEST_DB + "-shm");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(TEST_DB_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  const buildLayer = (agentId: string) => {
    const config = { ...defaultMemoryConfig(agentId), dbPath: TEST_DB };
    const dbLayer = MemoryDatabaseLive(config);
    const coreServices = Layer.mergeAll(
      ZettelkastenServiceLive,
      SemanticMemoryServiceLive,
      MemorySearchServiceLive,
    ).pipe(Layer.provide(dbLayer));
    const stubMemory = Layer.succeed(MemoryService, {} as unknown as MemoryService["Type"]);
    const adapterLayer = AgentMemoryFromMemoryService(agentId).pipe(
      Layer.provide(Layer.mergeAll(stubMemory, coreServices)),
    );
    return Layer.mergeAll(adapterLayer, coreServices);
  };

  const run = <A, E>(
    effect: Effect.Effect<A, E, AgentMemory | SemanticMemoryService>,
    agentId = "test-agent",
  ) => Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(buildLayer(agentId)))));

  // 2026-09-03: `find(scope:"memory")` had nothing that returned a REAL
  // per-entry id — this is the fix. A model can now find -> relate.
  it("returns real per-entry ids, not a synthetic placeholder", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("real-id-1"), agentId: "test-agent",
          content: "Effect-TS uses Context.Tag for dependency injection", summary: "DI via Context.Tag",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        const port = yield* AgentMemory;
        return yield* port.search!("dependency injection", 5);
      }),
    );
    expect(result).toEqual([{ id: "real-id-1", preview: "DI via Context.Tag" }]);
  });

  // 2026-09-03: MemorySearchService.searchSemantic previously fed the raw
  // query straight into FTS5 MATCH — a hyphenated query term (very common
  // in real free-text queries) crashed with "no such column: TS". Fixed via
  // toFts5Query; this pins the crash doesn't come back.
  it("does not crash on a query containing FTS5-special characters", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("e1"), agentId: "test-agent", content: "notes about Effect-TS", summary: "notes",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        const port = yield* AgentMemory;
        return yield* port.search!("Effect-TS: Context-Tag usage", 5);
      }),
    );
    expect(Array.isArray(result)).toBe(true);
  });

  it("only returns entries for the agent the adapter was built for", async () => {
    const result = await run(
      Effect.gen(function* () {
        const semantic = yield* SemanticMemoryService;
        const now = new Date();
        yield* semantic.store({
          id: MemoryId.make("other-agent-entry"), agentId: "other-agent",
          content: "dependency injection notes", summary: "other agent's note",
          importance: 0.5, verified: true, tags: [], createdAt: now, updatedAt: now, accessCount: 0, lastAccessedAt: now,
        });
        const port = yield* AgentMemory;
        return yield* port.search!("dependency injection", 5);
      }),
      "test-agent",
    );
    expect(result).toEqual([]);
  });
});
