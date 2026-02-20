import { Effect, Context, Layer, Ref } from "effect";
import type { WorkingMemoryItem, EvictionPolicy } from "../types.js";
import { MemoryError } from "../errors.js";

// ─── Service Tag ───

export class WorkingMemoryService extends Context.Tag("WorkingMemoryService")<
  WorkingMemoryService,
  {
    /** Add item to working memory. Evicts according to policy if at capacity. */
    readonly add: (item: WorkingMemoryItem) => Effect.Effect<void, never>;

    /** Get all items in working memory (newest first). */
    readonly get: () => Effect.Effect<readonly WorkingMemoryItem[], never>;

    /** Clear all items. */
    readonly clear: () => Effect.Effect<void, never>;

    /** Evict one item according to policy and return it. */
    readonly evict: () => Effect.Effect<WorkingMemoryItem, MemoryError>;

    /** Current count. */
    readonly size: () => Effect.Effect<number, never>;

    /** Find item by content similarity (text contains). */
    readonly find: (
      query: string,
    ) => Effect.Effect<readonly WorkingMemoryItem[], never>;
  }
>() {}

// ─── Live Implementation ───

export const WorkingMemoryServiceLive = (
  capacity: number = 7,
  evictionPolicy: EvictionPolicy = "fifo",
) =>
  Layer.effect(
    WorkingMemoryService,
    Effect.gen(function* () {
      const store = yield* Ref.make<WorkingMemoryItem[]>([]);

      const evictOne = (items: WorkingMemoryItem[]): WorkingMemoryItem[] => {
        if (items.length === 0) return items;
        switch (evictionPolicy) {
          case "fifo":
            return items.slice(1);
          case "lru":
            // Evict least recently added (same as FIFO for add-only workloads)
            return items.slice(1);
          case "importance": {
            // Evict lowest importance
            const minIdx = items.reduce(
              (minI, item, i) =>
                item.importance < items[minI]!.importance ? i : minI,
              0,
            );
            return [...items.slice(0, minIdx), ...items.slice(minIdx + 1)];
          }
        }
      };

      return {
        add: (item) =>
          Ref.update(store, (items) => {
            const withRoom =
              items.length >= capacity ? evictOne(items) : items;
            return [...withRoom, item];
          }),

        get: () =>
          Ref.get(store).pipe(
            Effect.map(
              (items) => [...items].reverse() as readonly WorkingMemoryItem[],
            ),
          ),

        clear: () => Ref.set(store, []),

        evict: () =>
          Effect.gen(function* () {
            const items = yield* Ref.get(store);
            if (items.length === 0) {
              return yield* Effect.fail(
                new MemoryError({
                  message: "Working memory is empty, cannot evict",
                }),
              );
            }
            const evicted = items[0]!;
            yield* Ref.set(store, items.slice(1));
            return evicted;
          }),

        size: () => Ref.get(store).pipe(Effect.map((items) => items.length)),

        find: (query) =>
          Ref.get(store).pipe(
            Effect.map((items) =>
              items.filter((item) =>
                item.content.toLowerCase().includes(query.toLowerCase()),
              ),
            ),
          ),
      };
    }),
  );
