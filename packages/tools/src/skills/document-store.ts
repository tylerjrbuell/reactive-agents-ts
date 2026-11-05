/**
 * Per-agent document store.
 *
 * Documents ingested via `.withDocuments()` / `agent.ingest()` (and the
 * `rag-ingest` tool) live in a {@link RagMemoryStore}. The `find` tool reads
 * the store held by the {@link DocumentStoreRef} FiberRef at call time, so
 * each agent can search only its own documents.
 *
 * - Isolation: give each agent its own store ({@link createDocumentStore})
 *   and run its effects inside {@link withDocumentStore}.
 * - Sharing (opt-in): pass ONE store to several agents.
 * - Outside any wrapper, `find` falls back to {@link defaultDocumentStore} —
 *   a single process-wide store shared by every un-wrapped caller.
 *
 * FiberRef values are inherited by forked child fibers, so tool handlers
 * running on fibers forked from the wrapped effect see the same store. Work
 * scheduled on a separate runtime (e.g. a nested `Effect.runPromise`) does
 * NOT inherit it. Same pattern as `run-tool-stores.ts` and `file-root.ts`.
 */
import { Effect, FiberRef } from "effect";

import type { RagMemoryStore } from "./rag-ingest.js";

/**
 * Allocate a fresh, empty document store. Pass the same store to several
 * agents to share documents between them; give each agent its own to
 * isolate them.
 */
export const createDocumentStore = (): RagMemoryStore => new Map();

/**
 * Process-wide fallback store used when no {@link withDocumentStore} wrapper
 * is active. Shared by every un-wrapped caller in the process.
 */
export const defaultDocumentStore: RagMemoryStore = createDocumentStore();

/**
 * FiberRef holding the current agent's document store. Defaults to
 * {@link defaultDocumentStore}; {@link withDocumentStore} binds another
 * store for the duration of an effect.
 */
export const DocumentStoreRef: FiberRef.FiberRef<RagMemoryStore> =
  FiberRef.unsafeMake<RagMemoryStore>(defaultDocumentStore);

/**
 * Run an effect (and every fiber it forks) with `store` as the current
 * document store. Supports data-first `withDocumentStore(store, effect)` and
 * data-last `withDocumentStore(store)(effect)` (pipeable).
 */
export function withDocumentStore(
  store: RagMemoryStore,
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
export function withDocumentStore<A, E, R>(
  store: RagMemoryStore,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R>;
export function withDocumentStore<A, E, R>(
  store: RagMemoryStore,
  effect?: Effect.Effect<A, E, R>,
):
  | Effect.Effect<A, E, R>
  | (<A2, E2, R2>(effect: Effect.Effect<A2, E2, R2>) => Effect.Effect<A2, E2, R2>) {
  if (effect !== undefined) return Effect.locally(effect, DocumentStoreRef, store);
  return <A2, E2, R2>(e: Effect.Effect<A2, E2, R2>): Effect.Effect<A2, E2, R2> =>
    Effect.locally(e, DocumentStoreRef, store);
}

/** The document store bound to the current fiber. */
export const currentDocumentStore: Effect.Effect<RagMemoryStore> = FiberRef.get(DocumentStoreRef);
