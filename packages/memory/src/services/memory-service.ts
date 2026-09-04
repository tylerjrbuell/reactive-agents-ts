import { Effect, Context, Layer } from "effect";
import * as path from "node:path";
import { EventBus } from "@reactive-agents/core";
import type {
  MemoryBootstrapResult,
  MemoryConfig,
  MemoryLLM,
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
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Service Tag ───
//
// `storeSemantic`/`logEpisode` are typed to admit `MemoryError` even though
// this package's own implementation never raises one — `packages/runtime`
// wraps the constructed layer with guardrail screening (F-6, 2026-08-24
// external-research-convergence amendment, W6) via `withMemoryGuardrails`
// in `packages/runtime/src/memory-guardrails.ts`, which fails with
// `MemoryError` on a critical injection/PII match. The screening cannot
// live in this package: `packages/guardrails` depends on
// `packages/llm-provider`, which depends on `packages/memory` — importing
// guardrails here would close that cycle.

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
    ) => Effect.Effect<MemoryId, DatabaseError | MemoryError>;

    /**
     * Log an episodic event (persists to SQLite).
     */
    readonly logEpisode: (
      entry: DailyLogEntry,
    ) => Effect.Effect<MemoryId, DatabaseError | MemoryError>;

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

export const MemoryServiceLive = (config: MemoryConfig, memoryLLM?: MemoryLLM) =>
  Layer.effect(
    MemoryService,
    Effect.gen(function* () {
      const working = yield* WorkingMemoryService;
      const semantic = yield* SemanticMemoryService;
      const episodic = yield* EpisodicMemoryService;
      const _procedural = yield* ProceduralMemoryService;
      const fileSystem = yield* MemoryFileSystem;
      const zettel = yield* ZettelkastenService;

      // EventBus is optional — publish memory lifecycle events when available
      const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const eb = ebOpt._tag === "Some" ? ebOpt.value : null;

      // memory.md must live next to the actual SQLite file (config.dbPath),
      // not a hardcoded cwd-relative path — dbPath resolves to `~/.reactive-agents/...`
      // when memory is auto-enabled (GH #122) but to `<cwd>/.reactive-agents/...`
      // for explicit `.withMemory()` callers. A fixed cwd-relative basePath here
      // silently split the SQLite source of truth and its markdown projection
      // across two different directories (even different filesystem roots)
      // whenever auto-enabled memory was in play.
      // `MemoryFileSystem` always joins `basePath/agentId/memory.md`. Both
      // default resolvers shape dbPath as `<base>/<agentId>/memory.db`, so
      // basePath there is two dirnames up. A caller-supplied dbPath isn't
      // required to follow that convention (e.g. a flat custom file) — detect
      // it by checking whether dbPath's parent dir is actually named after
      // this agent; otherwise fall back to dbPath's own directory so
      // memory.md still lands beside memory.db instead of at an unrelated
      // hardcoded path.
      // `:memory:` (test-only in-process db) has no real directory — fall
      // back to the historical cwd-relative default so tests keep working.
      const basePath =
        config.dbPath === ":memory:"
          ? `.reactive-agents/memory`
          : path.basename(path.dirname(config.dbPath)) === config.agentId
            ? path.dirname(path.dirname(config.dbPath))
            : path.dirname(config.dbPath);

      return {
        bootstrap: (agentId) =>
          Effect.gen(function* () {
            // Ensure directory exists
            yield* fileSystem
              .ensureDirectory(agentId, basePath)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:107", tag: errorTag(err) })));

            // Generate semantic context from live SQLite (not stale memory.md)
            const semanticContext = yield* semantic
              .generateMarkdown(agentId, config.semantic.maxMarkdownLines)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:112", tag: errorTag(err) }).pipe(Effect.as(""))));

            // Get recent episodic entries (last 20)
            const recentEpisodes = yield* episodic
              .getRecent(agentId, 20)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:117", tag: errorTag(err) }).pipe(Effect.as([] as DailyLogEntry[]))));

            // Get active workflows
            const activeWorkflows = yield* _procedural
              .listActive(agentId)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:122", tag: errorTag(err) }).pipe(Effect.as([] as never[]))));

            // Get current working memory
            const workingMemory = yield* working.get();

            const result = {
              agentId,
              semanticContext,
              recentEpisodes,
              activeWorkflows,
              workingMemory: [...workingMemory],
              activeSkills: [] as unknown[],
              bootstrappedAt: new Date(),
              tier: config.tier,
            } satisfies MemoryBootstrapResult;

            if (eb) {
              yield* eb.publish({ _tag: "MemoryBootstrapped", agentId, tier: config.tier })
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:140", tag: errorTag(err) })));
            }

            return result;
          }),

        flush: (agentId) =>
          Effect.gen(function* () {
            const markdown = yield* semantic.generateMarkdown(
              agentId,
              config.semantic.maxMarkdownLines,
            );
            yield* fileSystem.writeMarkdown(agentId, markdown, basePath);
            if (eb) {
              yield* eb.publish({ _tag: "MemoryFlushed", agentId })
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:155", tag: errorTag(err) })));
            }
          }),

        snapshot: (snap) => episodic.saveSnapshot(snap),

        addToWorking: (item) => working.add(item),

        storeSemantic: (entry) =>
          Effect.gen(function* () {
            // Auto-generate embedding if MemoryLLM.embed is available and entry has none
            let entryToStore = entry;
            if (
              memoryLLM?.embed &&
              (!entry.embedding || entry.embedding.length === 0)
            ) {
              const embeddingResult = yield* memoryLLM
                .embed([entry.content])
                .pipe(
                  Effect.map((embeddings) =>
                    embeddings.length > 0 ? [...embeddings[0]!] : undefined,
                  ),
                  Effect.catchAll(() => Effect.succeed(undefined as number[] | undefined)),
                );
              if (embeddingResult && embeddingResult.length > 0) {
                entryToStore = { ...entry, embedding: embeddingResult };
              }
            }
            const id = yield* semantic.store(entryToStore);
            // Auto-link if Zettelkasten enabled
            if (config.zettelkasten.enabled) {
              yield* zettel
                .autoLinkText(
                  entry.id,
                  entry.content,
                  entry.agentId,
                  config.zettelkasten.linkingThreshold,
                )
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "memory/src/services/memory-service.ts:188", tag: errorTag(err) }).pipe(Effect.as([]))));
            }
            return id;
          }),

        logEpisode: (entry) => episodic.log(entry),

        getWorking: () => working.get(),
      };
    }),
  );
