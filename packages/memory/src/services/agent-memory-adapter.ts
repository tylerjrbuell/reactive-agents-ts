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
import { AgentMemory, type AgentMemoryEntry } from "@reactive-agents/core";
import { MemoryService } from "./memory-service.js";
import { MemoryId } from "../types.js";
import type { SemanticEntry } from "../types.js";

/**
 * Layer that fulfills the `AgentMemory` port using an existing
 * `MemoryService`. The adapter widens the narrow `AgentMemoryEntry` shape
 * back into a full `SemanticEntry` (with branded `MemoryId`) before
 * delegating; conversion is the adapter's responsibility, not the port's.
 */
export const AgentMemoryFromMemoryService: Layer.Layer<AgentMemory, never, MemoryService> =
  Layer.effect(
    AgentMemory,
    Effect.gen(function* () {
      const memory = yield* MemoryService;
      return {
        storeSemantic: (entry: AgentMemoryEntry) => {
          const branded = MemoryId.make(entry.id);
          const semantic: SemanticEntry = {
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
          return memory.storeSemantic(semantic).pipe(
            Effect.map((id) => id as string),
          );
        },
      };
    }),
  );
