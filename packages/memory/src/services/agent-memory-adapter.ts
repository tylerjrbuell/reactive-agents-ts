// Adapter — `MemoryService` → `AgentMemory` port (NS §3.1, FIX-34 / W11).
//
// Bridges the heavy multi-layered MemoryService implementation (bootstrap,
// flush, snapshot, semantic + episodic + procedural + working stores) down
// to the narrow AgentMemory port the kernel actually consumes today
// (storeSemantic only). Lives in the memory package per the standard
// adapter pattern: the side that knows about both surfaces is responsible
// for the conversion.
//
// Wire example:
//
//   const layer = Layer.merge(
//     MemoryServiceLive(memoryConfig),
//     AgentMemoryFromMemoryService,
//   );
//
// User code that wants AgentMemory WITHOUT the memory package can ship its
// own Layer.succeed(AgentMemory, { storeSemantic: ... }) instead — that's
// the whole point of the port.

import { Effect, Layer } from "effect";
import { AgentMemory, type AgentMemoryEntry, type AgentMemoryRelatedEntry } from "@reactive-agents/core";
import { MemoryService } from "./memory-service.js";
import { SemanticMemoryService } from "./semantic-memory.js";
import { ZettelkastenService } from "../indexing/zettelkasten.js";
import { MemoryId } from "../types.js";
import type { SemanticEntry } from "../types.js";

/**
 * Layer that fulfills the `AgentMemory` port using an existing
 * `MemoryService`. The adapter widens the narrow `AgentMemoryEntry` shape
 * back into a full `SemanticEntry` (with branded `MemoryId`) before
 * delegating; conversion is the adapter's responsibility, not the port's.
 *
 * Also implements the port's optional `getRelated` by reading the
 * Zettelkasten link graph (`ZettelkastenService`) and enriching each
 * neighbor id with a content preview from `SemanticMemoryService` — a bare
 * id list would be nearly useless to a model, which never saw the id minted.
 * A neighbor that no longer resolves (evicted, or from another agent — the
 * link graph is not agent-scoped) is skipped rather than surfaced as a
 * broken entry.
 */
export const AgentMemoryFromMemoryService: Layer.Layer<
  AgentMemory,
  never,
  MemoryService | ZettelkastenService | SemanticMemoryService
> = Layer.effect(
  AgentMemory,
  Effect.gen(function* () {
    const memory = yield* MemoryService;
    const zettel = yield* ZettelkastenService;
    const semantic = yield* SemanticMemoryService;

    const preview = (id: string): Effect.Effect<string | undefined, never> =>
      semantic.get(MemoryId.make(id)).pipe(
        Effect.map((entry) => entry.summary || entry.content.slice(0, 200)),
        Effect.catchAll(() => Effect.succeed(undefined)),
      );

    return {
      storeSemantic: (entry: AgentMemoryEntry) => {
        const branded = MemoryId.make(entry.id);
        const semanticEntry: SemanticEntry = {
          id: branded,
          agentId: entry.agentId,
          content: entry.content,
          summary: entry.summary,
          importance: entry.importance,
          verified: entry.verified,
          tags: entry.tags,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          accessCount: entry.accessCount,
          lastAccessedAt: entry.lastAccessedAt,
        };
        return memory.storeSemantic(semanticEntry).pipe(
          Effect.map((id) => id as string),
        );
      },

      getRelated: (id, mode, depth) =>
        Effect.gen(function* () {
          if (mode === "traverse") {
            const ids = yield* zettel.traverse(MemoryId.make(id), depth);
            const previews = yield* Effect.forEach(ids, (rid) =>
              preview(rid).pipe(
                Effect.map((p): AgentMemoryRelatedEntry | undefined =>
                  p === undefined ? undefined : { id: String(rid), preview: p },
                ),
              ),
            );
            return previews.filter((e): e is AgentMemoryRelatedEntry => e !== undefined);
          }

          const links = yield* zettel.getLinks(MemoryId.make(id));
          const entries = yield* Effect.forEach(links, (link) => {
            const targetId = String(link.source) === id ? String(link.target) : String(link.source);
            return preview(targetId).pipe(
              Effect.map((p): AgentMemoryRelatedEntry | undefined =>
                p === undefined
                  ? undefined
                  : { id: targetId, preview: p, strength: link.strength, type: link.type },
              ),
            );
          });
          return entries.filter((e): e is AgentMemoryRelatedEntry => e !== undefined);
        }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly AgentMemoryRelatedEntry[]))),
    };
  }),
);
