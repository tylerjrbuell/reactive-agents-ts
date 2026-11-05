// Run: bun test packages/tools/tests/document-store-seam.test.ts
//
// Seam pin for the per-agent document store (skills/document-store.ts):
// documents ingested into one store are never visible to `find` running
// under a different store — sequentially, concurrently, or on forked fibers.
// The store is the `documentStoreSlot` run slot (Plan 9 item 1R), bound at
// the run entry; sub-agents inherit it.
import { describe, expect, it } from "bun:test";
import { Effect, Fiber } from "effect";
import { childContext, rootContext } from "@reactive-agents/core";
import { bindRun, childRunScope, withRunScope } from "@reactive-agents/core/internal/run-scope";

import {
  createDocumentStore,
  currentDocumentStore,
  defaultDocumentStore,
  documentStoreSlot,
} from "../src/skills/document-store.js";
import { ragMemoryStore } from "../src/skills/builtin.js";
import { makeFindHandler } from "../src/skills/find.js";
import { makeInMemoryStoreCallback, makeRagIngestHandler, type RagMemoryStore } from "../src/skills/rag-ingest.js";

const ingest = (store: RagMemoryStore, source: string, content: string) =>
  makeRagIngestHandler(makeInMemoryStoreCallback(store))({ content, source });

/** `find` with NO explicit ragStore: resolves the current run's documentStoreSlot. */
const ambientFind = makeFindHandler({ config: { webFallback: false } });

let runSeq = 0;
/** Run `effect` as a root run with `store` bound as the document store. */
const withDocumentStore = <A, E>(store: RagMemoryStore, effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  effect.pipe(withRunScope(rootContext(`doc-run-${++runSeq}`, "agent-d"), bindRun(documentStoreSlot, store)));

const identifiers = (result: unknown): string[] =>
  ((result as { results: Array<{ identifier: string }> }).results ?? []).map((r) => r.identifier);

describe("document-store seam", () => {
  it("createDocumentStore returns a fresh empty store each call", () => {
    const a = createDocumentStore();
    const b = createDocumentStore();
    expect(a.size).toBe(0);
    expect(a).not.toBe(b);
  });

  it("default store is the deprecated ragMemoryStore alias and the slot's unbound value", async () => {
    expect(ragMemoryStore).toBe(defaultDocumentStore);
    const outside = await Effect.runPromise(currentDocumentStore);
    expect(outside).toBe(defaultDocumentStore);
    const unboundRun = await Effect.runPromise(currentDocumentStore.pipe(withRunScope(rootContext("doc-unbound", "agent-d"))));
    expect(unboundRun).toBe(defaultDocumentStore);
  });

  it("a run-entry binding is the run's store, and a sub-agent inherits it", async () => {
    const store = createDocumentStore();
    const root = rootContext("doc-parent", "agent-d");
    const [inRun, inChild] = await Effect.runPromise(
      Effect.all([currentDocumentStore, currentDocumentStore.pipe(childRunScope(childContext(root, "sub")))]).pipe(
        withRunScope(root, bindRun(documentStoreSlot, store)),
      ),
    );
    expect(inRun).toBe(store);
    expect(inChild).toBe(store);
  });

  it("sequential: two stores never see each other's documents", async () => {
    const storeA = createDocumentStore();
    const storeB = createDocumentStore();
    await Effect.runPromise(ingest(storeA, "alpha.md", "The zebrafish protocol uses quinine."));
    await Effect.runPromise(ingest(storeB, "beta.md", "The zebrafish protocol uses lithium."));

    const a = await Effect.runPromise(withDocumentStore(storeA, ambientFind({ query: "zebrafish protocol", scope: "documents" })));
    const b = await Effect.runPromise(withDocumentStore(storeB, ambientFind({ query: "zebrafish protocol", scope: "documents" })));
    expect(identifiers(a)).toEqual(["alpha.md"]);
    expect(identifiers(b)).toEqual(["beta.md"]);
  });

  it("concurrent: interleaved runs stay isolated", async () => {
    const storeA = createDocumentStore();
    const storeB = createDocumentStore();
    await Effect.runPromise(ingest(storeA, "alpha.md", "Kestrel migration notes for the north valley."));
    await Effect.runPromise(ingest(storeB, "beta.md", "Kestrel migration notes for the south ridge."));

    const run = (store: RagMemoryStore) =>
      withDocumentStore(
        store,
        Effect.gen(function* () {
          yield* Effect.yieldNow();
          return yield* ambientFind({ query: "kestrel migration", scope: "documents" });
        }),
      );
    const [a, b] = await Effect.runPromise(Effect.all([run(storeA), run(storeB)], { concurrency: "unbounded" }));
    expect(identifiers(a)).toEqual(["alpha.md"]);
    expect(identifiers(b)).toEqual(["beta.md"]);
  });

  it("forked fiber inherits the bound store", async () => {
    const storeA = createDocumentStore();
    await Effect.runPromise(ingest(storeA, "alpha.md", "Basalt column survey results."));
    const result = await Effect.runPromise(
      withDocumentStore(
        storeA,
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(ambientFind({ query: "basalt column survey", scope: "documents" }));
          return yield* Fiber.join(fiber);
        }),
      ),
    );
    expect(identifiers(result)).toEqual(["alpha.md"]);
  });

  it("an explicitly passed ragStore wins over the bound store", async () => {
    const explicit = createDocumentStore();
    const bound = createDocumentStore();
    await Effect.runPromise(ingest(explicit, "explicit.md", "Obsidian lattice calibration."));
    await Effect.runPromise(ingest(bound, "bound.md", "Obsidian lattice calibration."));
    const find = makeFindHandler({ ragStore: explicit, config: { webFallback: false } });
    const result = await Effect.runPromise(
      withDocumentStore(bound, find({ query: "obsidian lattice", scope: "documents" })),
    );
    expect(identifiers(result)).toEqual(["explicit.md"]);
  });

  it("unbound find falls back to the process-wide default store", async () => {
    const source = "default-fallback.md";
    await Effect.runPromise(ingest(defaultDocumentStore, source, "Tamarind fermentation ledger."));
    try {
      const result = await Effect.runPromise(ambientFind({ query: "tamarind fermentation", scope: "documents" }));
      expect(identifiers(result)).toContain(source);
      const isolated = await Effect.runPromise(
        withDocumentStore(createDocumentStore(), ambientFind({ query: "tamarind fermentation", scope: "documents" })),
      );
      expect(identifiers(isolated)).toEqual([]);
    } finally {
      defaultDocumentStore.delete(source);
    }
  });
});
