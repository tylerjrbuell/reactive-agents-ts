import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  WorkingMemoryService,
  WorkingMemoryServiceLive,
} from "../src/index.js";
import type { WorkingMemoryItem, MemoryId } from "../src/types.js";

const makeItem = (n: number, importance = 0.5): WorkingMemoryItem => ({
  id: `mem-${n}` as MemoryId,
  content: `item ${n}`,
  importance,
  addedAt: new Date(),
  source: { type: "system", id: "test" },
});

describe("WorkingMemoryService", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, WorkingMemoryService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(WorkingMemoryServiceLive(7))));

  it("should add and retrieve items", async () => {
    const items = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1));
        yield* svc.add(makeItem(2));
        return yield* svc.get();
      }),
    );
    expect(items.length).toBe(2);
    // Newest first
    expect(items[0]!.content).toBe("item 2");
    expect(items[1]!.content).toBe("item 1");
  });

  it("should enforce capacity of 7", async () => {
    const items = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        for (let i = 0; i < 10; i++) yield* svc.add(makeItem(i));
        return yield* svc.get();
      }),
    );
    expect(items.length).toBe(7);
  });

  it("should evict FIFO", async () => {
    const result = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        for (let i = 0; i < 8; i++) yield* svc.add(makeItem(i));
        const size = yield* svc.size();
        const items = yield* svc.get();
        return { size, items };
      }),
    );
    expect(result.size).toBe(7);
    // First item (item 0) should have been evicted
    expect(result.items.find((i) => i.content === "item 0")).toBeUndefined();
  });

  it("should clear all items", async () => {
    const count = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1));
        yield* svc.add(makeItem(2));
        yield* svc.clear();
        return yield* svc.size();
      }),
    );
    expect(count).toBe(0);
  });

  it("should find items by content", async () => {
    const found = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1));
        yield* svc.add(makeItem(2));
        yield* svc.add(makeItem(3));
        return yield* svc.find("item 2");
      }),
    );
    expect(found.length).toBe(1);
    expect(found[0]!.content).toBe("item 2");
  });

  it("should evict by importance when using importance policy", async () => {
    const runImportance = <A, E>(
      effect: Effect.Effect<A, E, WorkingMemoryService>,
    ) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(WorkingMemoryServiceLive(3, "importance")),
        ),
      );

    const items = await runImportance(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1, 0.9));
        yield* svc.add(makeItem(2, 0.1)); // lowest importance
        yield* svc.add(makeItem(3, 0.8));
        // This should evict item 2 (lowest importance)
        yield* svc.add(makeItem(4, 0.7));
        return yield* svc.get();
      }),
    );
    expect(items.length).toBe(3);
    // item 2 (importance 0.1) should have been evicted
    expect(items.find((i) => i.content === "item 2")).toBeUndefined();
  });

  it("should evict and return evicted item", async () => {
    const evicted = await run(
      Effect.gen(function* () {
        const svc = yield* WorkingMemoryService;
        yield* svc.add(makeItem(1));
        yield* svc.add(makeItem(2));
        return yield* svc.evict();
      }),
    );
    expect(evicted.content).toBe("item 1");
  });
});
