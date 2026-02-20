import { Schema } from "effect";

// ─── Memory ID (branded string) ───

export const MemoryId = Schema.String.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

// ─── Memory Type (4 types) ───

export const MemoryType = Schema.Literal(
  "semantic",
  "episodic",
  "procedural",
  "working",
);
export type MemoryType = typeof MemoryType.Type;

// ─── Memory Source ───

export const MemorySourceSchema = Schema.Struct({
  type: Schema.Literal("agent", "user", "tool", "system", "llm-extraction"),
  id: Schema.String,
  taskId: Schema.optional(Schema.String),
});
export type MemorySource = typeof MemorySourceSchema.Type;

// ─── Base Memory Entry ───

export const MemoryEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  type: MemoryType,
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
  tags: Schema.Array(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type MemoryEntry = typeof MemoryEntrySchema.Type;

// ─── Semantic Memory Entry (long-term knowledge) ───

export const SemanticEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  content: Schema.String,
  summary: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  verified: Schema.Boolean,
  tags: Schema.Array(Schema.String),
  embedding: Schema.optional(Schema.Array(Schema.Number)),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
  accessCount: Schema.Number,
  lastAccessedAt: Schema.DateFromSelf,
});
export type SemanticEntry = typeof SemanticEntrySchema.Type;

// ─── Daily Log Entry (episodic) ───

export const DailyLogEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  date: Schema.String,
  content: Schema.String,
  taskId: Schema.optional(Schema.String),
  eventType: Schema.Literal(
    "task-started",
    "task-completed",
    "task-failed",
    "decision-made",
    "error-encountered",
    "user-feedback",
    "tool-call",
    "observation",
  ),
  cost: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  createdAt: Schema.DateFromSelf,
});
export type DailyLogEntry = typeof DailyLogEntrySchema.Type;

// ─── Session Snapshot (episodic) ───

export const SessionSnapshotSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  messages: Schema.Array(Schema.Unknown),
  summary: Schema.String,
  keyDecisions: Schema.Array(Schema.String),
  taskIds: Schema.Array(Schema.String),
  startedAt: Schema.DateFromSelf,
  endedAt: Schema.DateFromSelf,
  totalCost: Schema.Number,
  totalTokens: Schema.Number,
});
export type SessionSnapshot = typeof SessionSnapshotSchema.Type;

// ─── Procedural Entry (learned workflows) ───

export const ProceduralEntrySchema = Schema.Struct({
  id: MemoryId,
  agentId: Schema.String,
  name: Schema.String,
  description: Schema.String,
  pattern: Schema.String,
  successRate: Schema.Number.pipe(Schema.between(0, 1)),
  useCount: Schema.Number,
  tags: Schema.Array(Schema.String),
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type ProceduralEntry = typeof ProceduralEntrySchema.Type;

// ─── Working Memory Item (in-process only) ───

export const WorkingMemoryItemSchema = Schema.Struct({
  id: MemoryId,
  content: Schema.String,
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  addedAt: Schema.DateFromSelf,
  source: MemorySourceSchema,
});
export type WorkingMemoryItem = typeof WorkingMemoryItemSchema.Type;

// ─── Zettelkasten Link ───

export const LinkType = Schema.Literal(
  "similar",
  "sequential",
  "causal",
  "contradicts",
  "supports",
  "elaborates",
);
export type LinkType = typeof LinkType.Type;

export const ZettelLinkSchema = Schema.Struct({
  source: MemoryId,
  target: MemoryId,
  strength: Schema.Number.pipe(Schema.between(0, 1)),
  type: LinkType,
  createdAt: Schema.DateFromSelf,
});
export type ZettelLink = typeof ZettelLinkSchema.Type;

// ─── Compaction Config ───

export const CompactionStrategySchema = Schema.Literal(
  "count",
  "time",
  "semantic",
  "progressive",
);
export type CompactionStrategy = typeof CompactionStrategySchema.Type;

export const CompactionConfigSchema = Schema.Struct({
  strategy: CompactionStrategySchema,
  maxEntries: Schema.optional(Schema.Number),
  intervalMs: Schema.optional(Schema.Number),
  similarityThreshold: Schema.optional(Schema.Number),
  decayFactor: Schema.optional(Schema.Number),
});
export type CompactionConfig = typeof CompactionConfigSchema.Type;

// ─── Search Options ───

export const SearchOptionsSchema = Schema.Struct({
  query: Schema.String,
  types: Schema.optional(Schema.Array(MemoryType)),
  limit: Schema.optional(Schema.Number),
  threshold: Schema.optional(Schema.Number),
  useVector: Schema.optional(Schema.Boolean),
  agentId: Schema.String,
});
export type SearchOptions = typeof SearchOptionsSchema.Type;

// ─── Memory Bootstrap Result ───

export const MemoryBootstrapResultSchema = Schema.Struct({
  agentId: Schema.String,
  semanticContext: Schema.String,
  recentEpisodes: Schema.Array(DailyLogEntrySchema),
  activeWorkflows: Schema.Array(ProceduralEntrySchema),
  workingMemory: Schema.Array(WorkingMemoryItemSchema),
  bootstrappedAt: Schema.DateFromSelf,
  tier: Schema.Literal("1", "2"),
});
export type MemoryBootstrapResult = typeof MemoryBootstrapResultSchema.Type;

// ─── Eviction Policy ───

export const EvictionPolicy = Schema.Literal("fifo", "lru", "importance");
export type EvictionPolicy = typeof EvictionPolicy.Type;

// ─── Memory Config ───

export const MemoryConfigSchema = Schema.Struct({
  tier: Schema.Literal("1", "2"),
  agentId: Schema.String,
  dbPath: Schema.String,
  working: Schema.Struct({
    capacity: Schema.Number,
    evictionPolicy: EvictionPolicy,
  }),
  semantic: Schema.Struct({
    maxMarkdownLines: Schema.Number,
    importanceThreshold: Schema.Number,
  }),
  episodic: Schema.Struct({
    retainDays: Schema.Number,
    maxSnapshotsPerSession: Schema.Number,
  }),
  compaction: CompactionConfigSchema,
  zettelkasten: Schema.Struct({
    enabled: Schema.Boolean,
    linkingThreshold: Schema.Number.pipe(Schema.between(0, 1)),
    maxLinksPerEntry: Schema.Number,
  }),
});
export type MemoryConfig = typeof MemoryConfigSchema.Type;

export const defaultMemoryConfig = (agentId: string): MemoryConfig => ({
  tier: "1",
  agentId,
  dbPath: `.reactive-agents/memory/${agentId}/memory.db`,
  working: { capacity: 7, evictionPolicy: "fifo" },
  semantic: { maxMarkdownLines: 200, importanceThreshold: 0.7 },
  episodic: { retainDays: 30, maxSnapshotsPerSession: 3 },
  compaction: {
    strategy: "progressive",
    maxEntries: 1000,
    intervalMs: 86_400_000,
    similarityThreshold: 0.92,
    decayFactor: 0.05,
  },
  zettelkasten: {
    enabled: true,
    linkingThreshold: 0.85,
    maxLinksPerEntry: 10,
  },
});
