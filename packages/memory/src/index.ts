// ─── Types ───
export type {
  MemoryId,
  MemoryType,
  MemoryEntry,
  MemorySource,
  SemanticEntry,
  DailyLogEntry,
  SessionSnapshot,
  ProceduralEntry,
  WorkingMemoryItem,
  ZettelLink,
  LinkType,
  CompactionStrategy,
  CompactionConfig,
  SearchOptions,
  MemoryBootstrapResult,
  EvictionPolicy,
  MemoryConfig,
} from "./types.js";

// ─── Schemas ───
export {
  MemoryId as MemoryIdSchema,
  MemoryType as MemoryTypeSchema,
  MemoryEntrySchema,
  MemorySourceSchema,
  SemanticEntrySchema,
  DailyLogEntrySchema,
  SessionSnapshotSchema,
  ProceduralEntrySchema,
  WorkingMemoryItemSchema,
  ZettelLinkSchema,
  LinkType as LinkTypeSchema,
  CompactionStrategySchema,
  CompactionConfigSchema,
  SearchOptionsSchema,
  MemoryBootstrapResultSchema,
  EvictionPolicy as EvictionPolicySchema,
  MemoryConfigSchema,
  defaultMemoryConfig,
} from "./types.js";

// ─── Errors ───
export {
  MemoryError,
  MemoryNotFoundError,
  DatabaseError,
  CapacityExceededError,
  ContextError,
  CompactionError,
  SearchError,
  ExtractionError,
} from "./errors.js";

// ─── Database ───
export { MemoryDatabase, MemoryDatabaseLive } from "./database.js";
export type { MemoryDatabaseService } from "./database.js";

// ─── Search ───
export { MemorySearchService, MemorySearchServiceLive } from "./search.js";

// ─── Services ───
export { MemoryService, MemoryServiceLive } from "./services/memory-service.js";
export {
  WorkingMemoryService,
  WorkingMemoryServiceLive,
} from "./services/working-memory.js";
export {
  SemanticMemoryService,
  SemanticMemoryServiceLive,
} from "./services/semantic-memory.js";
export {
  EpisodicMemoryService,
  EpisodicMemoryServiceLive,
} from "./services/episodic-memory.js";
export {
  ProceduralMemoryService,
  ProceduralMemoryServiceLive,
} from "./services/procedural-memory.js";

// ─── File System ───
export {
  MemoryFileSystem,
  MemoryFileSystemLive,
} from "./fs/memory-file-system.js";

// ─── Compaction ───
export {
  CompactionService,
  CompactionServiceLive,
} from "./compaction/compaction-service.js";

// ─── Extraction ───
export {
  MemoryExtractor,
  MemoryExtractorLive,
} from "./extraction/memory-extractor.js";
export {
  MemoryConsolidator,
  MemoryConsolidatorLive,
} from "./extraction/memory-consolidator.js";

// ─── Indexing ───
export {
  ZettelkastenService,
  ZettelkastenServiceLive,
} from "./indexing/zettelkasten.js";

// ─── Runtime ───
export { createMemoryLayer } from "./runtime.js";
