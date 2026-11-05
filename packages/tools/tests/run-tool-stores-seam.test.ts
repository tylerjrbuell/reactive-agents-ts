// Run: bun test packages/tools/tests/run-tool-stores-seam.test.ts
//
// Seam pin for run-scoped meta-tool stores. Before 2026-11-05 the recall /
// checkpoint / discover-tools stores were process-global Refs that nothing
// reset: every run in a process shared them, so recall could return another
// run's tool results and `_tool_result_N` keys accumulated across runs. The
// stores now live in the `runToolStoresSlot` run slot (Plan 9 item 1R): every
// root run (`withRunScope`) and every sub-agent (`childRunScope`) gets fresh
// ones, and the handlers resolve the CURRENT run's store at invocation time.
import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { childContext, rootContext } from "@reactive-agents/core";
import {
  childRunScope,
  drainRunScopeMisses,
  withRunScope,
} from "@reactive-agents/core/internal/run-scope";
import {
  currentScratchpadStore,
  currentCheckpointStore,
  currentDiscoveredToolsStore,
} from "../src/skills/run-tool-stores.js";
import { makeRecallHandler } from "../src/skills/recall.js";
import { makeCheckpointHandler } from "../src/skills/checkpoint.js";
import { makeDiscoverToolsHandler, type DiscoverableTool } from "../src/skills/discover-tools.js";
import { makeFindHandler } from "../src/skills/find.js";
import {
  makeRagIngestHandler,
  makeInMemoryStoreCallback,
  type RagMemoryStore,
} from "../src/skills/rag-ingest.js";

// Handlers built ONCE, with no explicit store — exactly how a long-lived tool
// registration would be shared across runs.
const recall = makeRecallHandler();
const checkpoint = makeCheckpointHandler();
const CATALOG: DiscoverableTool[] = [
  { name: "alpha-tool", description: "Alpha capability.", parameters: [] },
  { name: "beta-tool", description: "Beta capability.", parameters: [] },
];
const discover = makeDiscoverToolsHandler({ getAllToolDefinitions: () => CATALOG });

interface RunView {
  readonly recallKeys: readonly string[];
  readonly checkpointLabels: readonly string[];
  readonly discovered: readonly string[];
}

/** One "run": writes its own tag into every store, yields, then reads back. */
const runWith = (tag: string, discoverQuery: string): Effect.Effect<RunView, unknown> =>
  Effect.gen(function* () {
    yield* recall({ key: `note-${tag}`, content: `content-${tag}` });
    yield* checkpoint({ label: `cp-${tag}`, content: `finding-${tag}` });
    yield* discover({ query: discoverQuery });
    // Interleave with any concurrent run before reading back.
    yield* Effect.sleep("5 millis");
    yield* Effect.yieldNow();
    const listed = (yield* recall({})) as { entries: { key: string }[] };
    const cps = (yield* checkpoint({})) as { entries: { label: string }[] };
    const disc = yield* Ref.get(yield* currentDiscoveredToolsStore);
    return {
      recallKeys: listed.entries.map((e) => e.key).sort(),
      checkpointLabels: cps.entries.map((e) => e.label).sort(),
      discovered: [...disc].sort(),
    };
  });

/** Root run entry for `id` (the run scope binds fresh tool stores). */
const inRun = (id: string) => withRunScope(rootContext(id, "agent-t"));

/** Process fallback stores (read OUTSIDE any run scope). */
const fallbackStores = () =>
  Effect.runPromise(
    Effect.all({ sp: currentScratchpadStore, cp: currentCheckpointStore }),
  );

describe("run-scoped tool stores (seam)", () => {
  it("sequential runs never see each other's entries", async () => {
    const a = await Effect.runPromise(runWith("a", "alpha-tool").pipe(inRun("run-a")));
    const b = await Effect.runPromise(runWith("b", "beta-tool").pipe(inRun("run-b")));
    expect(a).toEqual({ recallKeys: ["note-a"], checkpointLabels: ["cp-a"], discovered: ["alpha-tool"] });
    expect(b).toEqual({ recallKeys: ["note-b"], checkpointLabels: ["cp-b"], discovered: ["beta-tool"] });
  });

  it("concurrent runs stay isolated", async () => {
    const [a, b] = await Effect.runPromise(
      Effect.all(
        [runWith("a", "alpha-tool").pipe(inRun("run-a")), runWith("b", "beta-tool").pipe(inRun("run-b"))],
        { concurrency: "unbounded" },
      ),
    );
    expect(a).toEqual({ recallKeys: ["note-a"], checkpointLabels: ["cp-a"], discovered: ["alpha-tool"] });
    expect(b).toEqual({ recallKeys: ["note-b"], checkpointLabels: ["cp-b"], discovered: ["beta-tool"] });
  });

  it("scoped runs do not leak into the process fallback stores", async () => {
    await Effect.runPromise(runWith("isolated", "alpha-tool").pipe(inRun("run-iso")));
    const { sp, cp } = await fallbackStores();
    expect((await Effect.runPromise(Ref.get(sp))).has("note-isolated")).toBe(false);
    expect((await Effect.runPromise(Ref.get(cp))).has("cp-isolated")).toBe(false);
  });

  it("a sub-agent (childRunScope) gets fresh stores, not the parent's", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        yield* recall({ key: "parent-note", content: "p" });
        const childKeys = yield* Effect.gen(function* () {
          yield* recall({ key: "child-note", content: "c" });
          return [...(yield* Ref.get(yield* currentScratchpadStore)).keys()];
        }).pipe(childRunScope(childContext(rootContext("run-p", "agent-t"), "sub")));
        const parentKeys = [...(yield* Ref.get(yield* currentScratchpadStore)).keys()];
        return { childKeys, parentKeys };
      }).pipe(inRun("run-p")),
    );
    expect(out.childKeys).toEqual(["child-note"]);
    expect(out.parentKeys).toEqual(["parent-note"]);
  });

  it("forked fibers inside a run see that run's stores", async () => {
    const keys = await Effect.runPromise(
      inRun("run-fork")(
        Effect.gen(function* () {
          yield* Effect.fork(recall({ key: "from-child", content: "x" })).pipe(
            Effect.flatMap((f) => f.await),
          );
          const store = yield* Ref.get(yield* currentScratchpadStore);
          return [...store.keys()];
        }),
      ),
    );
    expect(keys).toEqual(["from-child"]);
  });

  it("find auto-stores large results into the current run's scratchpad", async () => {
    const ragStore: RagMemoryStore = new Map();
    const ingest = makeRagIngestHandler(makeInMemoryStoreCallback(ragStore));
    await Effect.runPromise(
      ingest({ content: "Zebras are striped. ".repeat(80), source: "zebra.txt" }),
    );
    const find = makeFindHandler({
      ragStore,
      config: { autoStoreThreshold: 100, webFallback: false },
    });
    const keys = await Effect.runPromise(
      inRun("run-find")(
        Effect.gen(function* () {
          const res = (yield* find({ query: "zebra", scope: "documents" })) as { storedAs?: string };
          const store = yield* Ref.get(yield* currentScratchpadStore);
          return { storedAs: res.storedAs, keys: [...store.keys()] };
        }),
      ),
    );
    expect(keys.storedAs).toBeDefined();
    expect(keys.keys).toEqual([keys.storedAs as string]);
  });

  it("outside any run scope, handlers share the process fallback stores and record a miss", async () => {
    const { sp, cp } = await fallbackStores();
    const again = await fallbackStores();
    expect(again.sp).toBe(sp);
    expect(again.cp).toBe(cp);
    const before = await Effect.runPromise(Ref.get(sp));
    drainRunScopeMisses();
    try {
      await Effect.runPromise(recall({ key: "unwrapped", content: "v" }));
      await Effect.runPromise(checkpoint({ label: "unwrapped-cp", content: "v" }));
      expect(drainRunScopeMisses()).toContain("tools.runToolStores");
      expect((await Effect.runPromise(Ref.get(sp))).get("unwrapped")).toBe("v");
      expect((await Effect.runPromise(Ref.get(cp))).get("unwrapped-cp")).toBe("v");
    } finally {
      await Effect.runPromise(Ref.set(sp, before));
      await Effect.runPromise(
        Ref.update(cp, (m) => {
          const next = new Map(m);
          next.delete("unwrapped-cp");
          return next;
        }),
      );
    }
  });

  it("an explicitly supplied store still wins over the run store", async () => {
    const explicit = await Effect.runPromise(Ref.make(new Map<string, string>()));
    const h = makeRecallHandler(explicit);
    const runKeys = await Effect.runPromise(
      inRun("run-explicit")(
        Effect.gen(function* () {
          yield* h({ key: "pinned", content: "v" });
          return [...(yield* Ref.get(yield* currentScratchpadStore)).keys()];
        }),
      ),
    );
    expect(runKeys).toEqual([]);
    expect((await Effect.runPromise(Ref.get(explicit))).get("pinned")).toBe("v");
  });
});
