import { Layer } from "effect";
import { WorkingMemoryServiceLive } from "./services/working-memory.js";
import { SemanticMemoryServiceLive } from "./services/semantic-memory.js";
import { EpisodicMemoryServiceLive } from "./services/episodic-memory.js";
import { ProceduralMemoryServiceLive } from "./services/procedural-memory.js";
import { MemoryFileSystemLive } from "./fs/memory-file-system.js";
import { MemorySearchServiceLive } from "./search.js";
import { ZettelkastenServiceLive } from "./indexing/zettelkasten.js";
import { MemoryServiceLive } from "./services/memory-service.js";
import { MemoryDatabaseLive } from "./database.js";
import type { MemoryConfig } from "./types.js";
import { defaultMemoryConfig } from "./types.js";

/**
 * Create the complete memory layer.
 *
 * Tier 1 (zero deps): FTS5 full-text search only.
 * Tier 2 (sqlite-vec): FTS5 + KNN vector search.
 *
 * Usage:
 *   const MemoryLive = createMemoryLayer("1", { agentId: "my-agent" });
 *   myProgram.pipe(Effect.provide(MemoryLive));
 */
export const createMemoryLayer = (
  tier: "1" | "2",
  configOverrides?: Partial<MemoryConfig> & { agentId: string },
) => {
  const agentId = configOverrides?.agentId ?? "default";
  const config: MemoryConfig = {
    ...defaultMemoryConfig(agentId),
    ...configOverrides,
    tier,
  };

  // Database layer (foundation)
  const dbLayer = MemoryDatabaseLive(config);

  // Services that depend on DB
  const coreServices = Layer.mergeAll(
    SemanticMemoryServiceLive,
    EpisodicMemoryServiceLive,
    ProceduralMemoryServiceLive,
    MemorySearchServiceLive,
    ZettelkastenServiceLive,
  ).pipe(Layer.provide(dbLayer));

  // Working memory (in-process only, no DB)
  const workingLayer = WorkingMemoryServiceLive(
    config.working.capacity,
    config.working.evictionPolicy,
  );

  // File system layer (no deps)
  const fsLayer = MemoryFileSystemLive;

  // Orchestrator layer
  const memoryServiceLayer = MemoryServiceLive(config).pipe(
    Layer.provide(Layer.mergeAll(workingLayer, coreServices, fsLayer)),
  );

  return Layer.mergeAll(
    dbLayer,
    workingLayer,
    coreServices,
    fsLayer,
    memoryServiceLayer,
  );
};
