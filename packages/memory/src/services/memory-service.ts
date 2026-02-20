import { Effect, Context, Layer } from "effect";
import type {
  MemoryBootstrapResult,
  MemoryConfig,
  SemanticEntry,
  DailyLogEntry,
  WorkingMemoryItem,
  MemoryId,
  SessionSnapshot,
} from "../types.js";
import { MemoryError, DatabaseError } from "../errors.js";
import { WorkingMemoryService } from "./working-memory.js";
import { SemanticMemoryService } from "./semantic-memory.js";
import { EpisodicMemoryService } from "./episodic-memory.js";
import { ProceduralMemoryService } from "./procedural-memory.js";
import { MemoryFileSystem } from "../fs/memory-file-system.js";
import { ZettelkastenService } from "../indexing/zettelkasten.js";

// ─── Service Tag ───

export class MemoryService extends Context.Tag("MemoryService")<
  MemoryService,
  {
    /**
     * Bootstrap: load semantic context + recent episodes for agent.
     * Called by ExecutionEngine at Phase 1 (BOOTSTRAP).
     */
    readonly bootstrap: (
      agentId: string,
    ) => Effect.Effect<MemoryBootstrapResult, MemoryError | DatabaseError>;

    /**
     * Flush: generate memory.md projection from SQLite and write to disk.
     */
    readonly flush: (
      agentId: string,
    ) => Effect.Effect<void, MemoryError | DatabaseError>;

    /**
     * Snapshot: save session messages to episodic SQLite storage.
     */
    readonly snapshot: (
      snapshot: SessionSnapshot,
    ) => Effect.Effect<void, DatabaseError>;

    /**
     * Store a working memory item (adds to in-process Ref).
     */
    readonly addToWorking: (
      item: WorkingMemoryItem,
    ) => Effect.Effect<void, never>;

    /**
     * Store a semantic memory entry (persists to SQLite).
     * Auto-links via Zettelkasten if enabled.
     */
    readonly storeSemantic: (
      entry: SemanticEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /**
     * Log an episodic event (persists to SQLite).
     */
    readonly logEpisode: (
      entry: DailyLogEntry,
    ) => Effect.Effect<MemoryId, DatabaseError>;

    /**
     * Get current working memory contents.
     */
    readonly getWorking: () => Effect.Effect<
      readonly WorkingMemoryItem[],
      never
    >;
  }
>() {}

// ─── Live Implementation ───

export const MemoryServiceLive = (config: MemoryConfig) =>
  Layer.effect(
    MemoryService,
    Effect.gen(function* () {
      const working = yield* WorkingMemoryService;
      const semantic = yield* SemanticMemoryService;
      const episodic = yield* EpisodicMemoryService;
      const _procedural = yield* ProceduralMemoryService;
      const fileSystem = yield* MemoryFileSystem;
      const zettel = yield* ZettelkastenService;

      const basePath = `.reactive-agents/memory`;

      return {
        bootstrap: (agentId) =>
          Effect.gen(function* () {
            // Ensure directory exists
            yield* fileSystem
              .ensureDirectory(agentId, basePath)
              .pipe(Effect.catchAll(() => Effect.void));

            // Read memory.md for semantic context
            const semanticContext = yield* fileSystem
              .readMarkdown(agentId, basePath)
              .pipe(Effect.catchAll(() => Effect.succeed("")));

            // Get recent episodic entries (last 20)
            const recentEpisodes = yield* episodic
              .getRecent(agentId, 20)
              .pipe(Effect.catchAll(() => Effect.succeed([] as DailyLogEntry[])));

            // Get active workflows
            const activeWorkflows = yield* _procedural
              .listActive(agentId)
              .pipe(Effect.catchAll(() => Effect.succeed([] as never[])));

            // Get current working memory
            const workingMemory = yield* working.get();

            return {
              agentId,
              semanticContext,
              recentEpisodes,
              activeWorkflows,
              workingMemory: [...workingMemory],
              bootstrappedAt: new Date(),
              tier: config.tier,
            } satisfies MemoryBootstrapResult;
          }),

        flush: (agentId) =>
          Effect.gen(function* () {
            const markdown = yield* semantic.generateMarkdown(
              agentId,
              config.semantic.maxMarkdownLines,
            );
            yield* fileSystem.writeMarkdown(agentId, markdown, basePath);
          }),

        snapshot: (snap) => episodic.saveSnapshot(snap),

        addToWorking: (item) => working.add(item),

        storeSemantic: (entry) =>
          Effect.gen(function* () {
            const id = yield* semantic.store(entry);
            // Auto-link if Zettelkasten enabled
            if (config.zettelkasten.enabled) {
              yield* zettel
                .autoLinkText(
                  entry.id,
                  entry.content,
                  entry.agentId,
                  config.zettelkasten.linkingThreshold,
                )
                .pipe(Effect.catchAll(() => Effect.succeed([])));
            }
            return id;
          }),

        logEpisode: (entry) => episodic.log(entry),

        getWorking: () => working.get(),
      };
    }),
  );
