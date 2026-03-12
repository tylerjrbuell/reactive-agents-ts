import { Schema } from "effect";

// ─── Memory ID (branded string) ───

/** Branded string identifier for a memory entry. */
export const MemoryId = Schema.String.pipe(Schema.brand("MemoryId"));
export type MemoryId = typeof MemoryId.Type;

// ─── Memory Type (4 types) ───

/**
 * The four memory tiers in the 4-layer memory system.
 *
 * - `"working"` — In-process short-term slots (capacity: 7, eviction policy: fifo/lru/importance)
 * - `"episodic"` — Daily logs and session snapshots (SQLite, retained N days)
 * - `"semantic"` — Long-term knowledge facts with embeddings (requires EMBEDDING_PROVIDER)
 * - `"procedural"` — Learned workflows and patterns with success rates
 */
export const MemoryType = Schema.Literal(
  "semantic",
  "episodic",
  "procedural",
  "working",
);
export type MemoryType = typeof MemoryType.Type;

// ─── Memory Source ───

/**
 * Origin of a memory entry — who or what created it.
 *
 * - `"agent"` — Created by the agent's reasoning process
 * - `"user"` — Created from user input
 * - `"tool"` — Created from tool execution results
 * - `"system"` — Created by the framework itself (bootstrap, flush)
 * - `"llm-extraction"` — Extracted from LLM responses via MemoryExtractor
 */
export const MemorySourceSchema = Schema.Struct({
  /** Origin type */
  type: Schema.Literal("agent", "user", "tool", "system", "llm-extraction"),
  /** ID of the originating agent, user, or tool */
  id: Schema.String,
  /** Task ID this memory was created during (optional) */
  taskId: Schema.optional(Schema.String),
});
export type MemorySource = typeof MemorySourceSchema.Type;

// ─── Base Memory Entry ───

/**
 * Base memory entry schema shared by all memory types.
 *
 * All memory entries have an ID, agent association, content, importance score,
 * source metadata, and tags. Specific memory types extend this with type-specific fields.
 */
export const MemoryEntrySchema = Schema.Struct({
  /** Unique memory entry identifier */
  id: MemoryId,
  /** Agent that owns this memory entry */
  agentId: Schema.String,
  /** Which memory tier this entry belongs to */
  type: MemoryType,
  /** Memory content as plain text */
  content: Schema.String,
  /** Importance score 0.0–1.0 (used for eviction, compaction, and semantic search ranking) */
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  /** When this entry was created */
  createdAt: Schema.DateFromSelf,
  /** When this entry was last updated */
  updatedAt: Schema.DateFromSelf,
  /** Origin of this memory entry */
  source: MemorySourceSchema,
  /** Searchable tags for filtering and retrieval */
  tags: Schema.Array(Schema.String),
  /** Optional arbitrary metadata (tool results, context data) */
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type MemoryEntry = typeof MemoryEntrySchema.Type;

// ─── Semantic Memory Entry (long-term knowledge) ───

/**
 * A long-term semantic knowledge entry with embedding vector support.
 *
 * Stored in SQLite with optional vector embeddings for similarity search.
 * Embeddings are required for KNN search (`.withMemory({ tier: "enhanced" })`).
 * Access count and last access time enable importance decay over time.
 */
export const SemanticEntrySchema = Schema.Struct({
  /** Unique memory entry identifier */
  id: MemoryId,
  /** Agent that owns this entry */
  agentId: Schema.String,
  /** Full content of the semantic fact */
  content: Schema.String,
  /** Condensed summary for display and retrieval context */
  summary: Schema.String,
  /** Importance score 0.0–1.0 — entries below threshold are pruned during compaction */
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  /** Whether this fact has been verified (e.g., via VerificationService) */
  verified: Schema.Boolean,
  /** Tags for filtering and thematic grouping */
  tags: Schema.Array(Schema.String),
  /** Dense vector embedding for similarity search (undefined when embeddings are disabled) */
  embedding: Schema.optional(Schema.Array(Schema.Number)),
  /** When this entry was created */
  createdAt: Schema.DateFromSelf,
  /** When this entry was last updated */
  updatedAt: Schema.DateFromSelf,
  /** Number of times this entry was retrieved */
  accessCount: Schema.Number,
  /** When this entry was last retrieved */
  lastAccessedAt: Schema.DateFromSelf,
});
export type SemanticEntry = typeof SemanticEntrySchema.Type;

// ─── Daily Log Entry (episodic) ───

/**
 * A single episodic log entry recording what happened during task execution.
 *
 * Daily log entries are the primary episodic memory primitive. They record
 * significant events (task start/end, decisions, errors, tool calls) with
 * optional cost and duration metadata.
 */
export const DailyLogEntrySchema = Schema.Struct({
  /** Unique entry identifier */
  id: MemoryId,
  /** Agent that created this log entry */
  agentId: Schema.String,
  /** Date string (ISO format, e.g. "2026-03-12") for daily grouping */
  date: Schema.String,
  /** Human-readable description of the event */
  content: Schema.String,
  /** Task ID this event occurred in (optional) */
  taskId: Schema.optional(Schema.String),
  /** Type of event for filtering and analysis */
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
  /** USD cost associated with this event (if applicable) */
  cost: Schema.optional(Schema.Number),
  /** Duration in milliseconds (for task/tool events) */
  duration: Schema.optional(Schema.Number),
  /** Optional arbitrary metadata */
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  /** When this entry was created */
  createdAt: Schema.DateFromSelf,
});
export type DailyLogEntry = typeof DailyLogEntrySchema.Type;

// ─── Session Snapshot (episodic) ───

/**
 * A compressed snapshot of a completed session for episodic recall.
 *
 * Created when `session.end()` is called with `persistOnEnd: true`, or
 * during memory flush. Stores key decisions and message history summary
 * for cross-session recall without full message replay.
 */
export const SessionSnapshotSchema = Schema.Struct({
  /** Unique snapshot identifier */
  id: Schema.String,
  /** Agent that owns this snapshot */
  agentId: Schema.String,
  /** Full message history for this session */
  messages: Schema.Array(Schema.Unknown),
  /** LLM-generated summary of the session */
  summary: Schema.String,
  /** List of significant decisions made during the session */
  keyDecisions: Schema.Array(Schema.String),
  /** Task IDs that ran during this session */
  taskIds: Schema.Array(Schema.String),
  /** When the session started */
  startedAt: Schema.DateFromSelf,
  /** When the session ended */
  endedAt: Schema.DateFromSelf,
  /** Total USD cost across all tasks in this session */
  totalCost: Schema.Number,
  /** Total tokens consumed across all tasks in this session */
  totalTokens: Schema.Number,
});
export type SessionSnapshot = typeof SessionSnapshotSchema.Type;

// ─── Procedural Entry (learned workflows) ───

/**
 * A learned workflow or pattern stored in procedural memory.
 *
 * Procedural entries encode repeatable multi-step workflows the agent has
 * learned through experience. Success rate and use count drive strategy
 * selection for similar future tasks.
 */
export const ProceduralEntrySchema = Schema.Struct({
  /** Unique entry identifier */
  id: MemoryId,
  /** Agent that owns this entry */
  agentId: Schema.String,
  /** Short name for this workflow (e.g., "web-research-and-summarize") */
  name: Schema.String,
  /** Human-readable description of when and how to use this workflow */
  description: Schema.String,
  /** Template or pattern string representing the workflow steps */
  pattern: Schema.String,
  /** Historical success rate 0.0–1.0 (updated after each use) */
  successRate: Schema.Number.pipe(Schema.between(0, 1)),
  /** Number of times this workflow has been used */
  useCount: Schema.Number,
  /** Tags for task-type matching and filtering */
  tags: Schema.Array(Schema.String),
  /** When this entry was created */
  createdAt: Schema.DateFromSelf,
  /** When this entry was last updated */
  updatedAt: Schema.DateFromSelf,
});
export type ProceduralEntry = typeof ProceduralEntrySchema.Type;

// ─── Working Memory Item (in-process only) ───

/**
 * A single slot in working memory — the agent's in-process short-term context.
 *
 * Working memory is NOT persisted to SQLite. It holds 7 items maximum (configurable)
 * with configurable eviction policy (fifo, lru, or importance-based). Items are
 * initialized at bootstrap from prior episodic/semantic context.
 */
export const WorkingMemoryItemSchema = Schema.Struct({
  /** Unique item identifier */
  id: MemoryId,
  /** Content of this working memory slot */
  content: Schema.String,
  /** Importance score 0.0–1.0 (used by importance-based eviction) */
  importance: Schema.Number.pipe(Schema.between(0, 1)),
  /** When this item was added to working memory */
  addedAt: Schema.DateFromSelf,
  /** Origin of this working memory item */
  source: MemorySourceSchema,
});
export type WorkingMemoryItem = typeof WorkingMemoryItemSchema.Type;

// ─── Zettelkasten Link ───

/**
 * Semantic link type between two memory entries in the Zettelkasten graph.
 *
 * - `"similar"` — Entries share the same topic or content theme
 * - `"sequential"` — One entry follows from or builds on another
 * - `"causal"` — One entry caused or led to another
 * - `"contradicts"` — Entries contradict each other (useful for verification)
 * - `"supports"` — One entry provides evidence for another
 * - `"elaborates"` — One entry expands on details of another
 */
export const LinkType = Schema.Literal(
  "similar",
  "sequential",
  "causal",
  "contradicts",
  "supports",
  "elaborates",
);
export type LinkType = typeof LinkType.Type;

/**
 * A directed link between two memory entries in the Zettelkasten knowledge graph.
 *
 * Links are created automatically by the MemoryConsolidatorService when
 * semantic similarity exceeds the configured `linkingThreshold`.
 */
export const ZettelLinkSchema = Schema.Struct({
  /** Source memory entry ID */
  source: MemoryId,
  /** Target memory entry ID */
  target: MemoryId,
  /** Link strength 0.0–1.0 (typically embedding cosine similarity) */
  strength: Schema.Number.pipe(Schema.between(0, 1)),
  /** Semantic relationship type */
  type: LinkType,
  /** When this link was created */
  createdAt: Schema.DateFromSelf,
});
export type ZettelLink = typeof ZettelLinkSchema.Type;

// ─── Compaction Config ───

/**
 * Strategy for reducing memory entries when the store grows too large.
 *
 * - `"count"` — Remove oldest entries when count exceeds `maxEntries`
 * - `"time"` — Remove entries older than `intervalMs`
 * - `"semantic"` — Merge/deduplicate entries with cosine similarity above `similarityThreshold`
 * - `"progressive"` — Combination: time decay + semantic deduplication + importance pruning
 */
export const CompactionStrategySchema = Schema.Literal(
  "count",
  "time",
  "semantic",
  "progressive",
);
export type CompactionStrategy = typeof CompactionStrategySchema.Type;

/**
 * Configuration for the memory compaction service.
 *
 * Controls when and how the memory store is compacted to stay within limits.
 */
export const CompactionConfigSchema = Schema.Struct({
  /** Compaction algorithm to use */
  strategy: CompactionStrategySchema,
  /** Max entries before count-based compaction triggers */
  maxEntries: Schema.optional(Schema.Number),
  /** Interval in milliseconds between time-based compaction runs */
  intervalMs: Schema.optional(Schema.Number),
  /** Cosine similarity threshold for merging near-duplicate semantic entries */
  similarityThreshold: Schema.optional(Schema.Number),
  /** Importance decay factor applied per compaction cycle (0.0–1.0) */
  decayFactor: Schema.optional(Schema.Number),
});
export type CompactionConfig = typeof CompactionConfigSchema.Type;

// ─── Search Options ───

/**
 * Options for searching across memory tiers.
 *
 * Supports hybrid search: keyword-based (`useVector: false`) or
 * vector similarity search (`useVector: true`, requires embeddings).
 */
export const SearchOptionsSchema = Schema.Struct({
  /** Search query string */
  query: Schema.String,
  /** Memory types to search (defaults to all types) */
  types: Schema.optional(Schema.Array(MemoryType)),
  /** Maximum number of results to return */
  limit: Schema.optional(Schema.Number),
  /** Minimum similarity threshold for vector search results */
  threshold: Schema.optional(Schema.Number),
  /** Use embedding vector search (requires enhanced tier + EMBEDDING_PROVIDER) */
  useVector: Schema.optional(Schema.Boolean),
  /** Agent whose memory to search */
  agentId: Schema.String,
});
export type SearchOptions = typeof SearchOptionsSchema.Type;

// ─── Memory Bootstrap Result ───

/**
 * Result of the memory bootstrap phase at execution start.
 *
 * Contains pre-loaded context from all memory tiers injected into the
 * execution context before the reasoning loop begins. Working memory
 * items are always loaded; semantic/episodic/procedural only when tier 2.
 */
export const MemoryBootstrapResultSchema = Schema.Struct({
  /** Agent whose memory was bootstrapped */
  agentId: Schema.String,
  /** Pre-formatted semantic context string for injection into the system prompt */
  semanticContext: Schema.String,
  /** Recent episodic log entries from previous sessions */
  recentEpisodes: Schema.Array(DailyLogEntrySchema),
  /** Active procedural workflows relevant to the current task */
  activeWorkflows: Schema.Array(ProceduralEntrySchema),
  /** Current working memory items */
  workingMemory: Schema.Array(WorkingMemoryItemSchema),
  /** When the bootstrap completed */
  bootstrappedAt: Schema.DateFromSelf,
  /** Memory tier that was bootstrapped */
  tier: Schema.Literal("1", "2"),
});
export type MemoryBootstrapResult = typeof MemoryBootstrapResultSchema.Type;

// ─── Eviction Policy ───

/**
 * Working memory eviction policy — controls which item is removed when capacity is full.
 *
 * - `"fifo"` — First in, first out (remove oldest item)
 * - `"lru"` — Least recently used (remove least recently accessed item)
 * - `"importance"` — Remove the item with the lowest importance score
 */
export const EvictionPolicy = Schema.Literal("fifo", "lru", "importance");
export type EvictionPolicy = typeof EvictionPolicy.Type;

// ─── Memory Config ───

/**
 * Full configuration for the memory service.
 *
 * Controls all aspects of the 4-layer memory system: working memory capacity,
 * semantic importance thresholds, episodic retention, compaction, and
 * Zettelkasten knowledge graph linking.
 */
export const MemoryConfigSchema = Schema.Struct({
  /** Memory tier: "1" = working memory only, "2" = full 4-layer system */
  tier: Schema.Literal("1", "2"),
  /** Agent identifier for memory isolation */
  agentId: Schema.String,
  /** Path to the SQLite database file */
  dbPath: Schema.String,
  /** Working memory configuration */
  working: Schema.Struct({
    /** Maximum number of items in working memory (Miller's Law: default 7) */
    capacity: Schema.Number,
    /** Eviction strategy when capacity is exceeded */
    evictionPolicy: EvictionPolicy,
  }),
  /** Semantic memory configuration (tier 2 only) */
  semantic: Schema.Struct({
    /** Maximum lines in the semantic context markdown summary */
    maxMarkdownLines: Schema.Number,
    /** Minimum importance score for inclusion in context (0.0–1.0) */
    importanceThreshold: Schema.Number,
  }),
  /** Episodic memory configuration */
  episodic: Schema.Struct({
    /** Days to retain daily log entries before pruning */
    retainDays: Schema.Number,
    /** Maximum session snapshots to keep per session */
    maxSnapshotsPerSession: Schema.Number,
  }),
  /** Compaction configuration */
  compaction: CompactionConfigSchema,
  /** Zettelkasten knowledge graph configuration */
  zettelkasten: Schema.Struct({
    /** Whether automatic knowledge graph linking is enabled */
    enabled: Schema.Boolean,
    /** Cosine similarity threshold for creating links (0.0–1.0) */
    linkingThreshold: Schema.Number.pipe(Schema.between(0, 1)),
    /** Maximum number of links per memory entry */
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

// ─── Memory LLM Interface ───

/** Decoupled LLM interface for Tier 2 memory services (importance scoring, tag extraction, embeddings). */
export type MemoryLLM = {
  readonly complete: (req: {
    messages: readonly { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }) => import("effect").Effect.Effect<
    { content: string; usage?: { totalTokens?: number } },
    unknown
  >;

  /** Generate embeddings for one or more texts. Optional for backward compatibility. */
  readonly embed?: (
    texts: readonly string[],
    model?: string,
  ) => import("effect").Effect.Effect<readonly (readonly number[])[], unknown>;
};
