/**
 * Per-agent document store.
 *
 * Documents ingested via `.withDocuments()` / `agent.ingest()` (and the
 * `rag-ingest` tool) live in a {@link RagMemoryStore}. The `find` tool reads
 * the store held by the {@link documentStoreSlot} run slot at call time, so
 * each agent can search only its own documents.
 *
 * - Isolation: give each agent its own store ({@link createDocumentStore})
 *   and bind it at the run entry (`bindRun(documentStoreSlot, store)`).
 * - Sharing (opt-in): pass ONE store to several agents.
 * - Unbound (no binding, or no run scope), `find` uses
 *   {@link defaultDocumentStore}: a single process-wide store shared by every
 *   unbound caller (the pre-1R behavior).
 *
 * Policy `inherit`: a sub-agent sees its parent's store unless its scope
 * binds another one.
 */
import type { Effect } from "effect";
import { getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";

import type { RagMemoryStore } from "./rag-ingest.js";

/**
 * Allocate a fresh, empty document store. Pass the same store to several
 * agents to share documents between them; give each agent its own to
 * isolate them.
 */
export const createDocumentStore = (): RagMemoryStore => new Map();

/**
 * Process-wide fallback store: the {@link documentStoreSlot} initial value.
 * Shared by every caller whose run does not bind a store.
 */
export const defaultDocumentStore: RagMemoryStore = createDocumentStore();

/**
 * Run slot holding the current agent's document store. Initial value is
 * {@link defaultDocumentStore}; sub-agents inherit the parent's store.
 */
export const documentStoreSlot: RunSlot<RagMemoryStore> = runSlot<RagMemoryStore>("tools.documentStore", {
  child: "inherit",
  initial: defaultDocumentStore,
});

/** The document store bound to the current run. */
export const currentDocumentStore: Effect.Effect<RagMemoryStore> = getRunSlot(documentStoreSlot);
