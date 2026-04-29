import { Layer } from "effect";
import { WorkingMemoryServiceLive } from "./services/working-memory.js";
import { SemanticMemoryServiceLive } from "./services/semantic-memory.js";
import { EpisodicMemoryServiceLive } from "./services/episodic-memory.js";
import { ProceduralMemoryServiceLive } from "./services/procedural-memory.js";
import { MemoryFileSystemLive } from "./fs/memory-file-system.js";
import { MemorySearchServiceLive } from "./search.js";
import { ZettelkastenServiceLive } from "./indexing/zettelkasten.js";
import { PlanStoreServiceLive } from "./services/plan-store.js";
import { MemoryServiceLive } from "./services/memory-service.js";
import { AgentMemoryFromMemoryService } from "./services/agent-memory-adapter.js";
import { MemoryDatabaseLive } from "./database.js";
import { MemoryConsolidatorLive } from "./extraction/memory-consolidator.js";
import { MemoryExtractorLive, MemoryExtractorTier2Live } from "./extraction/memory-extractor.js";
import { CompactionServiceLive } from "./compaction/compaction-service.js";
import type { MemoryConfig, MemoryLLM } from "./types.js";
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
  memoryLLM?: MemoryLLM,
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
    PlanStoreServiceLive,
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

  // Consolidator layer (depends on DB)
  const consolidatorLayer = MemoryConsolidatorLive(config).pipe(
    Layer.provide(dbLayer),
  );

  // Compaction layer (depends on DB)
  const compactionLayer = CompactionServiceLive.pipe(Layer.provide(dbLayer));

  // Memory extractor layer (Tier 2 if LLM available, otherwise Tier 1 heuristic)
  const extractorLayer = memoryLLM
    ? MemoryExtractorTier2Live(memoryLLM)
    : MemoryExtractorLive;

  // Orchestrator layer
  const memoryServiceLayer = MemoryServiceLive(config, memoryLLM).pipe(
    Layer.provide(Layer.mergeAll(workingLayer, coreServices, fsLayer)),
  );

  // AgentMemory port adapter (FIX-34 / W11). Bridges the heavy MemoryService
  // implementation to the narrow `AgentMemory` Tag in @reactive-agents/core
  // that the kernel actually consumes. Provided here so any consumer of
  // `createMemoryLayer` automatically satisfies the kernel's port lookup —
  // no extra wiring required for the standard happy path.
  const agentMemoryAdapter = AgentMemoryFromMemoryService.pipe(
    Layer.provide(memoryServiceLayer),
  );

  return Layer.mergeAll(
    dbLayer,
    workingLayer,
    coreServices,
    fsLayer,
    memoryServiceLayer,
    agentMemoryAdapter,
    consolidatorLayer,
    compactionLayer,
    extractorLayer,
  );
};
